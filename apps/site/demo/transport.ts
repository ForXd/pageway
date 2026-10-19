import { createAgentHandler } from '@zllling/pageway-agent';

/** Keep the actual AG-UI request/stream/continuation contract, without a network call. */
export function createBrowserDemoTransport(endpoint: URL): typeof globalThis.fetch {
  const handle = createAgentHandler({ mode: 'demo' });
  const endpointURL = endpoint.href;
  return async (input, init) => {
    const source = typeof input === 'string' ? new URL(input, endpointURL) : input;
    const request = new Request(source, init);
    request.signal.throwIfAborted();
    if (request.url !== endpointURL)
      throw new Error('The browser demo transport only handles its local agent endpoint.');
    const response = await handle(request);
    request.signal.throwIfAborted();
    return response;
  };
}
