import {
  createAgentHandler,
  createOpenAIProxyHandler,
  getAgentStatus,
  type AgentOptions,
} from '@zllling/pageway-agent';

export interface ServerOptions extends Omit<AgentOptions, 'mode'> {
  mode?: 'demo' | 'openai' | 'proxy';
  allowedOrigins?: string[];
}

export function createApp(options: ServerOptions = {}): (request: Request) => Promise<Response> {
  if (options.mode !== undefined && !['demo', 'openai', 'proxy'].includes(options.mode))
    throw new Error('mode must be demo, openai or proxy.');
  const proxy = options.mode === 'proxy';
  const baseURL = options.baseURL ?? '';
  if (proxy && !baseURL) throw new Error('Proxy mode requires baseURL.');
  const handler = proxy
    ? createOpenAIProxyHandler({
        baseURL,
        apiPath: options.apiPath,
        apiKey: options.apiKey,
        ...(options.model ? { allowedModels: [options.model] } : {}),
        timeoutMs: options.timeoutMs,
        fetch: options.fetch,
      })
    : createAgentHandler({ ...options, mode: options.mode === 'openai' ? 'openai' : 'demo' });
  const origins = new Set(
    options.allowedOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'],
  );
  return async (request) => {
    const origin = request.headers.get('origin');
    if (origin && !origins.has(origin))
      return Response.json({ error: 'Origin is not allowed.' }, { status: 403 });
    const cors = new Headers({
      Vary: 'Origin',
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    });
    const url = new URL(request.url);
    let response: Response;
    if (request.method === 'OPTIONS') {
      cors.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      cors.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      cors.set('Access-Control-Max-Age', '600');
      response = new Response(null, { status: 204 });
    } else if (url.pathname === '/api/health' && request.method === 'GET') {
      response = Response.json({
        ok: true,
        ...(proxy
          ? {
              mode: 'proxy',
              model: options.model ?? '',
              provider: new URL(baseURL).host,
              configured: true,
              note: 'OpenAI-compatible credential proxy; planning and tool execution run in the browser.',
            }
          : getAgentStatus({ ...options, mode: options.mode === 'openai' ? 'openai' : 'demo' })),
        protocol: proxy ? 'OpenAI Chat Completions' : 'AG-UI 1.0',
        toolExecution: 'frontend',
      });
    } else if (url.pathname === (proxy ? '/api/openai/chat/completions' : '/api/agent')) {
      response = await handler(request);
    } else {
      response = Response.json({ error: 'Not found.' }, { status: 404 });
    }
    for (const [name, value] of cors) response.headers.set(name, value);
    return response;
  };
}
