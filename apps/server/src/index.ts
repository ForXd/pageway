import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createApp, type ServerOptions } from './app.js';

// Resolve .env from the monorepo root for both src and dist invocations.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const mode = process.env.AGENT_MODE ?? 'demo';
if (mode !== 'demo' && mode !== 'openai' && mode !== 'proxy')
  throw new Error('AGENT_MODE must be demo, openai or proxy.');
const options: ServerOptions = {
  mode,
  baseURL: process.env.MODEL_BASE_URL,
  apiPath: process.env.MODEL_API_PATH,
  apiKey: process.env.MODEL_API_KEY,
  model: process.env.MODEL_NAME,
  timeoutMs: Number(process.env.AGENT_TIMEOUT_MS ?? 45_000),
};
const app = createApp({
  ...options,
  ...(process.env.ALLOWED_ORIGINS
    ? {
        allowedOrigins: process.env.ALLOWED_ORIGINS.split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      }
    : {}),
});
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be a valid TCP port.');
const host = process.env.HOST ?? '127.0.0.1';

const server = createServer(async (incoming, outgoing) => {
  const abortController = new AbortController();
  outgoing.on('close', () => {
    if (!outgoing.writableEnded) abortController.abort();
  });
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value))
      value.forEach((item) => {
        headers.append(name, item);
      });
    else if (value !== undefined) headers.set(name, value);
  }
  const method = incoming.method ?? 'GET';
  try {
    const body = ['GET', 'HEAD'].includes(method)
      ? undefined
      : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
    const init: RequestInit & { duplex?: 'half' } = {
      method,
      headers,
      signal: abortController.signal,
      ...(body ? { body, duplex: 'half' } : {}),
    };
    const request = new Request(`http://localhost:${port}${incoming.url ?? '/'}`, init);
    const response = await app(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) {
      outgoing.end();
      return;
    }
    const stream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
    stream.on('error', () => outgoing.destroy());
    stream.pipe(outgoing);
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'application/json' });
    outgoing.end(JSON.stringify({ error: 'Unable to handle request.' }));
  }
});
server.requestTimeout = 60_000;
server.listen(port, host, () =>
  console.log(
    `Pageway agent listening at http://${host}:${port} (${mode}${mode === 'demo' ? ': deterministic planner, no model' : ': OpenAI-compatible model'})`,
  ),
);

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
