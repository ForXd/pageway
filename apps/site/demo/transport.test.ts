import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserDemoTransport } from './transport';

const endpoint = new URL('https://forxd.github.io/pageway/demo/local-agent');
const input = {
  threadId: 'demo-thread',
  runId: 'demo-run',
  messages: [{ id: 'user-1', role: 'user', content: 'Summarize this page' }],
  tools: [{ name: 'inspect_page', description: 'Read the page', parameters: { type: 'object' } }],
  context: [],
  state: { page: [{ id: 'workspace', title: 'Workspace', data: { tasks: [] } }] },
};
const requestInit = {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(input),
};

afterEach(() => vi.unstubAllGlobals());

describe('browser-local demo transport', () => {
  it('returns a real Agent SSE response under a project subpath without using network fetch', async () => {
    const network = vi.fn(() => Promise.reject(new Error('Network must not be used')));
    vi.stubGlobal('fetch', network);
    const transport = createBrowserDemoTransport(endpoint);
    const response = await transport('./local-agent', requestInit);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const stream = await response.text();
    expect(stream).toContain('RUN_STARTED');
    expect(stream).toContain('TOOL_CALL_START');
    expect(stream).toContain('inspect_page');
    expect(stream).toContain('RUN_FINISHED');
    expect(network).not.toHaveBeenCalled();
  });

  it('accepts Request inputs and preserves method and body validation', async () => {
    const transport = createBrowserDemoTransport(endpoint);
    const response = await transport(new Request(endpoint, requestInit));
    expect(response.status).toBe(200);
    await response.body?.cancel();
    expect((await transport(endpoint)).status).toBe(405);
    expect((await transport(endpoint, { ...requestInit, body: '{"invalid":true}' })).status).toBe(
      400,
    );
  });

  it('rejects other destinations instead of forwarding page data to a remote service', async () => {
    const transport = createBrowserDemoTransport(endpoint);
    await expect(transport('https://example.com/agent', requestInit)).rejects.toThrow(
      'only handles its local agent endpoint',
    );
    await expect(transport('../other-agent', requestInit)).rejects.toThrow(
      'only handles its local agent endpoint',
    );
  });

  it('preserves cancellation for Request and init signals', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Stopped demo', 'AbortError'));
    const transport = createBrowserDemoTransport(endpoint);
    await expect(
      transport(endpoint, { ...requestInit, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError', message: 'Stopped demo' });
    await expect(
      transport(new Request(endpoint, { ...requestInit, signal: controller.signal })),
    ).rejects.toMatchObject({ name: 'AbortError', message: 'Stopped demo' });
  });
});
