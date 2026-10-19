import { describe, expect, it, vi } from 'vitest';
import { createOpenAIProxyHandler } from '../src/index.js';

const body = { model: 'fixture', stream: true, messages: [{ role: 'user', content: 'Hello' }] };
const request = (value: unknown = body, signal?: AbortSignal) =>
  new Request('https://app.test/api/openai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer browser-session',
      'X-Upstream': 'https://untrusted.test',
    },
    body: JSON.stringify(value),
    signal,
  });
const defaults = {
  baseURL: 'https://provider.test/v1',
  apiKey: 'server-secret',
  allowedModels: ['fixture'],
};

describe('OpenAI credential proxy', () => {
  it('forwards completion JSON and SSE bytes, injecting only its server credential', async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n';
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(sse, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Set-Cookie': 'provider-session=private',
            'X-Provider-Key': 'server-secret',
          },
        }),
    );
    const completion = {
      ...body,
      tools: [
        { type: 'function', function: { name: 'change_page', parameters: { type: 'object' } } },
      ],
      temperature: 0.2,
      max_tokens: 128,
    };
    const result = await createOpenAIProxyHandler({ ...defaults, fetch: fetcher })(
      request(completion),
    );
    expect(result.status).toBe(200);
    expect(await result.text()).toBe(sse);
    expect(result.headers.get('content-type')).toBe('text/event-stream');
    expect(result.headers.has('set-cookie')).toBe(false);
    expect(result.headers.has('x-provider-key')).toBe(false);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://provider.test/v1/chat/completions');
    expect(JSON.parse(String(init?.body))).toEqual(completion);
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer server-secret');
    expect(headers.has('x-upstream')).toBe(false);
    expect(init?.redirect).toBe('error');
  });

  it('supports ordinary non-streaming responses and anonymous upstreams', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ choices: [{ message: { role: 'assistant', content: 'Hi' } }] }),
    );
    const result = await createOpenAIProxyHandler({
      baseURL: 'https://provider.test/custom',
      apiPath: 'complete',
      fetch: fetcher,
    })(request({ ...body, stream: false }));
    expect(await result.json()).toMatchObject({ choices: [{ message: { content: 'Hi' } }] });
    expect(fetcher.mock.calls[0]![0]).toBe('https://provider.test/custom/complete');
    expect(new Headers(fetcher.mock.calls[0]![1]?.headers).has('authorization')).toBe(false);
  });

  it.each([
    [{}, 400],
    [{ ...body, model: 'other-model' }, 400],
    [{ ...body, messages: [] }, 400],
    [{ ...body, stream: 'yes' }, 400],
    [{ ...body, model: '' }, 400],
  ])(
    'rejects invalid or unapproved requests without contacting the provider: %j',
    async (value, status) => {
      const fetcher = vi.fn<typeof fetch>();
      const result = await createOpenAIProxyHandler({ ...defaults, fetch: fetcher })(
        request(value),
      );
      expect(result.status).toBe(status);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('enforces method, content type, JSON and byte limits before forwarding', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const handler = createOpenAIProxyHandler({ ...defaults, fetch: fetcher, maxBodyBytes: 200 });
    const get = await handler(new Request('https://app.test/api'));
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    const text = await handler(
      new Request('https://app.test/api', { method: 'POST', body: 'text' }),
    );
    expect(text.status).toBe(400);
    const invalid = await handler(
      new Request('https://app.test/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }),
    );
    expect(invalid.status).toBe(400);
    const large = await handler(
      request({ ...body, messages: [{ role: 'user', content: '你好'.repeat(100) }] }),
    );
    expect(large.status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns safe provider failures without exposing response bodies or credentials', async () => {
    const handler = createOpenAIProxyHandler({
      ...defaults,
      fetch: async () => new Response('server-secret private account data', { status: 429 }),
    });
    const result = await handler(request());
    expect(result.status).toBe(429);
    const text = await result.text();
    expect(text).toContain('HTTP 429');
    expect(text).not.toContain('server-secret');
    expect(text).not.toContain('private account');
    const failed = await createOpenAIProxyHandler({
      ...defaults,
      fetch: async () => {
        throw new Error('server-secret');
      },
    })(request());
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain('server-secret');
  });

  it('bounds the entire response lifetime and cancels stalled streams', async () => {
    let signal: AbortSignal | null | undefined;
    const cancelled = vi.fn();
    const response = await createOpenAIProxyHandler({
      ...defaults,
      timeoutMs: 10,
      fetch: async (_url, init) => {
        signal = init?.signal;
        return new Response(new ReadableStream({ cancel: cancelled }), {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      },
    })(request());
    await expect(response.text()).rejects.toThrow('timed out');
    expect(signal?.aborted).toBe(true);
    expect(cancelled).toHaveBeenCalled();
  });

  it('aborts upstream work when a client aborts or cancels its response body', async () => {
    const controller = new AbortController();
    const signals: (AbortSignal | null | undefined)[] = [];
    const handler = createOpenAIProxyHandler({
      ...defaults,
      fetch: async (_url, init) => {
        signals.push(init?.signal);
        return new Response(new ReadableStream());
      },
    });
    const result = await handler(request(body, controller.signal));
    controller.abort();
    await expect(result.text()).rejects.toThrow('cancelled');
    expect(signals[0]?.aborted).toBe(true);
    const second = await handler(request());
    await second.body!.cancel();
    expect(signals[1]?.aborted).toBe(true);
    const preAborted = await handler(request(body, controller.signal));
    expect(preAborted.status).toBe(499);
    expect(signals).toHaveLength(2);
  });

  it('handles request cancellation and timeouts before provider headers arrive', async () => {
    const fetcher: typeof fetch = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true });
      });
    const timedOut = await createOpenAIProxyHandler({ ...defaults, fetch: fetcher, timeoutMs: 10 })(
      request(),
    );
    expect(timedOut.status).toBe(504);
    const controller = new AbortController();
    const pending = createOpenAIProxyHandler({ ...defaults, fetch: fetcher })(
      request(body, controller.signal),
    );
    setTimeout(() => controller.abort(), 5);
    expect((await pending).status).toBe(499);
  });

  it('handles upstream empty bodies and stream failures', async () => {
    const empty = await createOpenAIProxyHandler({
      ...defaults,
      fetch: async () => new Response(null, { status: 204 }),
    })(request());
    expect(empty.status).toBe(204);
    const broken = await createOpenAIProxyHandler({
      ...defaults,
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('private diagnostics'));
            },
          }),
        ),
    })(request());
    await expect(broken.text()).rejects.toThrow('Unable to read the model response.');
  });

  it.each([
    { baseURL: 'file:///tmp' },
    { baseURL: 'https://user:key@provider.test' },
    { baseURL: 'https://provider.test/v1', apiPath: '../other' },
    { baseURL: 'https://provider.test/v1', apiPath: 'https://other.test' },
    { baseURL: 'https://provider.test/v1', timeoutMs: 0 },
    { baseURL: 'https://provider.test/v1', maxBodyBytes: 0 },
  ])('rejects invalid handler configuration: %j', (options) => {
    expect(() => createOpenAIProxyHandler(options)).toThrow();
  });
});
