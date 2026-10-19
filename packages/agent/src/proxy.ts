import { completionURL } from './openai.js';
import { isRecord } from './validation.js';

export interface OpenAIProxyOptions {
  /** Fixed upstream root. It is never taken from browser input. */
  baseURL: string;
  apiPath?: string;
  /** Server-only provider credential. Incoming Authorization headers are not forwarded. */
  apiKey?: string;
  /** Restrict browser-selected models when sharing a provider account. */
  allowedModels?: readonly string[];
  timeoutMs?: number;
  maxBodyBytes?: number;
  fetch?: typeof globalThis.fetch;
}

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { type: 'pageway_proxy_error', code, message } }, { status });

class InputError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readCompletion(request: Request, limit: number): Promise<Record<string, unknown>> {
  if (
    !request.body ||
    !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')
  )
    throw new InputError(400, 'A JSON completion request is required.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let body = '';
  let bytes = 0;
  try {
    while (true) {
      request.signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw new InputError(413, 'Completion request exceeds the body limit.');
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    const input: unknown = JSON.parse(body);
    if (
      !isRecord(input) ||
      typeof input.model !== 'string' ||
      !input.model.trim() ||
      !Array.isArray(input.messages) ||
      input.messages.length === 0 ||
      (input.stream !== undefined && typeof input.stream !== 'boolean')
    )
      throw new InputError(
        400,
        'A model, messages array and optional boolean stream are required.',
      );
    return input;
  } catch (error) {
    if (error instanceof InputError || request.signal.aborted) throw error;
    throw new InputError(400, 'Completion request must be valid UTF-8 JSON.');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/**
 * Optional server-side credential boundary. Both sides speak ordinary OpenAI
 * Chat Completions; agent planning, tools and AG-UI adaptation stay in the browser.
 * Add your application's authentication before exposing this handler publicly.
 */
export function createOpenAIProxyHandler(
  options: OpenAIProxyOptions,
): (request: Request) => Promise<Response> {
  const url = completionURL(options.baseURL, options.apiPath);
  const timeoutMs = options.timeoutMs ?? 45_000;
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
    throw new Error('timeoutMs must be between 1 and 300000.');
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > 16_777_216)
    throw new Error('maxBodyBytes must be between 1 and 16777216.');
  const allowedModels = options.allowedModels ? new Set(options.allowedModels) : undefined;
  return async (request) => {
    if (request.method !== 'POST')
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    let input: Record<string, unknown>;
    try {
      input = await readCompletion(request, maxBodyBytes);
    } catch (error) {
      if (request.signal.aborted) return errorResponse(499, 'cancelled', 'Request was cancelled.');
      return errorResponse(
        error instanceof InputError ? error.status : 400,
        'invalid_request',
        error instanceof InputError ? error.message : 'Invalid completion request.',
      );
    }
    if (allowedModels && !allowedModels.has(input.model as string))
      return errorResponse(400, 'model_not_allowed', 'The requested model is not enabled.');
    const abortController = new AbortController();
    const abort = () => abortController.abort(request.signal.reason);
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abortController.abort(new Error('Proxy timeout'));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
    };
    let upstream: Response;
    try {
      abortController.signal.throwIfAborted();
      upstream = await (options.fetch ?? globalThis.fetch)(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: input.stream ? 'text/event-stream' : 'application/json',
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify(input),
        signal: abortController.signal,
        redirect: 'error',
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        cleanup();
        return errorResponse(
          upstream.status,
          'provider_http_error',
          `Model provider returned HTTP ${upstream.status}.`,
        );
      }
    } catch {
      cleanup();
      return errorResponse(
        timedOut ? 504 : request.signal.aborted ? 499 : 502,
        timedOut ? 'timeout' : request.signal.aborted ? 'cancelled' : 'provider_connection_error',
        timedOut
          ? 'Model provider timed out.'
          : request.signal.aborted
            ? 'Request was cancelled.'
            : 'Unable to reach the model provider.',
      );
    }
    const headers = new Headers({
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    });
    if (!upstream.body) {
      cleanup();
      return new Response(null, { status: upstream.status, headers });
    }
    const reader = upstream.body.getReader();
    let finished = false;
    let abortStream: () => void;
    const finish = () => {
      finished = true;
      cleanup();
      abortController.signal.removeEventListener('abort', abortStream);
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        abortStream = () => {
          if (finished) return;
          finish();
          controller.error(
            new Error(timedOut ? 'Model provider timed out.' : 'Request was cancelled.'),
          );
          void reader.cancel().catch(() => undefined);
        };
        abortController.signal.addEventListener('abort', abortStream, { once: true });
        if (abortController.signal.aborted) abortStream();
      },
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (finished) return;
          if (chunk.done) {
            finish();
            reader.releaseLock();
            controller.close();
          } else controller.enqueue(chunk.value);
        } catch {
          if (!finished) {
            finish();
            controller.error(new Error('Unable to read the model response.'));
          }
        }
      },
      async cancel(reason) {
        finish();
        abortController.abort(reason);
        await reader.cancel(reason).catch(() => undefined);
        reader.releaseLock();
      },
    });
    return new Response(body, { status: upstream.status, headers });
  };
}
