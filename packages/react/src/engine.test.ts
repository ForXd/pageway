import { describe, expect, it, vi } from 'vitest';
import { encodeSSE } from '@zllling/pageway-protocol';
import { PagewayEngine, validateToolArguments } from './engine.js';
import type { PageTool, PagewayEvent } from './types.js';

type Request = {
  threadId: string;
  runId: string;
  messages: Record<string, unknown>[];
  state: unknown;
  context: unknown[];
};
const schema = {
  type: 'object',
  properties: { value: { type: 'number', minimum: 0 } },
  required: ['value'],
  additionalProperties: false,
};
const makeTool = (
  execute = vi.fn<(args: Record<string, unknown>, context: { signal: AbortSignal }) => unknown>(
    () => ({ updated: true }),
  ),
): PageTool => ({
  name: 'set_value',
  description: 'Set the page value',
  parameters: schema,
  execute,
});
const callEvents = (id = 'call-1', args = '{"value":2}', name = 'set_value'): PagewayEvent[] => [
  {
    type: 'TOOL_CALL_START',
    toolCallId: id,
    toolCallName: name,
    parentMessageId: `assistant-${id}`,
  },
  { type: 'TOOL_CALL_ARGS', toolCallId: id, delta: args.slice(0, 5) },
  { type: 'TOOL_CALL_ARGS', toolCallId: id, delta: args.slice(5) },
  { type: 'TOOL_CALL_END', toolCallId: id },
];
const textEvents = (): PagewayEvent[] => [
  { type: 'TEXT_MESSAGE_START', messageId: 'final-answer', role: 'assistant' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'final-answer', delta: 'All done.' },
  { type: 'TEXT_MESSAGE_END', messageId: 'final-answer' },
];
function response(
  request: Request,
  events: PagewayEvent[],
  options: { start?: boolean; finish?: boolean } = {},
) {
  const all: PagewayEvent[] = [
    ...(options.start === false
      ? []
      : [{ type: 'RUN_STARTED', threadId: request.threadId, runId: request.runId }]),
    ...events,
    ...(options.finish === false
      ? []
      : [{ type: 'RUN_FINISHED', threadId: request.threadId, runId: request.runId }]),
  ];
  const bytes = new TextEncoder().encode(all.map((event) => encodeSSE(event as never)).join(''));
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
function makeClient(tool: PageTool, rounds: PagewayEvent[][]) {
  const requests: Request[] = [];
  const fetcher = vi.fn(async (_url: string | URL | globalThis.Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as Request;
    requests.push(request);
    return response(request, rounds[requests.length - 1] ?? textEvents());
  });
  const engine = new PagewayEngine({
    endpoint: '/api/agent',
    getTools: () => [tool],
    getContexts: () => [],
    fetch: fetcher as typeof fetch,
  });
  return { engine, fetcher, requests };
}

describe('Pageway browser runner', () => {
  it('executes registered tools in order and resumes using real tool-result messages and current context', async () => {
    let value = 0;
    const observed: number[] = [];
    const tool = makeTool(
      vi.fn((args) => {
        observed.push(value);
        value = Number(args.value);
        return { value };
      }),
    );
    const { engine, requests, fetcher } = makeClient(tool, [
      [...callEvents(), ...callEvents('call-2', '{"value":3}')],
      textEvents(),
    ]);
    engine.updateOptions({
      endpoint: '/api/agent',
      getTools: () => [tool],
      getContexts: () => [{ id: 'counter', title: 'Counter', data: { value } }],
      fetch: fetcher as typeof fetch,
    });
    await engine.sendMessage('Set the value twice');
    expect(observed).toEqual([0, 2]);
    expect(requests).toHaveLength(2);
    expect(requests[1].messages.filter((message) => message.role === 'tool')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: 'call-1',
          content: '{"ok":true,"result":{"value":2}}',
        }),
        expect.objectContaining({
          toolCallId: 'call-2',
          content: '{"ok":true,"result":{"value":3}}',
        }),
      ]),
    );
    expect(requests[1].state).toEqual({
      page: [{ id: 'counter', title: 'Counter', data: { value: 3 } }],
    });
    expect(engine.getSnapshot().actions.map((action) => action.status)).toEqual([
      'success',
      'success',
    ]);
    expect(engine.getSnapshot().messages.at(-1)?.content).toBe('All done.');
    expect(engine.getSnapshot().status).toBe('idle');
  });

  it.each(['{broken', '{"value":-1}', '{"value":"2"}', '{"value":2,"secret":true}', '[]'])(
    'rejects invalid arguments %s without executing the browser callback',
    async (raw) => {
      const tool = makeTool();
      const { engine, requests } = makeClient(tool, [callEvents('call-1', raw)]);
      await engine.sendMessage('Please update');
      expect(tool.execute).not.toHaveBeenCalled();
      expect(engine.getSnapshot().actions[0].status).toBe('error');
      expect(
        JSON.parse(
          String(requests[1].messages.find((message) => message.role === 'tool')?.content),
        ),
      ).toMatchObject({ ok: false });
      const assistant = requests[1].messages.find((message) => message.role === 'assistant');
      const sentCalls = (assistant?.toolCalls ?? []) as { function: { arguments: string } }[];
      expect(sentCalls).toHaveLength(1);
      const sentCall = sentCalls[0];
      expect(() => JSON.parse(sentCall.function.arguments)).not.toThrow();
    },
  );

  it('returns a structured error for an unknown tool without executing anything', async () => {
    const tool = makeTool();
    const { engine } = makeClient(tool, [callEvents('call-1', '{}', 'eval_javascript')]);
    await engine.sendMessage('Try an unknown capability');
    expect(tool.execute).not.toHaveBeenCalled();
    expect(engine.getSnapshot().actions[0].error).toContain('has not registered');
  });

  it('never executes the same tool-call identifier twice in one conversation', async () => {
    const tool = makeTool();
    const { engine } = makeClient(tool, [callEvents(), callEvents()]);
    await engine.sendMessage('Repeat');
    expect(tool.execute).toHaveBeenCalledTimes(1);
    expect(engine.getSnapshot().status).toBe('error');
    expect(engine.getSnapshot().error).toContain('Duplicate tool call identifier');
  });

  it('preserves model continuation metadata without displaying it as assistant content', async () => {
    const tool = makeTool();
    const events = callEvents();
    events[events.length - 1] = {
      ...events.at(-1)!,
      metadata: { pageway: { reasoning_content: 'provider-specific continuation' } },
    };
    const { engine, requests } = makeClient(tool, [events]);
    await engine.sendMessage('Update');
    expect(requests[1].messages.find((message) => message.role === 'assistant')?.metadata).toEqual({
      pageway: { reasoning_content: 'provider-specific continuation' },
    });
    expect(
      engine
        .getSnapshot()
        .messages.some((message) => message.content?.includes('provider-specific')),
    ).toBe(false);
  });

  it('cancels an uncooperative async handler and does not dispatch the next tool or round', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let resolveHandler!: (value: unknown) => void;
    let passedSignal: AbortSignal | undefined;
    const tool = makeTool(
      vi.fn((_args, { signal }) => {
        passedSignal = signal;
        entered();
        return new Promise((resolve) => {
          resolveHandler = resolve;
        });
      }),
    );
    const { engine, fetcher } = makeClient(tool, [[...callEvents(), ...callEvents('call-2')]]);
    const running = engine.sendMessage('Run slowly');
    await started;
    engine.stop();
    await running;
    resolveHandler({ late: true });
    await Promise.resolve();
    expect(passedSignal?.aborted).toBe(true);
    expect(tool.execute).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(engine.getSnapshot().status).toBe('idle');
    expect(engine.getSnapshot().actions.map((action) => action.status)).toEqual([
      'cancelled',
      'cancelled',
    ]);
    expect(engine.getSnapshot().messages.filter((message) => message.role === 'tool')).toHaveLength(
      2,
    );
  });

  it('cannot restore old messages when reset happens while a tool is pending', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const tool = makeTool(
      vi.fn(() => {
        entered();
        return new Promise(() => {});
      }),
    );
    const { engine } = makeClient(tool, [callEvents()]);
    const running = engine.sendMessage('Run slowly');
    await started;
    engine.reset();
    await running;
    expect(engine.getSnapshot()).toMatchObject({
      messages: [],
      actions: [],
      events: [],
      status: 'idle',
      error: null,
    });
  });

  it.each(['missing_start', 'missing_finish', 'unfinished_call', 'wrong_run'])(
    'rejects an invalid %s lifecycle before performing any side effect',
    async (kind) => {
      const tool = makeTool();
      const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as Request;
        if (kind === 'wrong_run') request.runId = 'different-run';
        const events = callEvents();
        if (kind === 'unfinished_call') events.pop();
        return response(request, events, {
          start: kind !== 'missing_start',
          finish: kind !== 'missing_finish',
        });
      });
      const engine = new PagewayEngine({
        endpoint: '/api/agent',
        getTools: () => [tool],
        getContexts: () => [],
        fetch: fetcher as typeof fetch,
      });
      await engine.sendMessage('Update');
      expect(tool.execute).not.toHaveBeenCalled();
      expect(engine.getSnapshot().status).toBe('error');
    },
  );

  it('stops reading at RUN_FINISHED so trailing events cannot mutate the page', async () => {
    const tool = makeTool();
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Request;
      return response(request, [
        { type: 'RUN_FINISHED', threadId: request.threadId, runId: request.runId },
        ...callEvents(),
      ]);
    });
    const engine = new PagewayEngine({
      endpoint: '/api/agent',
      getTools: () => [tool],
      getContexts: () => [],
      fetch: fetcher as typeof fetch,
    });
    await engine.sendMessage('Update');
    expect(tool.execute).not.toHaveBeenCalled();
    expect(engine.getSnapshot().actions).toEqual([]);
    expect(engine.getSnapshot().status).toBe('idle');
  });

  it('keeps interrupted partial tool JSON valid in history so a new user message can recover', async () => {
    const tool = makeTool();
    const requests: Request[] = [];
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Request;
      requests.push(request);
      if (requests.length === 1)
        return response(request, callEvents('interrupted', '{"value":').slice(0, -1), {
          finish: false,
        });
      return response(request, textEvents());
    });
    const engine = new PagewayEngine({
      endpoint: '/api/agent',
      getTools: () => [tool],
      getContexts: () => [],
      fetch: fetcher as typeof fetch,
    });
    await engine.sendMessage('Update');
    expect(engine.getSnapshot().status).toBe('error');
    expect(tool.execute).not.toHaveBeenCalled();
    await engine.sendMessage('Try something else');
    const assistant = requests[1].messages.find((message) => message.role === 'assistant');
    expect(assistant?.toolCalls).toEqual([
      expect.objectContaining({ function: { name: 'set_value', arguments: '{}' } }),
    ]);
    expect(requests[1].messages.filter((message) => message.role === 'tool')).toHaveLength(1);
    expect(engine.getSnapshot().status).toBe('idle');
  });

  it('normalizes omitted arguments for a successful no-argument call before continuation', async () => {
    const tool = { ...makeTool(), parameters: { type: 'object', additionalProperties: false } };
    const events = callEvents('empty', '{}').filter((event) => event.type !== 'TOOL_CALL_ARGS');
    const { engine, requests } = makeClient(tool, [events]);
    await engine.sendMessage('Run the no-argument tool');
    expect(tool.execute).toHaveBeenCalledTimes(1);
    expect(requests[1].messages.find((message) => message.role === 'assistant')?.toolCalls).toEqual(
      [expect.objectContaining({ function: { name: 'set_value', arguments: '{}' } })],
    );
  });

  it.each(['new_callback', 'unregistered', 'new_schema'])(
    'rechecks %s after the target animation before invoking a capability',
    async (change) => {
      vi.useFakeTimers();
      try {
        let reachedTarget!: () => void;
        const animating = new Promise<void>((resolve) => {
          reachedTarget = resolve;
        });
        vi.stubGlobal('document', {
          querySelector: () => ({
            scrollIntoView: () => reachedTarget(),
            getBoundingClientRect: () => ({ left: 30, top: 40, width: 100, height: 30 }),
          }),
        });
        vi.stubGlobal('innerWidth', 1200);
        vi.stubGlobal('innerHeight', 800);
        const original = { ...makeTool(), target: '#page-control' };
        const replacement = makeTool();
        let registered: PageTool[] = [original];
        let round = 0;
        const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
          const request = JSON.parse(String(init?.body)) as Request;
          return response(request, round++ === 0 ? callEvents() : textEvents());
        });
        const engine = new PagewayEngine({
          endpoint: '/api/agent',
          animationDuration: 100,
          getTools: () => registered,
          getContexts: () => [],
          fetch: fetcher as typeof fetch,
        });
        const running = engine.sendMessage('Update');
        await animating;
        registered =
          change === 'unregistered'
            ? []
            : [
                {
                  ...replacement,
                  ...(change === 'new_schema'
                    ? {
                        parameters: {
                          ...schema,
                          properties: { value: { type: 'number', maximum: 0 } },
                        },
                      }
                    : {}),
                },
              ];
        await vi.advanceTimersByTimeAsync(1000);
        await running;
        expect(original.execute).not.toHaveBeenCalled();
        if (change === 'new_callback') {
          expect(replacement.execute).toHaveBeenCalledTimes(1);
          expect(engine.getSnapshot().actions[0].status).toBe('success');
        } else {
          expect(replacement.execute).not.toHaveBeenCalled();
          expect(engine.getSnapshot().actions[0].status).toBe('error');
          expect(engine.getSnapshot().actions[0].error).toContain(
            change === 'unregistered' ? 'no longer registered' : 'must be <= 0',
          );
        }
      } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
    },
  );

  it('shows cursor travel before execution, reanchors after the update, and retains success when stopped during acknowledgment', async () => {
    vi.useFakeTimers();
    try {
      let reachedTarget!: () => void;
      const ready = new Promise<void>((resolve) => {
        reachedTarget = resolve;
      });
      let targetLeft = 30;
      const target = {
        scrollIntoView: () => reachedTarget(),
        getBoundingClientRect: () => ({ left: targetLeft, top: 40, width: 100, height: 30 }),
      };
      vi.stubGlobal('document', {
        querySelector: (selector: string) =>
          selector === '[data-pageway-origin]'
            ? { getBoundingClientRect: () => ({ left: 900, top: 600, width: 200, height: 60 }) }
            : target,
      });
      const tool = {
        ...makeTool(
          vi.fn(() => {
            targetLeft = 330;
            return { moved: true };
          }),
        ),
        target: '#page-control',
      };
      const { engine, fetcher } = makeClient(tool, [callEvents()]);
      engine.updateOptions({
        endpoint: '/api/agent',
        animationDuration: 400,
        getTools: () => [tool],
        getContexts: () => [],
        fetch: fetcher as typeof fetch,
      });
      const running = engine.sendMessage('Move the task');
      await ready;
      expect(engine.getSnapshot().cursor).toEqual({ x: 1060, y: 630 });
      expect(engine.getSnapshot().status).toBe('running');
      await vi.advanceTimersByTimeAsync(32);
      expect(engine.getSnapshot().activity?.phase).toBe('moving');
      expect(engine.getSnapshot().cursor).toEqual({ x: 80, y: 55 });
      expect(tool.execute).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(400);
      expect(engine.getSnapshot().activity?.phase).toBe('acting');
      expect(tool.execute).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(160);
      expect(tool.execute).toHaveBeenCalledOnce();
      expect(engine.getSnapshot().activity?.phase).toBe('success');
      expect(engine.getSnapshot().spotlight?.rect.left).toBe(330);
      expect(engine.getSnapshot().path).toEqual([
        { x: 1060, y: 630 },
        { x: 80, y: 55 },
        { x: 380, y: 55 },
      ]);
      engine.stop();
      await running;
      expect(engine.getSnapshot().status).toBe('idle');
      expect(engine.getSnapshot().actions[0].status).toBe('success');
      expect(engine.getSnapshot().spotlight).toBe(null);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('keeps an instantly completed page action visible long enough to read before the next model round', async () => {
    vi.useFakeTimers();
    try {
      let reachedTarget!: () => void;
      const ready = new Promise<void>((resolve) => {
        reachedTarget = resolve;
      });
      vi.stubGlobal('document', {
        querySelector: () => ({
          scrollIntoView: () => reachedTarget(),
          getBoundingClientRect: () => ({ left: 30, top: 40, width: 100, height: 30 }),
        }),
      });
      const tool = { ...makeTool(), target: '#control' };
      const { engine, fetcher } = makeClient(tool, [callEvents()]);
      engine.updateOptions({
        endpoint: '/api/agent',
        animationDuration: 40,
        getTools: () => [tool],
        getContexts: () => [],
        fetch: fetcher as typeof fetch,
      });
      const running = engine.sendMessage('Apply a quick change');
      await ready;
      await vi.advanceTimersByTimeAsync(232);
      expect(tool.execute).toHaveBeenCalledOnce();
      expect(engine.getSnapshot().activity?.phase).toBe('success');
      await vi.advanceTimersByTimeAsync(599);
      expect(engine.getSnapshot().activity?.phase).toBe('success');
      expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await running;
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(engine.getSnapshot().status).toBe('idle');
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('honors reduced motion with static action and success feedback while preserving execution and cancellation', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('matchMedia', () => ({ matches: true }));
      let reachedTarget!: () => void;
      const ready = new Promise<void>((resolve) => {
        reachedTarget = resolve;
      });
      vi.stubGlobal('document', {
        querySelector: () => ({
          scrollIntoView: () => reachedTarget(),
          getBoundingClientRect: () => ({ left: 30, top: 40, width: 100, height: 30 }),
        }),
      });
      const tool = { ...makeTool(), target: '#control' };
      const { engine, fetcher } = makeClient(tool, [callEvents()]);
      const phases: string[] = [];
      const unsubscribe = engine.subscribe(() => {
        const phase = engine.getSnapshot().activity?.phase;
        if (phase) phases.push(phase);
      });
      const running = engine.sendMessage('Apply without motion');
      await ready;
      await vi.advanceTimersByTimeAsync(112);
      expect(tool.execute).toHaveBeenCalledOnce();
      expect(phases).not.toContain('moving');
      expect(phases).toEqual(expect.arrayContaining(['planning', 'acting', 'success']));
      expect(engine.getSnapshot().animationDuration).toBe(0);
      expect(engine.getSnapshot().spotlight?.rect).toEqual({
        left: 30,
        top: 40,
        width: 100,
        height: 30,
      });
      engine.stop();
      await running;
      unsubscribe();
      expect(engine.getSnapshot().actions[0].status).toBe('success');
      expect(engine.getSnapshot().status).toBe('idle');
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('cancels during cursor travel without executing the page action', async () => {
    vi.useFakeTimers();
    try {
      let reachedTarget!: () => void;
      const ready = new Promise<void>((resolve) => {
        reachedTarget = resolve;
      });
      vi.stubGlobal('document', {
        querySelector: () => ({
          scrollIntoView: () => reachedTarget(),
          getBoundingClientRect: () => ({ left: 30, top: 40, width: 100, height: 30 }),
        }),
      });
      const tool = { ...makeTool(), target: '#control' };
      const { engine } = makeClient(tool, [callEvents()]);
      const running = engine.sendMessage('Change something');
      await ready;
      await vi.advanceTimersByTimeAsync(200);
      expect(engine.getSnapshot().activity?.phase).toBe('moving');
      engine.stop();
      await running;
      expect(tool.execute).not.toHaveBeenCalled();
      expect(engine.getSnapshot().actions[0].status).toBe('cancelled');
      expect(engine.getSnapshot().activity).toBe(null);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('measures after instant scrolling and scrolls a moved task back into a narrow viewport before success feedback', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('innerWidth', 576);
      vi.stubGlobal('innerHeight', 764);
      const animationFrame = vi.fn(() => {
        throw new Error('A compositor frame is not available.');
      });
      vi.stubGlobal('requestAnimationFrame', animationFrame);
      let reachedTarget!: () => void;
      const ready = new Promise<void>((resolve) => {
        reachedTarget = resolve;
      });
      let top = 1800;
      const scroll = vi.fn(() => {
        top = scroll.mock.calls.length === 1 ? 210 : 280;
        reachedTarget();
      });
      const target = {
        scrollIntoView: scroll,
        getBoundingClientRect: () => ({ left: 38, top, width: 500, height: 120 }),
      };
      vi.stubGlobal('document', {
        querySelector: (selector: string) =>
          selector === '[data-pageway-origin]'
            ? { getBoundingClientRect: () => ({ left: 900, top: 1200, width: 200, height: 60 }) }
            : target,
      });
      const tool = {
        ...makeTool(
          vi.fn(() => {
            top = 846;
            return { moved: true };
          }),
        ),
        target: '#moving-task',
      };
      const { engine, fetcher } = makeClient(tool, [callEvents()]);
      engine.updateOptions({
        endpoint: '/api/agent',
        animationDuration: 40,
        getTools: () => [tool],
        getContexts: () => [],
        fetch: fetcher as typeof fetch,
      });
      const running = engine.sendMessage('Move this task to done');
      await ready;
      // An offscreen chat composer must not leave the cursor origin offscreen.
      expect(engine.getSnapshot().cursor).toEqual({ x: 564, y: 752 });
      await vi.advanceTimersByTimeAsync(32);
      expect(engine.getSnapshot().spotlight?.rect.top).toBe(210);
      expect(engine.getSnapshot().cursor).toEqual({ x: 288, y: 270 });
      expect(scroll).toHaveBeenNthCalledWith(1, {
        behavior: 'instant',
        block: 'center',
        inline: 'nearest',
      });
      await vi.advanceTimersByTimeAsync(200);
      expect(tool.execute).toHaveBeenCalledOnce();
      expect(scroll).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(32);
      expect(engine.getSnapshot().activity?.phase).toBe('success');
      expect(engine.getSnapshot().spotlight?.rect.top).toBe(280);
      expect(engine.getSnapshot().cursor).toEqual({ x: 288, y: 340 });
      expect(animationFrame).not.toHaveBeenCalled();
      engine.stop();
      await running;
      expect(engine.getSnapshot().actions[0].status).toBe('success');
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('can cancel during the scroll measurement interval without applying the operation', async () => {
    vi.useFakeTimers();
    try {
      let reachedTarget!: () => void;
      const ready = new Promise<void>((resolve) => {
        reachedTarget = resolve;
      });
      vi.stubGlobal('document', {
        querySelector: () => ({
          scrollIntoView: () => reachedTarget(),
          getBoundingClientRect: () => ({ left: 30, top: 40, width: 100, height: 30 }),
        }),
      });
      const tool = { ...makeTool(), target: '#control' };
      const { engine } = makeClient(tool, [callEvents()]);
      const running = engine.sendMessage('Update');
      await ready;
      engine.stop();
      await running;
      expect(tool.execute).not.toHaveBeenCalled();
      expect(engine.getSnapshot().status).toBe('idle');
      expect(engine.getSnapshot().actions[0].status).toBe('cancelled');
      expect(engine.getSnapshot().spotlight).toBe(null);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

describe('schema validation', () => {
  it('does not coerce or mutate untrusted arguments', () => {
    const tool = makeTool();
    expect(validateToolArguments(tool, '{"value":2}')).toEqual({ value: 2 });
    expect(() => validateToolArguments(tool, '{"value":"2"}')).toThrow('must be number');
  });
});
