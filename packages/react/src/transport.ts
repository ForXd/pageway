import { createAgentHandler } from '@zllling/pageway-agent';
import type { RunAgentInput } from '@zllling/pageway-protocol';

export interface AgentTransportOptions {
  endpoint?: string;
  apiOrigin?: string;
  apiPath?: string;
  model?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
}

/** Both public transports produce the same validated AG-UI event stream. */
export async function requestAgentRound(
  options: AgentTransportOptions,
  input: RunAgentInput,
  signal: AbortSignal,
): Promise<Response> {
  signal.throwIfAborted();
  if (options.endpoint && options.apiOrigin)
    throw new Error('Configure either endpoint or apiOrigin, not both.');
  if (options.apiOrigin !== undefined) {
    if (!options.apiOrigin.trim() || !options.model?.trim())
      throw new Error('apiOrigin requires a non-empty API origin and model.');
    const relative = options.apiOrigin.startsWith('/') && !options.apiOrigin.startsWith('//');
    if (relative && typeof globalThis.location === 'undefined')
      throw new Error('A relative apiOrigin requires a browser location.');
    const baseURL = relative
      ? new URL(options.apiOrigin, globalThis.location.href).toString()
      : options.apiOrigin;
    const handler = createAgentHandler({
      mode: 'openai',
      baseURL,
      apiPath: options.apiPath,
      model: options.model,
      timeoutMs: options.timeoutMs ?? 180_000,
      headers: options.headers,
      fetch: options.fetch,
    });
    // This request is handled in memory: only the ordinary OpenAI completion is sent over HTTP.
    return handler(
      new Request('https://pageway.invalid/internal-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal,
      }),
    );
  }
  if (!options.endpoint?.trim())
    throw new Error('Chat requires either an AG-UI endpoint or an apiOrigin and model.');
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'text/event-stream');
  return (options.fetch ?? globalThis.fetch)(options.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
    signal,
  });
}
