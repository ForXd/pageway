import { createAgentHandler, getAgentStatus, type AgentOptions } from '@zllling/pageway-agent';

export interface ServerOptions extends AgentOptions {
  allowedOrigins?: string[];
}

export function createApp(options: ServerOptions = {}): (request: Request) => Promise<Response> {
  const handler = createAgentHandler(options);
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
      cors.set('Access-Control-Allow-Headers', 'Content-Type');
      cors.set('Access-Control-Max-Age', '600');
      response = new Response(null, { status: 204 });
    } else if (url.pathname === '/api/health' && request.method === 'GET') {
      response = Response.json({
        ok: true,
        ...getAgentStatus(options),
        protocol: 'AG-UI 1.0',
        toolExecution: 'frontend',
      });
    } else if (url.pathname === '/api/agent') {
      response = await handler(request);
    } else {
      response = Response.json({ error: 'Not found.' }, { status: 404 });
    }
    for (const [name, value] of cors) response.headers.set(name, value);
    return response;
  };
}
