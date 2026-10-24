import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeSSE } from '@zllling/pageway-protocol';
import { PagewayEngine } from './engine.js';
import type { PageTool, PagewayActionSource, PagewayEvent } from './types.js';

const review = { title: 'Apply this change?', description: 'The page value will be overwritten.' };
const schema = {
  type: 'object',
  properties: { value: { type: 'number', minimum: 0 } },
  required: ['value'],
  additionalProperties: false,
};
const makeTool = (overrides: Partial<PageTool> = {}): PageTool => ({
  name: 'set_value',
  description: 'Set the page value',
  parameters: schema,
  execute: vi.fn((args) => ({ value: args.value })),
  ...overrides,
});
type AgentRequest = {
  threadId: string;
  runId: string;
  tools: { name: string }[];
  messages: { role: string; content?: string; toolCallId?: string }[];
};
const callEvents = (id = 'call-1', args = '{"value":2}'): PagewayEvent[] => [
  {
    type: 'TOOL_CALL_START',
    toolCallId: id,
    toolCallName: 'set_value',
    parentMessageId: `assistant-${id}`,
  },
  { type: 'TOOL_CALL_ARGS', toolCallId: id, delta: args },
  { type: 'TOOL_CALL_END', toolCallId: id },
];
const textEvents: PagewayEvent[] = [
  { type: 'TEXT_MESSAGE_START', messageId: 'final-answer', role: 'assistant' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'final-answer', delta: 'Request reviewed.' },
  { type: 'TEXT_MESSAGE_END', messageId: 'final-answer' },
];

function client(initialTools: PageTool[], firstRound = callEvents()) {
  let registered = initialTools;
  const requests: AgentRequest[] = [];
  const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as AgentRequest;
    requests.push(request);
    return new Response(
      [
        { type: 'RUN_STARTED', threadId: request.threadId, runId: request.runId },
        ...(requests.length === 1 ? firstRound : textEvents),
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
      getTools: () => registered,
      getContexts: () => [],
      fetch: fetcher,
    }),
    requests,
    fetcher,
    setTools: (tools: PageTool[]) => {
      registered = tools;
    },
  };
}

function invoke(engine: PagewayEngine, source: PagewayActionSource) {
  return source === 'chat'
    ? engine.sendMessage('Set the value to 2')
    : engine.executeTool('set_value', { value: 2 });
}

async function pending(engine: PagewayEngine) {
  await vi.waitFor(() => expect(engine.getSnapshot().pendingApproval).not.toBeNull());
  return engine.getSnapshot().pendingApproval!;
}

function memoryStorage() {
  const entries = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
  vi.stubGlobal('window', { localStorage });
  return localStorage;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(['reset', 'session switch'])(
  'does not accept an old approval when the model reuses a call ID after %s',
  async (transition) => {
    memoryStorage();
    const tool = makeTool({ approval: review });
    const { engine, requests } = client([tool]);
    const firstRun = engine.sendMessage('First request');
    const first = await pending(engine);
    if (transition === 'reset') engine.reset();
    else engine.configureSession('new-user');
    await firstRun;
    requests.length = 0;
    const secondRun = engine.sendMessage('New request with the same model call ID');
    const second = await pending(engine);
    expect(engine.getSnapshot().actions[0].id).toBe('call-1');
    expect(second.id).not.toBe(first.id);
    expect(engine.approveAction(first.id)).toBe(false);
    expect(engine.rejectAction(first.id)).toBe(false);
    expect(tool.execute).not.toHaveBeenCalled();
    engine.rejectAction(second.id);
    await secondRun;
    expect(tool.execute).not.toHaveBeenCalled();
  },
);

describe('tool access policy', () => {
  it.each(['chat', 'webmcp'] as const)(
    'keeps existing tools available to %s without requiring approval',
    async (source) => {
      const tool = makeTool();
      const { engine } = client([tool]);
      await invoke(engine, source);
      expect(tool.execute).toHaveBeenCalledOnce();
      expect(engine.getSnapshot()).toMatchObject({
        status: 'idle',
        pendingApproval: null,
        actions: [{ status: 'success', source }],
      });
    },
  );

  it('advertises only enabled tools that allow the chat source', async () => {
    const { engine, requests } = client(
      [
        makeTool({ name: 'default_access' }),
        makeTool({ name: 'chat_only', allowedSources: ['chat'] }),
        makeTool({ name: 'disabled', enabled: false }),
        makeTool({ name: 'external_only', allowedSources: ['webmcp'] }),
        makeTool({ name: 'no_sources', allowedSources: [] }),
      ],
      textEvents,
    );
    await engine.sendMessage('What can you do?');
    expect(requests[0].tools.map(({ name }) => name)).toEqual(['default_access', 'chat_only']);
  });

  it.each([
    { source: 'chat', policy: { enabled: false } },
    { source: 'webmcp', policy: { enabled: false } },
    { source: 'chat', policy: { allowedSources: [] } },
    { source: 'webmcp', policy: { allowedSources: [] } },
    { source: 'chat', policy: { allowedSources: ['webmcp'] } },
    { source: 'webmcp', policy: { allowedSources: ['chat'] } },
  ] satisfies { source: PagewayActionSource; policy: Partial<PageTool> }[])(
    'denies $source execution under $policy even when a caller requests it directly',
    async ({ source, policy }) => {
      const approval = vi.fn(() => review);
      const tool = makeTool({ ...policy, approval });
      const { engine, requests } = client([tool]);
      const result = await invoke(engine, source);
      expect(tool.execute).not.toHaveBeenCalled();
      expect(approval).not.toHaveBeenCalled();
      expect(engine.getSnapshot()).toMatchObject({
        status: 'idle',
        pendingApproval: null,
        actions: [{ status: 'error' }],
      });
      if (source === 'webmcp') expect(result).toMatchObject({ ok: false });
      else {
        expect(requests[0].tools).toEqual([]);
        expect(
          JSON.parse(requests[1].messages.find((entry) => entry.role === 'tool')!.content!),
        ).toMatchObject({ ok: false });
      }
    },
  );

  it('validates arguments before invoking an application approval policy', async () => {
    const approval = vi.fn(() => review);
    const tool = makeTool({ approval });
    const { engine } = client([tool]);
    expect(await engine.executeTool('set_value', { value: 'invalid' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('number'),
    });
    expect(approval).not.toHaveBeenCalled();
    expect(tool.execute).not.toHaveBeenCalled();
    expect(engine.getSnapshot().pendingApproval).toBeNull();
  });

  it('uses validated arguments to request approval only for matching operations', async () => {
    const approval = vi.fn((args: Record<string, unknown>) =>
      Number(args.value) >= 10
        ? { ...review, description: `Set the value to ${args.value}.` }
        : false,
    );
    const tool = makeTool({ approval });
    const { engine } = client([tool]);
    expect(await engine.executeTool('set_value', { value: 2 })).toMatchObject({ ok: true });
    const running = engine.executeTool('set_value', { value: 12 });
    const request = await pending(engine);
    expect(request.description).toBe('Set the value to 12.');
    expect(tool.execute).toHaveBeenCalledOnce();
    expect(engine.approveAction(request.id)).toBe(true);
    expect(await running).toMatchObject({ ok: true, result: { value: 12 } });
    expect(approval).toHaveBeenCalledWith({ value: 12 });
    expect(tool.execute).toHaveBeenCalledTimes(2);
  });
});

describe('human approval lifecycle', () => {
  it.each(['chat', 'webmcp'] as const)(
    'holds %s operations until one matching approval and records the decision',
    async (source) => {
      const tool = makeTool({ approval: review });
      const { engine, requests } = client([tool]);
      const running = invoke(engine, source);
      const request = await pending(engine);
      expect(request).toMatchObject({
        ...review,
        name: 'set_value',
        source,
        args: { value: 2 },
      });
      expect(engine.getSnapshot()).toMatchObject({
        status: 'running',
        actions: [
          {
            status: 'awaiting-approval',
            approval: { ...review, status: 'pending', requestedAt: expect.any(Number) },
          },
        ],
      });
      expect(tool.execute).not.toHaveBeenCalled();
      expect(engine.approveAction('unrelated-request')).toBe(false);
      expect(engine.rejectAction('unrelated-request')).toBe(false);
      expect(engine.getSnapshot().pendingApproval?.id).toBe(request.id);
      expect(engine.approveAction(request.id)).toBe(true);
      expect(engine.approveAction(request.id)).toBe(false);
      expect(engine.rejectAction(request.id)).toBe(false);
      await running;
      expect(tool.execute).toHaveBeenCalledOnce();
      expect(engine.getSnapshot()).toMatchObject({
        status: 'idle',
        pendingApproval: null,
        actions: [
          {
            status: 'success',
            approval: {
              ...review,
              status: 'approved',
              requestedAt: expect.any(Number),
              decidedAt: expect.any(Number),
            },
          },
        ],
      });
      const audit = engine.getSnapshot().actions[0].approval!;
      expect(audit.decidedAt).toBeGreaterThanOrEqual(audit.requestedAt);
      if (source === 'chat') {
        expect(requests).toHaveLength(2);
        expect(
          JSON.parse(requests[1].messages.find((entry) => entry.role === 'tool')!.content!),
        ).toEqual({ ok: true, result: { value: 2 } });
      } else {
        expect(requests).toEqual([]);
        expect(engine.getSnapshot().messages).toEqual([]);
      }
    },
  );

  it.each(['chat', 'webmcp'] as const)(
    'rejects %s operations without side effects and lets the caller continue',
    async (source) => {
      const tool = makeTool({ approval: review });
      const { engine, requests } = client([tool]);
      const running = invoke(engine, source);
      const request = await pending(engine);
      expect(engine.rejectAction(request.id)).toBe(true);
      expect(engine.rejectAction(request.id)).toBe(false);
      expect(engine.approveAction(request.id)).toBe(false);
      const result = await running;
      expect(tool.execute).not.toHaveBeenCalled();
      expect(engine.getSnapshot()).toMatchObject({
        status: 'idle',
        pendingApproval: null,
        actions: [
          {
            status: 'rejected',
            approval: { ...review, status: 'rejected', decidedAt: expect.any(Number) },
          },
        ],
      });
      if (source === 'webmcp') expect(result).toMatchObject({ ok: false });
      else {
        expect(requests).toHaveLength(2);
        expect(
          JSON.parse(requests[1].messages.find((entry) => entry.role === 'tool')!.content!),
        ).toMatchObject({ ok: false });
        expect(engine.getSnapshot().messages.at(-1)?.content).toBe('Request reviewed.');
      }
    },
  );

  it('does not grant approval when time passes and retains the execution lock while waiting', async () => {
    vi.useFakeTimers();
    const tool = makeTool({ approval: review });
    const { engine, fetcher } = client([tool]);
    const running = engine.executeTool('set_value', { value: 2 });
    const request = await pending(engine);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(engine.getSnapshot()).toMatchObject({
      status: 'running',
      pendingApproval: { id: request.id },
    });
    expect(tool.execute).not.toHaveBeenCalled();
    expect(await engine.executeTool('set_value', { value: 3 })).toMatchObject({ ok: false });
    await engine.sendMessage('A competing request');
    expect(fetcher).not.toHaveBeenCalled();
    engine.rejectAction(request.id);
    await running;
  });

  it.each(['stop', 'reset', 'external-abort', 'session-switch'] as const)(
    'invalidates approval on %s and ignores a late decision',
    async (operation) => {
      if (operation === 'session-switch') memoryStorage();
      const tool = makeTool({ approval: review });
      const { engine } = client([tool]);
      if (operation === 'session-switch') engine.configureSession('alice');
      const controller = new AbortController();
      const running = engine.executeTool('set_value', { value: 2 }, controller.signal);
      const request = await pending(engine);
      if (operation === 'stop') engine.stop();
      else if (operation === 'reset') engine.reset();
      else if (operation === 'external-abort') controller.abort();
      else engine.configureSession('bob');
      expect(await running).toMatchObject({ ok: false });
      expect(engine.getSnapshot()).toMatchObject({ status: 'idle', pendingApproval: null });
      expect(engine.approveAction(request.id)).toBe(false);
      expect(engine.rejectAction(request.id)).toBe(false);
      expect(tool.execute).not.toHaveBeenCalled();
      if (operation === 'reset' || operation === 'session-switch')
        expect(engine.getSnapshot().actions).toEqual([]);
      else expect(engine.getSnapshot().actions[0].status).toBe('cancelled');
    },
  );

  it('stops a chat awaiting approval without dispatching its next tool or model round', async () => {
    const tool = makeTool({ approval: review });
    const { engine, requests } = client([tool], [...callEvents(), ...callEvents('call-2')]);
    const running = engine.sendMessage('Perform both changes');
    const request = await pending(engine);
    engine.stop();
    await running;
    expect(engine.approveAction(request.id)).toBe(false);
    expect(tool.execute).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    expect(engine.getSnapshot().actions.map((action) => action.status)).toEqual([
      'cancelled',
      'cancelled',
    ]);
    expect(engine.getSnapshot().messages.filter((message) => message.role === 'tool')).toHaveLength(
      2,
    );
  });
});

describe('approval execution boundaries', () => {
  it.each([
    'disabled',
    'source-revoked',
    'unregistered',
    'invalid-schema',
    'new-callback',
    'new-title',
    'new-description',
  ] as const)(
    'denies an approved request when %s changes while the user reviews it',
    async (change) => {
      const tool = makeTool({ approval: review });
      const replacement = vi.fn(() => ({ changed: true }));
      const { engine, setTools } = client([tool]);
      const running = engine.executeTool('set_value', { value: 2 });
      const request = await pending(engine);
      const current = { ...tool };
      if (change === 'disabled') current.enabled = false;
      if (change === 'source-revoked') current.allowedSources = ['chat'];
      if (change === 'invalid-schema')
        current.parameters = { ...schema, properties: { value: { type: 'number', maximum: 0 } } };
      if (change === 'new-callback') current.execute = replacement;
      if (change === 'new-title') current.approval = { ...review, title: 'A different operation' };
      if (change === 'new-description')
        current.approval = { ...review, description: 'Different consequences.' };
      setTools(change === 'unregistered' ? [] : [current]);
      engine.approveAction(request.id);
      expect(await running).toMatchObject({ ok: false });
      expect(tool.execute).not.toHaveBeenCalled();
      expect(replacement).not.toHaveBeenCalled();
      expect(engine.getSnapshot().pendingApproval).toBeNull();
      expect(engine.getSnapshot().actions[0].status).toBe('error');
    },
  );

  it('allows a refreshed registration with the same execution callback and review text', async () => {
    const tool = makeTool({ approval: () => ({ ...review }) });
    const { engine, setTools } = client([tool]);
    const running = engine.executeTool('set_value', { value: 2 });
    const request = await pending(engine);
    setTools([{ ...tool, approval: () => ({ ...review }) }]);
    engine.approveAction(request.id);
    expect(await running).toMatchObject({ ok: true });
    expect(tool.execute).toHaveBeenCalledOnce();
  });

  it('invalidates approval if the registered tool callback is replaced in place', async () => {
    const original = vi.fn(() => ({ original: true }));
    const replacement = vi.fn(() => ({ replacement: true }));
    const tool = makeTool({ approval: review, execute: original });
    const { engine } = client([tool]);
    const running = engine.executeTool('set_value', { value: 2 });
    const request = await pending(engine);
    tool.execute = replacement;
    engine.approveAction(request.id);
    expect(await running).toMatchObject({ ok: false });
    expect(original).not.toHaveBeenCalled();
    expect(replacement).not.toHaveBeenCalled();
    expect(engine.getSnapshot().actions[0].status).toBe('error');
  });

  it('rechecks approval after target movement before executing an initially safe request', async () => {
    vi.useFakeTimers();
    let reachedTarget!: () => void;
    const animating = new Promise<void>((resolve) => {
      reachedTarget = resolve;
    });
    vi.stubGlobal('document', {
      querySelector: () => ({
        scrollIntoView: () => reachedTarget(),
        getBoundingClientRect: () => ({ left: 20, top: 30, width: 100, height: 40 }),
      }),
    });
    const tool = makeTool({ target: '#page-control', approval: () => false });
    const { engine, setTools } = client([tool]);
    const running = engine.executeTool('set_value', { value: 2 });
    await animating;
    setTools([{ ...tool, approval: review }]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await running).toMatchObject({ ok: false });
    expect(tool.execute).not.toHaveBeenCalled();
    expect(engine.getSnapshot().actions[0].status).toBe('error');
  });

  it('executes the original nested arguments despite mutations to input and public review state', async () => {
    const tool = makeTool({
      approval: review,
      parameters: {
        type: 'object',
        properties: {
          change: {
            type: 'object',
            properties: { value: { type: 'number' } },
            required: ['value'],
            additionalProperties: false,
          },
        },
        required: ['change'],
        additionalProperties: false,
      },
      execute: vi.fn((args) => args),
    });
    const { engine } = client([tool]);
    const input = { change: { value: 2 } };
    const running = engine.executeTool('set_value', input);
    const request = await pending(engine);
    input.change.value = 100;
    Reflect.set(request.args.change as object, 'value', 200);
    Reflect.set(engine.getSnapshot().actions[0].args.change as object, 'value', 300);
    engine.approveAction(request.id);
    expect(await running).toEqual({ ok: true, result: { change: { value: 2 } } });
    expect(tool.execute).toHaveBeenCalledWith(
      { change: { value: 2 } },
      { signal: expect.any(AbortSignal) },
    );
  });
});

describe('approval session history', () => {
  it.each(['approved', 'rejected'] as const)(
    'restores a %s audit entry without granting reusable authority',
    async (decision) => {
      memoryStorage();
      const tool = makeTool({ approval: review });
      const first = client([tool]);
      first.engine.configureSession('approval-history');
      const running = first.engine.executeTool('set_value', { value: 2 });
      const request = await pending(first.engine);
      if (decision === 'approved') first.engine.approveAction(request.id);
      else first.engine.rejectAction(request.id);
      await running;

      const restoredTool = makeTool({ approval: review });
      const restored = client([restoredTool]);
      restored.engine.configureSession('approval-history');
      expect(restored.engine.getSnapshot()).toMatchObject({
        status: 'idle',
        pendingApproval: null,
        actions: [
          {
            status: decision === 'approved' ? 'success' : 'rejected',
            approval: { ...review, status: decision },
          },
        ],
      });
      expect(restored.engine.approveAction(request.id)).toBe(false);
      expect(restoredTool.execute).not.toHaveBeenCalled();
      expect(restored.fetcher).not.toHaveBeenCalled();
      const newRun = restored.engine.executeTool('set_value', { value: 2 });
      const nextRequest = await pending(restored.engine);
      expect(nextRequest.id).not.toBe(request.id);
      expect(restored.engine.approveAction(request.id)).toBe(false);
      restored.engine.rejectAction(nextRequest.id);
      await newRun;
      expect(restoredTool.execute).not.toHaveBeenCalled();
    },
  );

  it('converts a stored pending approval into an interrupted action without replaying it', () => {
    const local = memoryStorage();
    const now = Date.now();
    local.setItem(
      'interrupted-review',
      JSON.stringify({
        version: 1,
        savedAt: now,
        state: {
          threadId: 'old-thread',
          messages: [
            { id: 'user-1', role: 'user', content: 'Change the value' },
            {
              id: 'assistant-1',
              role: 'assistant',
              toolCalls: [
                {
                  id: 'old-call',
                  type: 'function',
                  function: { name: 'set_value', arguments: '{"value":2}' },
                },
              ],
            },
          ],
          actions: [
            {
              id: 'old-call',
              name: 'set_value',
              label: 'Set value',
              source: 'chat',
              status: 'awaiting-approval',
              args: { value: 2 },
              startedAt: now - 100,
              approval: { ...review, status: 'pending', requestedAt: now - 50 },
            },
          ],
        },
      }),
    );
    const tool = makeTool({ approval: review });
    const { engine, fetcher } = client([tool]);
    engine.configureSession('interrupted-review');
    expect(engine.getSnapshot()).toMatchObject({
      status: 'idle',
      pendingApproval: null,
      actions: [{ status: 'cancelled' }],
    });
    expect(JSON.parse(engine.getSnapshot().messages.at(-1)!.content!)).toMatchObject({ ok: false });
    expect(engine.approveAction('old-call')).toBe(false);
    expect(tool.execute).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
