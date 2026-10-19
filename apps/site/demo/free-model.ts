// The public demo uses the provider's anonymous model, never a visitor or build-time key.
export const FREE_MODEL_API_ORIGIN = 'https://text.pollinations.ai/v1';
export const FREE_MODEL = 'openai-fast';
export const FREE_MODEL_ENDPOINT = `${FREE_MODEL_API_ORIGIN}/chat/completions`;

function retryDelay(value: string | null): number | undefined {
  if (!value) return;
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - Date.now()) / 1_000;
  // Honor short provider cooldowns, with bounded retries inside the SDK's overall timeout.
  if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 60)
    return Math.max(1_000, seconds * 1_000) + 250;
}

function waitForQuota(delay: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export const anonymousModelFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  request.signal.throwIfAborted();
  if (request.url !== FREE_MODEL_ENDPOINT || request.method !== 'POST')
    throw new Error('The public demo only calls its anonymous model endpoint.');
  if (request.headers.has('Authorization') || request.headers.has('X-API-Key'))
    throw new Error('The public demo does not accept model credentials.');
  const body = (await request.clone().json()) as { model?: unknown };
  if (body.model !== FREE_MODEL)
    throw new Error('The public demo only supports its anonymous model.');
  for (let attempt = 0; ; attempt += 1) {
    request.signal.throwIfAborted();
    const response = await globalThis.fetch(request.clone(), {
      credentials: 'omit',
      redirect: 'error',
    });
    const delay = retryDelay(response.headers.get('Retry-After'));
    if (attempt >= 2 || ![402, 429].includes(response.status) || delay === undefined)
      return response;
    await response.body?.cancel();
    await waitForQuota(delay, request.signal);
  }
};
