import { encodeSSE, EventType, type AGUIEvent } from '@zllling/pageway-protocol';
import { runDemo } from './demo.js';
import { AgentError } from './errors.js';
import { completionURL, streamCompletion, type OpenAIOptions } from './openai.js';
import { validateInput } from './validation.js';

export type { OpenAIOptions } from './openai.js';
export type { ProviderInfo } from './provider-info.js';
export { createOpenAIProxyHandler, type OpenAIProxyOptions } from './proxy.js';

export interface AgentOptions {
  /** Demo is a deterministic planner, explicitly labeled in all responses. */
  mode?: 'demo' | 'openai';
  baseURL?: string;
  /** Completion route appended to baseURL. Default: chat/completions. */
  apiPath?: string;
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
  /** Timeout for the whole model run, including stream consumption. Default 45 s. */
  timeoutMs?: number;
  /** Injectable transport, useful for edge runtimes and contract tests. */
  fetch?: typeof globalThis.fetch;
  /** Application authentication headers for compatible gateways. */
  headers?: Record<string, string>;
}

export interface AgentStatus {
  mode: 'demo' | 'openai';
  model: string;
  provider: string;
  configured: boolean;
  note: string;
}

export function getAgentStatus(options: AgentOptions = {}): AgentStatus {
  const mode = options.mode ?? 'demo';
  return {
    mode,
    model: mode === 'demo' ? 'deterministic-demo' : (options.model ?? ''),
    provider: mode === 'demo' ? 'local' : options.baseURL ? new URL(options.baseURL).host : '',
    configured: mode === 'demo' || Boolean(options.baseURL && options.model),
    note:
      mode === 'demo'
        ? 'Deterministic demo planner; no language model or API key is used.'
        : 'OpenAI-compatible API configured; remote access is checked when a run starts.',
  };
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

async function readInput(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new AgentError('INVALID_INPUT', 'Use application/json for the request body.');
  const reader = request.body?.getReader();
  let size = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let body = '';
  try {
    // Firefox can expose a null Request.body for a buffered request while its
    // arrayBuffer() remains readable. Server runtimes retain the streaming limit.
    if (!reader) {
      request.signal.throwIfAborted();
      const bytes = await request.arrayBuffer();
      request.signal.throwIfAborted();
      if (!bytes.byteLength) throw new AgentError('INVALID_INPUT', 'Request body is required.');
      if (bytes.byteLength > 1_048_576)
        throw new AgentError('INPUT_TOO_LARGE', 'Request exceeds the 1 MiB limit.');
      return JSON.parse(decoder.decode(bytes));
    }
    while (true) {
      request.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_048_576)
        throw new AgentError('INPUT_TOO_LARGE', 'Request exceeds the 1 MiB limit.');
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError('INVALID_INPUT', 'Request body must be valid UTF-8 JSON.');
  } finally {
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}

/** Fetch-native handler: one HTTP request = one AG-UI run. Tool execution stays in the browser. */
export function createAgentHandler(
  options: AgentOptions = {},
): (request: Request) => Promise<Response> {
  const mode = options.mode ?? 'demo';
  const timeoutMs = options.timeoutMs ?? 45_000;
  if (mode !== 'demo' && mode !== 'openai') throw new Error('mode must be demo or openai.');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
    throw new Error('timeoutMs must be between 1 and 300000.');
  if (mode === 'openai') {
    if (!options.baseURL || !options.model?.trim())
      throw new Error('OpenAI mode requires baseURL and model.');
    completionURL(options.baseURL, options.apiPath);
  }
  return async (request) => {
    if (request.method !== 'POST')
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    let validated: ReturnType<typeof validateInput>;
    try {
      validated = validateInput(await readInput(request));
    } catch (error) {
      return json(
        {
          error: error instanceof AgentError ? error.message : 'Invalid agent input.',
          code: error instanceof AgentError ? error.code : 'INVALID_INPUT',
        },
        error instanceof AgentError && error.code === 'INPUT_TOO_LARGE' ? 413 : 400,
      );
    }
    const { input, validators } = validated;
    const abortController = new AbortController();
    const abortRequest = () => abortController.abort(request.signal.reason);
    request.signal.addEventListener('abort', abortRequest, { once: true });
    if (request.signal.aborted) abortRequest();
    let cancelled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abortController.abort(new Error('Agent timeout'));
    }, timeoutMs);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = (event: AGUIEvent) => {
          if (!cancelled) controller.enqueue(new TextEncoder().encode(encodeSSE(event)));
        };
        void (async () => {
          emit({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId });
          try {
            abortController.signal.throwIfAborted();
            if (mode === 'demo') runDemo(input, validators, emit);
            else
              await streamCompletion(
                options as OpenAIOptions,
                input,
                validators,
                emit,
                abortController.signal,
              );
            abortController.signal.throwIfAborted();
            emit({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId });
          } catch (error) {
            const message = timedOut
              ? 'The model request timed out. Please retry.'
              : abortController.signal.aborted
                ? 'The agent run was cancelled.'
                : error instanceof AgentError
                  ? error.message
                  : 'Unable to reach or read the model provider. Check the server configuration and try again.';
            const code = timedOut
              ? 'TIMEOUT'
              : abortController.signal.aborted
                ? 'CANCELLED'
                : error instanceof AgentError
                  ? error.code
                  : 'PROVIDER_CONNECTION_ERROR';
            emit({ type: EventType.RUN_ERROR, message, code });
          } finally {
            clearTimeout(timer);
            request.signal.removeEventListener('abort', abortRequest);
            if (!cancelled) controller.close();
          }
        })();
      },
      cancel(reason) {
        cancelled = true;
        abortController.abort(reason);
      },
    });
    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  };
}
