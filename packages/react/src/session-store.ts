import type { ActionStep, PagewayMessage, PagewayToolCall } from './types.js';

export interface StoredSession {
  threadId: string;
  messages: PagewayMessage[];
  actions: ActionStep[];
}

type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SessionStoreOptions {
  storageKey: string;
  /** Accessed only by load/save/clear, so constructing a store is safe during SSR. */
  getStorage?: () => SessionStorage | undefined;
  now?: () => number;
}

export interface SessionStore {
  load(): StoredSession | null;
  save(state: StoredSession): void;
  clear(): void;
}

const VERSION = 1;
const MAX_BYTES = 1024 * 1024;
const MAX_ITEMS = 2000;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const INTERRUPTED = 'The previous page session ended before this tool completed.';

function invalid(): never {
  throw new Error('Invalid cached Pageway session.');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : invalid();
}

function identifier(value: unknown): string {
  const result = text(value);
  return result.trim() && result.length <= 512 ? result : invalid();
}

function timestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : invalid();
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) && value.length <= MAX_ITEMS ? value : invalid();
}

/** Copy JSON data explicitly: functions, DOM objects, cycles and accessors never reach storage. */
function json(value: unknown, depth = 0, budget = { remaining: 20000 }): unknown {
  if (depth > 40 || --budget.remaining < 0) return invalid();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : invalid();
  if (Array.isArray(value)) return value.map((item) => json(item, depth + 1, budget));
  const source = record(value);
  return Object.fromEntries(
    Object.entries(Object.getOwnPropertyDescriptors(source)).map(([key, descriptor]) => {
      if (!('value' in descriptor)) return invalid();
      return [key, json(descriptor.value, depth + 1, budget)];
    }),
  );
}

function jsonRecord(value: unknown): Record<string, unknown> {
  record(value);
  return json(value) as Record<string, unknown>;
}

function validArguments(value: string): boolean {
  try {
    jsonRecord(JSON.parse(value));
    return true;
  } catch {
    return false;
  }
}

function normalize(value: unknown, now: number): StoredSession {
  const state = record(value);
  const messageIds = new Set<string>();
  const callIds = new Set<string>();
  const pending = new Map<string, PagewayToolCall>();
  const messages: PagewayMessage[] = [];

  for (const raw of list(state.messages)) {
    const source = record(raw);
    const id = identifier(source.id);
    if (messageIds.has(id)) return invalid();
    messageIds.add(id);
    if (source.role !== 'user' && source.role !== 'assistant' && source.role !== 'tool')
      return invalid();
    const message: PagewayMessage = { id, role: source.role };
    if (source.content !== undefined) message.content = text(source.content);
    if (source.metadata !== undefined) message.metadata = jsonRecord(source.metadata);

    if (source.role === 'tool') {
      const callId = identifier(source.toolCallId);
      const call = pending.get(callId);
      if (!call || source.toolCalls !== undefined || message.content === undefined)
        return invalid();
      if (!validArguments(call.function.arguments)) return invalid();
      message.toolCallId = callId;
      pending.delete(callId);
    } else {
      // A tool batch must be acknowledged before another user/assistant turn.
      if (pending.size || source.toolCallId !== undefined) return invalid();
      if (source.role === 'user' && (source.toolCalls !== undefined || !message.content?.trim()))
        return invalid();
      if (source.toolCalls !== undefined) {
        const calls = list(source.toolCalls).map((rawCall): PagewayToolCall => {
          const entry = record(rawCall);
          const fn = record(entry.function);
          const call: PagewayToolCall = {
            id: identifier(entry.id),
            type: 'function',
            function: { name: identifier(fn.name), arguments: text(fn.arguments) },
          };
          if (entry.type !== 'function' || callIds.has(call.id)) return invalid();
          callIds.add(call.id);
          pending.set(call.id, call);
          return call;
        });
        if (calls.length) message.toolCalls = calls;
      }
    }
    messages.push(message);
  }

  // Reloading never resumes an old operation. Complete interrupted batches with
  // explicit failures so a subsequent model request has a valid tool history.
  for (const call of pending.values()) {
    if (!validArguments(call.function.arguments)) call.function.arguments = '{}';
    let suffix = messages.length;
    let id = `pageway-restored-tool-${suffix}`;
    while (messageIds.has(id)) id = `pageway-restored-tool-${++suffix}`;
    messageIds.add(id);
    messages.push({
      id,
      role: 'tool',
      toolCallId: call.id,
      content: JSON.stringify({ ok: false, error: INTERRUPTED }),
    });
  }
  if (messages.length > MAX_ITEMS) return invalid();

  const actionIds = new Set<string>();
  const actions = list(state.actions).map((raw): ActionStep => {
    const source = record(raw);
    const id = identifier(source.id);
    if (actionIds.has(id)) return invalid();
    actionIds.add(id);
    const status = source.status;
    if (
      status !== 'planning' &&
      status !== 'running' &&
      status !== 'success' &&
      status !== 'error' &&
      status !== 'cancelled'
    )
      return invalid();
    const action: ActionStep = {
      id,
      name: identifier(source.name),
      label: text(source.label),
      status,
      args: jsonRecord(source.args),
      startedAt: timestamp(source.startedAt),
    };
    if (source.result !== undefined) action.result = json(source.result);
    if (source.error !== undefined) action.error = text(source.error);
    if (source.target !== undefined) action.target = text(source.target);
    if (source.endedAt !== undefined) action.endedAt = timestamp(source.endedAt);
    if (source.source !== undefined) {
      if (source.source !== 'chat' && source.source !== 'webmcp') return invalid();
      action.source = source.source;
    }
    if (status === 'planning' || status === 'running') {
      action.status = 'cancelled';
      action.error = INTERRUPTED;
      action.endedAt = Math.max(action.startedAt, now);
    }
    return action;
  });

  return { threadId: identifier(state.threadId), messages, actions };
}

function bounded(value: string): boolean {
  return value.length <= MAX_BYTES && new TextEncoder().encode(value).byteLength <= MAX_BYTES;
}

/** Opt-in, best-effort browser persistence; no network, DOM state or execution is restored. */
export function createSessionStore(options: SessionStoreOptions): SessionStore {
  const getStorage =
    options.getStorage ?? (() => (typeof window === 'undefined' ? undefined : window.localStorage));
  const now = options.now ?? Date.now;
  const key = options.storageKey;
  const validKey = typeof key === 'string' && !!key.trim() && key.length <= 512;

  return {
    load() {
      try {
        if (!validKey) return null;
        const raw = getStorage()?.getItem(key);
        if (!raw || !bounded(raw)) return null;
        const envelope = record(JSON.parse(raw));
        if (envelope.version !== VERSION) return null;
        const savedAt = timestamp(envelope.savedAt);
        const current = now();
        if (current < savedAt || current - savedAt >= MAX_AGE) return null;
        return normalize(envelope.state, current);
      } catch {
        return null;
      }
    },
    save(state) {
      try {
        if (!validKey) return;
        const savedAt = now();
        const data = JSON.stringify({
          version: VERSION,
          savedAt,
          state: normalize(state, savedAt),
        });
        if (bounded(data)) getStorage()?.setItem(key, data);
      } catch {
        // Private browsing, quota exhaustion and unserializable tool results are harmless.
      }
    },
    clear() {
      try {
        if (validKey) getStorage()?.removeItem(key);
      } catch {
        // Storage can be denied independently of whether the UI is available.
      }
    },
  };
}
