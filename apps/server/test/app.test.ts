import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('server boundary', () => {
  it('reports truthful demo health and enables local CORS', async () => {
    const response = await createApp()(
      new Request('http://localhost:3001/api/health', {
        headers: { Origin: 'http://localhost:5173' },
      }),
    );
    expect(await response.json()).toMatchObject({
      ok: true,
      mode: 'demo',
      model: 'deterministic-demo',
      provider: 'local',
      toolExecution: 'frontend',
    });
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('rejects an unrelated origin and only permits configured origins', async () => {
    const app = createApp({ allowedOrigins: ['https://app.example.com'] });
    expect(
      (
        await app(
          new Request('http://localhost/api/health', {
            headers: { Origin: 'https://other.example.com' },
          }),
        )
      ).status,
    ).toBe(403);
    const accepted = await app(
      new Request('http://localhost/api/agent', {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.example.com' },
      }),
    );
    expect(accepted.status).toBe(204);
    expect(accepted.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
  });

  it('does not expose configured keys through health', async () => {
    const response = await createApp({
      mode: 'openai',
      baseURL: 'https://api.example.com/v1',
      apiKey: 'private-key',
      model: 'example',
    })(new Request('http://localhost/api/health'));
    const text = await response.text();
    expect(text).not.toContain('private-key');
    expect(JSON.parse(text)).toMatchObject({
      mode: 'openai',
      provider: 'api.example.com',
      model: 'example',
      configured: true,
    });
  });
});

describe('HTTP routing and response contract', () => {
  it('serves a standard completion proxy without requiring the AG-UI endpoint', async () => {
    const app = createApp({
      mode: 'proxy',
      baseURL: 'https://provider.test/v1',
      model: 'fixture',
      apiKey: 'server-secret',
      fetch: async () =>
        new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }),
    });
    const health = await app(new Request('http://localhost/api/health'));
    expect(await health.json()).toMatchObject({
      mode: 'proxy',
      model: 'fixture',
      protocol: 'OpenAI Chat Completions',
      configured: true,
    });
    const response = await app(
      new Request('http://localhost/api/openai/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({
          model: 'fixture',
          stream: true,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('data: [DONE]\n\n');
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect((await app(new Request('http://localhost/api/agent'))).status).toBe(404);
    const preflight = await app(
      new Request('http://localhost/api/openai/chat/completions', {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173' },
      }),
    );
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(() => createApp({ mode: 'proxy' })).toThrow('requires baseURL');
  });

  it('keeps CORS headers on not-found and agent validation responses', async () => {
    const app = createApp();
    const headers = { Origin: 'http://localhost:5173' };
    const missing = await app(new Request('http://localhost/missing', { headers }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Not found.' });
    const wrongMethod = await app(new Request('http://localhost/api/agent', { headers }));
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('POST');
    for (const response of [missing, wrongMethod]) {
      expect(response.headers.get('vary')).toBe('Origin');
      expect(response.headers.get('access-control-allow-origin')).toBe(headers.Origin);
    }
  });

  it('forwards a real AG-UI run and reports malformed requests as JSON', async () => {
    const app = createApp();
    const response = await app(
      new Request('http://localhost/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: 't',
          runId: 'r',
          messages: [{ id: 'u', role: 'user', content: 'Hello' }],
          tools: [],
          context: [],
          state: {},
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const body = await response.text();
    expect(body).toContain('RUN_STARTED');
    expect(body).toContain('RUN_FINISHED');
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
    const invalid = await app(
      new Request('http://localhost/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'INVALID_INPUT' });
  });
});
