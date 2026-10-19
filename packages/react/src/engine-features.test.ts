import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeSSE } from '@zllling/pageway-protocol';
import { PagewayEngine } from './engine.js';
import type { PageTool } from './types.js';

const tool = (execute: PageTool['execute'] = ({ value }) => ({ value })): PageTool => ({
  name: 'set_value',
  description: 'Set value',
  parameters: {
    type: 'object',
    properties: { value: { type: 'number' } },
    required: ['value'],
    additionalProperties: false,
  },
  execute,
});
function storage() {
  const entries = new Map<string, string>();
  const localStorage = {
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      entries.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      entries.delete(key);
    }),
  };
  vi.stubGlobal('window', { localStorage });
  return localStorage;
}
function client(tools: PageTool[] = [tool()]) {
  const requests: { threadId: string; runId: string; messages: unknown[] }[] = [];
  const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    return new Response(
      [
        { type: 'RUN_STARTED', threadId: request.threadId, runId: request.runId },
        { type: 'TEXT_MESSAGE_START', messageId: `reply-${requests.length}`, role: 'assistant' },
        {
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: `reply-${requests.length}`,
          delta: 'Confirmed.',
        },
        { type: 'TEXT_MESSAGE_END', messageId: `reply-${requests.length}` },
        { type: 'RUN_FINISHED', threadId: request.threadId, runId: request.runId },
      ]
        .map((event) => encodeSSE(event as never))
        .join(''),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  return {
    engine: new PagewayEngine({
      endpoint: '/agent',
      getTools: () => tools,
      getContexts: () => [],
      fetch: fetcher,
    }),
    requests,
    fetcher,
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('shared tool execution and session lifecycle', () => {
  it('executes external tools without a model endpoint and keeps them out of chat history', async () => {
    const execute = vi.fn(({ value }) => ({ value }));
    const engine = new PagewayEngine({ getTools: () => [tool(execute)], getContexts: () => [] });
    expect(await engine.executeTool('set_value', { value: 7 })).toEqual({
      ok: true,
      result: { value: 7 },
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(engine.getSnapshot()).toMatchObject({
      status: 'idle',
      messages: [],
      actions: [{ source: 'webmcp', status: 'success', result: { value: 7 } }],
    });
    expect(await engine.executeTool('set_value', { value: 'bad' })).toMatchObject({ ok: false });
    expect(await engine.executeTool('unknown', {})).toMatchObject({ ok: false });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('serializes external and chat tasks and propagates external cancellation', async () => {
    let signal: AbortSignal | undefined;
    const execute = vi.fn((_args, context) => {
      signal = context.signal;
      return new Promise(() => {});
    });
    const { engine, fetcher } = client([tool(execute)]);
    const external = new AbortController();
    const task = engine.executeTool('set_value', { value: 2 }, external.signal);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    expect(engine.getSnapshot().status).toBe('running');
    expect(await engine.executeTool('set_value', { value: 9 })).toMatchObject({
      ok: false,
      error: expect.stringContaining('already running'),
    });
    await engine.sendMessage('Conflicting request');
    expect(fetcher).not.toHaveBeenCalled();
    external.abort();
    expect(await task).toMatchObject({ ok: false, error: expect.stringContaining('Cancelled') });
    expect(signal?.aborted).toBe(true);
    expect(engine.getSnapshot()).toMatchObject({
      status: 'idle',
      actions: [{ status: 'cancelled' }],
    });
  });

  it('reset cancels external tasks and ignores their late resolution', async () => {
    let resolve!: (value: unknown) => void;
    const execute = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { engine } = client([tool(execute)]);
    const task = engine.executeTool('set_value', { value: 2 });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    engine.reset();
    resolve({ value: 2 });
    await task;
    expect(engine.getSnapshot()).toMatchObject({ status: 'idle', messages: [], actions: [] });
  });

  it('rejects pre-cancelled and non-serializable external input before starting', async () => {
    const { engine } = client();
    const signal = AbortSignal.abort();
    expect(await engine.executeTool('set_value', {}, signal)).toMatchObject({ ok: false });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(await engine.executeTool('set_value', cycle)).toMatchObject({ ok: false });
    expect(await engine.executeTool('set_value', { value: 'x'.repeat(200_001) })).toMatchObject({
      ok: false,
    });
    expect(engine.getSnapshot().actions).toEqual([]);
  });

  it('restores settled conversation and external actions without executing or requesting again', async () => {
    const local = storage();
    const first = client();
    first.engine.configureSession('pageway:user:a');
    await first.engine.sendMessage('Remember this');
    await first.engine.executeTool('set_value', { value: 4 });
    expect(local.setItem).toHaveBeenCalledTimes(2);
    const callback = vi.fn();
    const second = client([tool(callback)]);
    second.engine.configureSession('pageway:user:a');
    expect(second.engine.getSnapshot()).toMatchObject({
      status: 'idle',
      messages: [{ content: 'Remember this' }, { content: 'Confirmed.' }],
      actions: [{ source: 'webmcp', status: 'success' }],
    });
    expect(second.fetcher).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    await second.engine.sendMessage('Continue');
    expect(second.requests[0].threadId).toBe(first.requests[0].threadId);
    expect(second.requests[0].messages).toHaveLength(3);
    second.engine.reset();
    expect(local.getItem('pageway:user:a')).toBeNull();
    expect(second.engine.getSnapshot().messages).toEqual([]);
  });

  it('switching identities isolates history and cancels running tools', async () => {
    storage();
    const execute = vi.fn(() => new Promise(() => {}));
    const { engine } = client([tool(execute)]);
    engine.configureSession('alice');
    await engine.sendMessage('Alice only');
    const task = engine.executeTool('set_value', { value: 3 });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    engine.configureSession('bob');
    await task;
    expect(engine.getSnapshot()).toMatchObject({ messages: [], actions: [], status: 'idle' });
    engine.configureSession('alice');
    expect(engine.getSnapshot().messages[0].content).toBe('Alice only');
    expect(engine.getSnapshot().actions[0].status).toBe('cancelled');
  });

  it('has no storage side effects unless explicitly enabled', async () => {
    const local = storage();
    const { engine } = client();
    await engine.sendMessage('No persistence');
    engine.reset();
    expect(local.setItem).not.toHaveBeenCalled();
    expect(local.removeItem).not.toHaveBeenCalled();
    expect(local.getItem).not.toHaveBeenCalled();
  });
});
