import { afterEach, describe, expect, it, vi } from 'vitest';
import { anonymousModelFetch, FREE_MODEL, FREE_MODEL_ENDPOINT } from './free-model';

const init = {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: FREE_MODEL, stream: true, messages: [] }),
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('public anonymous model transport', () => {
  it('forwards the standard request without cookies and preserves the response stream', async () => {
    const response = new Response('data: [DONE]\n\n');
    const network = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', network);
    expect(await anonymousModelFetch(FREE_MODEL_ENDPOINT, init)).toBe(response);
    const [request, options] = network.mock.calls[0]!;
    expect(request.url).toBe(FREE_MODEL_ENDPOINT);
    expect(request.headers.has('Authorization')).toBe(false);
    expect(await request.json()).toEqual(JSON.parse(init.body));
    expect(options).toEqual({ credentials: 'omit', redirect: 'error' });
  });

  it('rejects credentials, other models and destinations before sending page data', async () => {
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    await expect(anonymousModelFetch('https://example.com/chat/completions', init)).rejects.toThrow(
      'anonymous model endpoint',
    );
    await expect(anonymousModelFetch(FREE_MODEL_ENDPOINT)).rejects.toThrow(
      'anonymous model endpoint',
    );
    await expect(
      anonymousModelFetch(FREE_MODEL_ENDPOINT, {
        ...init,
        headers: { Authorization: 'Bearer test' },
      }),
    ).rejects.toThrow('credentials');
    await expect(
      anonymousModelFetch(FREE_MODEL_ENDPOINT, { ...init, headers: { 'X-API-Key': 'test' } }),
    ).rejects.toThrow('credentials');
    await expect(
      anonymousModelFetch(FREE_MODEL_ENDPOINT, {
        ...init,
        body: JSON.stringify({ model: 'paid' }),
      }),
    ).rejects.toThrow('anonymous model');
    expect(network).not.toHaveBeenCalled();
  });

  it('honors the free-tier Retry-After header and retries the identical request at most twice', async () => {
    vi.useFakeTimers();
    const network = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('quota', { status: 402, headers: { 'Retry-After': '30' } })),
    );
    vi.stubGlobal('fetch', network);
    const result = anonymousModelFetch(FREE_MODEL_ENDPOINT, init);
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(network).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(30_250);
    expect((await result).status).toBe(402);
    expect(network).toHaveBeenCalledTimes(3);
    for (const [request] of network.mock.calls)
      expect(await (request as Request).json()).toEqual(JSON.parse(init.body));
  });

  it('stops immediately during a quota wait without retrying', async () => {
    vi.useFakeTimers();
    const network = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('quota', { status: 429, headers: { 'Retry-After': '30' } })),
    );
    vi.stubGlobal('fetch', network);
    const controller = new AbortController();
    const result = anonymousModelFetch(FREE_MODEL_ENDPOINT, { ...init, signal: controller.signal });
    const aborted = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await aborted;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it.each([null, 'bad', '99999', '-1'])(
    'returns a quota error with unsupported Retry-After %s instead of retrying indefinitely',
    async (value) => {
      const response = new Response('quota', {
        status: 429,
        headers: value ? { 'Retry-After': value } : {},
      });
      const network = vi.fn().mockResolvedValue(response);
      vi.stubGlobal('fetch', network);
      expect(await anonymousModelFetch(FREE_MODEL_ENDPOINT, init)).toBe(response);
      expect(network).toHaveBeenCalledTimes(1);
    },
  );
});
