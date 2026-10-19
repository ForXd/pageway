import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWebMCPBridge,
  type WebMCPBridge,
  type WebMCPBridgeOptions,
  type WebMCPToolResult,
} from '../src/webmcp.js';
import type { PageContext, PageTool } from '../src/types.js';

interface BrowserTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint: boolean };
  execute: (args: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function currentContext() {
  const tools = new Map<string, BrowserTool>();
  const context = {
    registerTool: vi.fn((tool: BrowserTool, options?: { signal: AbortSignal }) => {
      if (tools.has(tool.name)) return Promise.reject(new Error('Tool already exists'));
      if (options?.signal.aborted) return Promise.reject(new Error('Already aborted'));
      tools.set(tool.name, tool);
      options?.signal.addEventListener('abort', () => tools.delete(tool.name), { once: true });
      return Promise.resolve();
    }),
  };
  vi.stubGlobal('document', { modelContext: context });
  return { context, tools };
}

function legacyContext() {
  const tools = new Map<string, BrowserTool>();
  const context = {
    registerTool: vi.fn((tool: BrowserTool): void | Promise<void> => {
      if (tools.has(tool.name)) throw new Error('Tool already exists');
      tools.set(tool.name, tool);
    }),
    unregisterTool: vi.fn((name: string) => {
      tools.delete(name);
    }),
  };
  vi.stubGlobal('navigator', { modelContext: context });
  return { context, tools };
}

function pageTool(name = 'update_task'): PageTool {
  return {
    name,
    description: 'Update a task',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    execute: () => {
      throw new Error('The bridge must use the shared Pageway executor');
    },
  };
}

const bridges: WebMCPBridge[] = [];
function bridge(overrides: Partial<WebMCPBridgeOptions> = {}) {
  const executeTool = vi.fn<WebMCPBridgeOptions['executeTool']>(async () => ({
    ok: true,
    result: { updated: true },
  }));
  const onChange = vi.fn();
  const instance = createWebMCPBridge({
    getTools: () => [pageTool()],
    getContexts: () => [],
    executeTool,
    onChange,
    ...overrides,
  });
  bridges.push(instance);
  return { instance, executeTool, onChange };
}

async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  for (const instance of bridges.splice(0)) instance.dispose();
  vi.unstubAllGlobals();
});

describe('WebMCP bridge', () => {
  it('reports unsupported in SSR and browsers without a usable native API', () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('navigator', undefined);
    const server = bridge();
    expect(server.instance.getSnapshot()).toEqual({
      status: 'unsupported',
      registered: [],
      error: null,
    });
    vi.stubGlobal('navigator', { modelContext: { registerTool: vi.fn() } });
    expect(bridge().instance.getSnapshot().status).toBe('unsupported');
    expect(navigator).not.toHaveProperty('modelContext.unregisterTool');
  });

  it('prefers the document API and exposes schemas, shared execution and fresh context', async () => {
    const old = legacyContext();
    const { context, tools } = currentContext();
    let page: PageContext[] = [{ id: 'tasks', title: 'Tasks', data: { count: 1 } }];
    const { instance, executeTool } = bridge({ getContexts: () => page });
    expect(instance.getSnapshot().status).toBe('registering');
    await settled();
    expect(instance.getSnapshot()).toEqual({
      status: 'ready',
      registered: ['pageway_get_context', 'pageway_update_task'],
      error: null,
    });
    expect(old.context.registerTool).not.toHaveBeenCalled();
    expect(tools.get('pageway_update_task')?.inputSchema).toEqual(pageTool().parameters);
    expect(tools.get('pageway_get_context')?.annotations).toEqual({ readOnlyHint: true });
    expect(context.registerTool.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    const result = await tools.get('pageway_update_task')!.execute({ id: 'PW-103' });
    expect(result).toEqual({ ok: true, result: { updated: true } });
    expect(executeTool).toHaveBeenCalledWith(
      'update_task',
      { id: 'PW-103' },
      expect.any(AbortSignal),
    );
    page = [{ id: 'tasks', title: 'Tasks', data: { count: 2 } }];
    expect(await tools.get('pageway_get_context')!.execute({})).toEqual({
      ok: true,
      result: { page },
    });
  });

  it('refreshes changed metadata, removes unmounted tools and leaves foreign tools intact', async () => {
    const { context, tools } = currentContext();
    const foreign = { ...pageTool('foreign'), inputSchema: {}, execute: async () => null };
    tools.set('foreign', foreign);
    let registeredTools = [pageTool()];
    const { instance, executeTool } = bridge({ getTools: () => registeredTools });
    await settled();
    const old = tools.get('pageway_update_task')!;
    instance.sync();
    await settled();
    expect(context.registerTool).toHaveBeenCalledTimes(2);
    registeredTools = [{ ...pageTool(), description: 'Updated description', parameters: {} }];
    instance.sync();
    await settled();
    expect(tools.get('pageway_update_task')).toMatchObject({
      description: 'Updated description',
      inputSchema: {},
    });
    expect(await old.execute({})).toMatchObject({ ok: false });
    expect(executeTool).not.toHaveBeenCalled();
    registeredTools = [];
    instance.sync();
    expect(tools.has('pageway_update_task')).toBe(false);
    instance.dispose();
    instance.dispose();
    instance.sync();
    expect([...tools.keys()]).toEqual(['foreign']);
    expect(instance.getSnapshot()).toEqual({ status: 'disabled', registered: [], error: null });
  });

  it('passes browser cancellation and provider disposal to running page tools', async () => {
    const { tools } = currentContext();
    let executionSignal: AbortSignal | undefined;
    const executeTool: WebMCPBridgeOptions['executeTool'] = async (_name, _args, signal) => {
      executionSignal = signal;
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({ ok: false, error: 'Cancelled' }), {
          once: true,
        });
      });
    };
    const { instance } = bridge({ executeTool });
    await settled();
    const controller = new AbortController();
    const first = tools.get('pageway_update_task')!.execute({}, { signal: controller.signal });
    controller.abort();
    expect(executionSignal?.aborted).toBe(true);
    expect(await first).toEqual({ ok: false, error: 'Cancelled' });
    const second = tools.get('pageway_update_task')!.execute({});
    instance.dispose();
    expect(executionSignal?.aborted).toBe(true);
    expect(await second).toEqual({ ok: false, error: 'Cancelled' });
  });

  it('does not cancel an in-flight invocation when metadata refreshes its registration', async () => {
    const { tools } = currentContext();
    const pending = deferred<WebMCPToolResult>();
    let current = [pageTool()];
    let executionSignal: AbortSignal | undefined;
    const { instance } = bridge({
      getTools: () => current,
      executeTool: async (_name, _args, signal) => {
        executionSignal = signal;
        return pending.promise;
      },
    });
    await settled();
    const invocation = tools.get('pageway_update_task')!.execute({});
    current = [{ ...pageTool(), description: 'New description', parameters: { type: 'object' } }];
    instance.sync();
    await settled();
    expect(executionSignal?.aborted).toBe(false);
    expect(tools.get('pageway_update_task')?.description).toBe('New description');
    pending.resolve({ ok: true, result: { complete: true } });
    expect(await invocation).toEqual({ ok: true, result: { complete: true } });
  });

  it.each([
    { surface: 'document', context: currentContext },
    { surface: 'navigator', context: legacyContext },
  ])(
    'cancels an active call when its tool is removed on the $surface API',
    async ({ context, surface }) => {
      const { tools } = context();
      let current = [pageTool()];
      let executionSignal: AbortSignal | undefined;
      const { instance } = bridge({
        getTools: () => current,
        executeTool: async (_name, _args, signal) => {
          executionSignal = signal;
          return new Promise((resolve) => {
            signal.addEventListener('abort', () => resolve({ ok: false, error: 'Tool removed' }), {
              once: true,
            });
          });
        },
      });
      await settled();
      const invocation = tools.get('pageway_update_task')!.execute({});
      // A metadata refresh changes the registration owner, but not the lifetime
      // of the capability that the original invocation is still using.
      current = [{ ...pageTool(), description: 'Still mounted' }];
      instance.sync();
      await settled();
      expect(executionSignal?.aborted).toBe(false);
      current = [];
      instance.sync();
      expect(executionSignal?.aborted).toBe(true);
      expect(tools.has('pageway_update_task')).toBe(false);
      expect(await invocation).toEqual(
        surface === 'document'
          ? { ok: false, error: 'Tool removed' }
          : {
              content: [{ type: 'text', text: '{"ok":false,"error":"Tool removed"}' }],
              isError: true,
            },
      );
    },
  );

  it('does not execute pre-cancelled browser requests and returns errors in the result channel', async () => {
    const { tools } = currentContext();
    const { executeTool } = bridge();
    await settled();
    const controller = new AbortController();
    controller.abort();
    expect(
      await tools.get('pageway_update_task')!.execute({}, { signal: controller.signal }),
    ).toEqual({
      ok: false,
      error: 'The Pageway tool call was cancelled.',
    });
    expect(executeTool).not.toHaveBeenCalled();
    executeTool.mockRejectedValueOnce(new Error('Application failure'));
    expect(await tools.get('pageway_update_task')!.execute({})).toEqual({
      ok: false,
      error: 'Application failure',
    });
    executeTool.mockResolvedValueOnce({ ok: true, result: undefined });
    expect(await tools.get('pageway_update_task')!.execute({})).toEqual({ ok: true, result: null });
    executeTool.mockResolvedValueOnce({ ok: true, result: 1n });
    expect(await tools.get('pageway_update_task')!.execute({})).toMatchObject({ ok: false });
  });

  it('captures native registration rejection without unregistering another owner', async () => {
    const { tools } = currentContext();
    const foreign = { ...pageTool(), inputSchema: {}, execute: async () => null };
    tools.set('pageway_update_task', foreign);
    const { instance } = bridge();
    await settled();
    expect(instance.getSnapshot()).toEqual({
      status: 'error',
      registered: ['pageway_get_context'],
      error: 'pageway_update_task: Tool already exists',
    });
    instance.dispose();
    expect(tools.get('pageway_update_task')).toBe(foreign);
    expect([...tools.keys()]).toEqual(['pageway_update_task']);
  });

  it('survives native async registration cancellation and immediate StrictMode remount', async () => {
    const { context, tools } = currentContext();
    const original = context.registerTool.getMockImplementation()!;
    const firstPending = deferred<void>();
    context.registerTool.mockImplementationOnce((tool, options) => {
      void original(tool, options);
      options?.signal.addEventListener('abort', () => firstPending.reject(new Error('Aborted')));
      return firstPending.promise;
    });
    const first = bridge();
    await settled();
    first.instance.dispose();
    const second = bridge();
    await settled();
    expect(second.instance.getSnapshot().status).toBe('ready');
    expect([...tools.keys()].sort()).toEqual(['pageway_get_context', 'pageway_update_task']);
    second.instance.dispose();
    expect(tools.size).toBe(0);
  });

  it('skips queued registrations when a provider unmounts before the first microtask', async () => {
    const { context } = currentContext();
    const { instance, onChange } = bridge();
    instance.dispose();
    await settled();
    expect(context.registerTool).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('supports a namespace while reserving get_context and validating browser tool names', async () => {
    const { tools } = currentContext();
    const custom = bridge({ prefix: 'orders.' });
    await settled();
    expect(custom.instance.getSnapshot().registered).toEqual([
      'orders.get_context',
      'orders.update_task',
    ]);
    const duplicate = bridge({ prefix: 'other_', getTools: () => [pageTool('get_context')] });
    await settled();
    expect(duplicate.instance.getSnapshot().error).toBe(
      'Duplicate WebMCP tool name: other_get_context',
    );
    expect(tools.get('other_get_context')?.annotations).toEqual({ readOnlyHint: true });
    const invalid = bridge({ prefix: 'invalid prefix_' });
    expect(invalid.instance.getSnapshot().status).toBe('error');
    expect(invalid.instance.getSnapshot().registered).toEqual([]);
  });

  it('reports blocked API access and unserializable schemas without crashing initialization', async () => {
    vi.stubGlobal('document', {
      get modelContext() {
        throw new Error('Permission denied');
      },
    });
    expect(bridge().instance.getSnapshot().error).toBe('Permission denied');
    currentContext();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const { instance } = bridge({ getTools: () => [{ ...pageTool(), parameters: circular }] });
    await settled();
    expect(instance.getSnapshot()).toMatchObject({
      status: 'error',
      registered: ['pageway_get_context'],
    });
  });

  it('adapts early navigator implementations and only unregisters tools it owns', async () => {
    vi.stubGlobal('document', undefined);
    const { context, tools } = legacyContext();
    const foreign = { ...pageTool('foreign'), inputSchema: {}, execute: async () => null };
    tools.set('foreign', foreign);
    const { instance, executeTool } = bridge();
    await settled();
    expect(await tools.get('pageway_update_task')!.execute({ id: 'PW-103' })).toEqual({
      content: [{ type: 'text', text: '{"ok":true,"result":{"updated":true}}' }],
      isError: false,
    });
    executeTool.mockResolvedValueOnce({ ok: false, error: 'Task not found' });
    expect(await tools.get('pageway_update_task')!.execute({})).toEqual({
      content: [{ type: 'text', text: '{"ok":false,"error":"Task not found"}' }],
      isError: true,
    });
    instance.dispose();
    expect([...tools.keys()]).toEqual(['foreign']);
    expect(context.unregisterTool).toHaveBeenCalledTimes(2);
  });

  it('never unregisters a legacy tool whose registration threw a name collision', async () => {
    vi.stubGlobal('document', undefined);
    const { context, tools } = legacyContext();
    const foreign = { ...pageTool(), inputSchema: {}, execute: async () => null };
    tools.set('pageway_update_task', foreign);
    const { instance } = bridge();
    await settled();
    expect(instance.getSnapshot().status).toBe('error');
    instance.dispose();
    expect(context.unregisterTool).not.toHaveBeenCalledWith('pageway_update_task');
    expect(tools.get('pageway_update_task')).toBe(foreign);
  });

  it('cleans delayed legacy registration before registering its StrictMode replacement', async () => {
    vi.stubGlobal('document', undefined);
    const { context, tools } = legacyContext();
    const pending = deferred<void>();
    context.registerTool.mockImplementationOnce(async (tool) => {
      await pending.promise;
      tools.set(tool.name, tool);
    });
    const first = bridge();
    await settled();
    first.instance.dispose();
    const second = bridge();
    await settled();
    expect(second.instance.getSnapshot().status).toBe('registering');
    pending.resolve();
    await settled();
    expect(second.instance.getSnapshot().status).toBe('ready');
    expect([...tools.keys()].sort()).toEqual(['pageway_get_context', 'pageway_update_task']);
    expect(await tools.get('pageway_get_context')!.execute({})).toMatchObject({ isError: false });
  });
});
