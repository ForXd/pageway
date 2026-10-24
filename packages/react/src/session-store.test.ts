import { describe, expect, it, vi } from 'vitest';
import { createSessionStore, type StoredSession } from './session-store.js';

const NOW = 1780000000000;
const WEEK = 7 * 24 * 60 * 60 * 1000;

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

function history(): StoredSession {
  return {
    threadId: 'thread-1',
    messages: [
      { id: 'user-1', role: 'user', content: 'Complete PW-103.' },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        metadata: {
          provider: { thought_signature: 'provider-opaque-value' },
          usage: { tokens: 12, cached: false, extra: [null, true] },
        },
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'update_task', arguments: '{"id":"PW-103"}' },
          },
        ],
      },
      {
        id: 'tool-1',
        role: 'tool',
        toolCallId: 'call-1',
        content: '{"ok":true,"result":{"status":"done"}}',
      },
      { id: 'assistant-2', role: 'assistant', content: 'Completed PW-103.' },
    ],
    actions: [
      {
        id: 'call-1',
        name: 'update_task',
        label: 'Complete task',
        status: 'success',
        args: { id: 'PW-103' },
        result: { status: 'done' },
        startedAt: NOW - 100,
        endedAt: NOW,
        target: '#task-PW-103',
      },
    ],
  };
}

function setup() {
  const storage = memoryStorage();
  const store = createSessionStore({
    storageKey: 'pageway:test',
    getStorage: () => storage,
    now: () => NOW,
  });
  const seed = (state: unknown, extra = {}) =>
    storage.setItem('pageway:test', JSON.stringify({ version: 1, savedAt: NOW, state, ...extra }));
  return { storage, store, seed };
}

describe('browser conversation session storage', () => {
  it('preserves approval decisions but cancels unfinished review on restoration', () => {
    const { store } = setup();
    for (const status of ['awaiting-approval', 'success', 'rejected'] as const) {
      const original = history();
      original.actions[0].status = status;
      original.actions[0].approval = {
        title: 'Review update',
        description: 'Update PW-103.',
        status:
          status === 'awaiting-approval'
            ? 'pending'
            : status === 'success'
              ? 'approved'
              : 'rejected',
        requestedAt: NOW - 100,
        ...(status !== 'awaiting-approval' ? { decidedAt: NOW } : {}),
      };
      store.save(original);
      const restored = store.load();
      expect(restored?.actions[0].approval).toEqual(original.actions[0].approval);
      expect(restored?.actions[0].status).toBe(
        status === 'awaiting-approval' ? 'cancelled' : status,
      );
    }
  });

  it('rejects malformed cached approval decisions', () => {
    const { store, seed } = setup();
    const original = history();
    seed({
      ...original,
      actions: [
        {
          ...original.actions[0],
          approval: {
            title: 'Review',
            description: 'Update',
            status: 'auto-approved',
            requestedAt: NOW,
          },
        },
      ],
    });
    expect(store.load()).toBeNull();
  });

  it('round-trips messages, provider metadata, tool results and the settled action timeline', () => {
    const { store } = setup();
    const original = history();
    store.save(original);
    const restored = store.load();
    expect(restored).toEqual(original);
    expect(restored).not.toBe(original);
    expect(restored?.messages[1]).not.toBe(original.messages[1]);
  });

  it('isolates keys and clears only the selected conversation', () => {
    const { store, storage } = setup();
    const other = createSessionStore({
      storageKey: 'pageway:other',
      getStorage: () => storage,
      now: () => NOW,
    });
    store.save(history());
    expect(other.load()).toBeNull();
    other.save({ ...history(), threadId: 'other-thread' });
    store.clear();
    expect(store.load()).toBeNull();
    expect(other.load()?.threadId).toBe('other-thread');
  });

  it('does not access storage during construction and is safe without a browser', () => {
    const getStorage = vi.fn(() => undefined);
    const store = createSessionStore({ storageKey: 'test', getStorage });
    expect(getStorage).not.toHaveBeenCalled();
    expect(store.load()).toBeNull();
    expect(() => store.save(history())).not.toThrow();
    expect(() => store.clear()).not.toThrow();
    const serverStore = createSessionStore({ storageKey: 'ssr' });
    expect(serverStore.load()).toBeNull();
    expect(() => serverStore.save(history())).not.toThrow();
    expect(() => serverStore.clear()).not.toThrow();
  });

  it('ignores denied storage access and quota failures without throwing', () => {
    const denied = createSessionStore({
      storageKey: 'test',
      getStorage: () => {
        throw new Error('Access denied');
      },
    });
    const failed = createSessionStore({
      storageKey: 'test',
      getStorage: () => ({
        getItem: () => {
          throw new Error('Blocked');
        },
        setItem: () => {
          throw new Error('Quota exceeded');
        },
        removeItem: () => {
          throw new Error('Blocked');
        },
      }),
    });
    for (const store of [denied, failed]) {
      expect(store.load()).toBeNull();
      expect(() => store.save(history())).not.toThrow();
      expect(() => store.clear()).not.toThrow();
    }
  });

  it('ignores corrupt, unsupported, expired and future-dated envelopes', () => {
    const { store, storage, seed } = setup();
    for (const raw of ['{broken', 'null', '[]', '"text"']) {
      storage.setItem('pageway:test', raw);
      expect(store.load()).toBeNull();
    }
    for (const extra of [
      { version: 2 },
      { savedAt: NOW - WEEK },
      { savedAt: NOW + 1 },
      { savedAt: 'now' },
    ]) {
      seed(history(), extra);
      expect(store.load()).toBeNull();
    }
    seed(history(), { savedAt: NOW - WEEK + 1 });
    expect(store.load()).toEqual(history());
  });

  it('rejects oversize data without truncating a tool batch or overwriting the previous valid session', () => {
    const { store, seed } = setup();
    const large = history();
    large.messages[2].content = '界'.repeat(400000);
    seed(large);
    expect(store.load()).toBeNull();
    store.save(history());
    store.save(large);
    expect(store.load()).toEqual(history());
  });

  it('turns a partially streamed final tool batch into failed results, without changing the input', () => {
    const { store, seed } = setup();
    const interrupted = history();
    interrupted.messages = interrupted.messages.slice(0, 2);
    interrupted.messages[1].toolCalls![0].function.arguments = '{"id":';
    interrupted.messages[1].toolCalls!.push({
      id: 'call-2',
      type: 'function',
      function: { name: 'inspect_page', arguments: '{}' },
    });
    interrupted.actions[0].status = 'running';
    interrupted.actions.push({
      id: 'call-2',
      name: 'inspect_page',
      label: 'Inspect',
      args: {},
      startedAt: NOW,
      status: 'planning',
    });
    seed(interrupted);
    const restored = store.load()!;
    expect(restored.messages[1].toolCalls![0].function.arguments).toBe('{}');
    expect(restored.messages.slice(2).map((message) => message.toolCallId)).toEqual([
      'call-1',
      'call-2',
    ]);
    expect(
      restored.messages.slice(2).every((message) => JSON.parse(message.content!).ok === false),
    ).toBe(true);
    expect(
      restored.actions.every((action) => action.status === 'cancelled' && action.endedAt === NOW),
    ).toBe(true);
    store.save(interrupted);
    expect(store.load()).toEqual(restored);
    expect(interrupted.actions[0].status).toBe('running');
    expect(interrupted.messages[1].toolCalls![0].function.arguments).toBe('{"id":');
  });

  it('preserves completed calls in a partially acknowledged multi-tool batch', () => {
    const { store, seed } = setup();
    const interrupted = history();
    interrupted.messages.pop();
    interrupted.messages[1].toolCalls!.push({
      id: 'call-2',
      type: 'function',
      function: { name: 'inspect_page', arguments: '{}' },
    });
    seed(interrupted);
    const restored = store.load()!;
    expect(restored.messages[2]).toEqual(interrupted.messages[2]);
    expect(restored.messages[3].toolCallId).toBe('call-2');
    expect(restored.actions[0].status).toBe('success');
  });

  it('creates unique recovery message IDs and keeps valid unfinished call arguments', () => {
    const { store, seed } = setup();
    const interrupted = history();
    interrupted.messages = interrupted.messages.slice(0, 2);
    interrupted.messages[0].id = 'pageway-restored-tool-2';
    seed(interrupted);
    const restored = store.load()!;
    expect(restored.messages[2].id).toBe('pageway-restored-tool-3');
    expect(restored.messages[1].toolCalls![0].function.arguments).toBe('{"id":"PW-103"}');
    store.save(restored);
    expect(store.load()).toEqual(restored);
  });

  it('keeps JSON keys as data without modifying object prototypes', () => {
    const { store } = setup();
    const state = history();
    state.messages[1].metadata = JSON.parse('{"__proto__":{"pagewayPolluted":true}}');
    store.save(state);
    expect(store.load()?.messages[1].metadata).toEqual(state.messages[1].metadata);
    expect(Object.prototype).not.toHaveProperty('pagewayPolluted');
  });

  it.each([
    [
      'orphan result',
      (state: StoredSession) => {
        state.messages[2].toolCallId = 'missing';
      },
    ],
    [
      'duplicate message',
      (state: StoredSession) => {
        state.messages[3].id = state.messages[0].id;
      },
    ],
    [
      'duplicate call',
      (state: StoredSession) => {
        state.messages[1].toolCalls!.push(state.messages[1].toolCalls![0]);
      },
    ],
    [
      'reordered history',
      (state: StoredSession) => {
        [state.messages[2], state.messages[3]] = [state.messages[3], state.messages[2]];
      },
    ],
    [
      'invalid completed arguments',
      (state: StoredSession) => {
        state.messages[1].toolCalls![0].function.arguments = '[]';
      },
    ],
    [
      'tool calls on user',
      (state: StoredSession) => {
        state.messages[0].toolCalls = state.messages[1].toolCalls;
      },
    ],
    [
      'invalid role',
      (state: StoredSession) => {
        state.messages[0].role = 'system' as 'user';
      },
    ],
    [
      'invalid action',
      (state: StoredSession) => {
        state.actions[0].status = 'pending' as 'running';
      },
    ],
    [
      'duplicate action',
      (state: StoredSession) => {
        state.actions.push(state.actions[0]);
      },
    ],
    [
      'invalid timestamp',
      (state: StoredSession) => {
        state.actions[0].startedAt = -1;
      },
    ],
  ])('rejects hostile cached history: %s', (_name, corrupt) => {
    const { store, seed } = setup();
    const state = history();
    corrupt(state);
    seed(state);
    expect(store.load()).toBeNull();
  });

  it('only persists conversation fields, excluding runtime options and page state', () => {
    const { store, storage } = setup();
    const state = {
      ...history(),
      headers: { Authorization: 'secret' },
      context: { password: 'secret' },
      events: [{ raw: 'secret' }],
      getTools: () => [],
    };
    store.save(state);
    const raw = storage.getItem('pageway:test')!;
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('getTools');
    expect(store.load()).toEqual(history());
  });

  it('ignores non-JSON metadata and tool results instead of serializing functions or host objects', () => {
    const { store } = setup();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const result of [
      cycle,
      () => {},
      new Date(),
      Number.NaN,
      { run: () => {} },
      {
        get secret() {
          throw new Error('Do not invoke accessors');
        },
      },
    ]) {
      const state = history();
      state.actions[0].result = result;
      expect(() => store.save(state)).not.toThrow();
      expect(store.load()).toBeNull();
    }
  });

  it('disables empty storage keys', () => {
    const getStorage = vi.fn(memoryStorage);
    const store = createSessionStore({ storageKey: ' ', getStorage });
    store.save(history());
    store.clear();
    expect(store.load()).toBeNull();
    expect(getStorage).not.toHaveBeenCalled();
  });
});
