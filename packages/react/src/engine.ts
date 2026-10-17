import Ajv from 'ajv';
import { readAgentEvents } from '@zllling/pageway-protocol';
import type {
  ActionStep,
  PageTool,
  PagewayEngineOptions,
  PagewayEvent,
  PagewayMessage,
  PagewaySnapshot,
  PagewayToolCall,
} from './types.js';

const uid = () => globalThis.crypto.randomUUID();
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const aborted = () => new DOMException('Operation cancelled', 'AbortError');
const isAbort = (error: unknown, signal: AbortSignal) =>
  signal.aborted || (error instanceof Error && error.name === 'AbortError');
const initialState = (): PagewaySnapshot => ({
  messages: [],
  actions: [],
  events: [],
  status: 'idle',
  error: null,
  spotlight: null,
  path: [],
  cursor: null,
  activity: null,
  animationDuration: 850,
});

/** Resolve untrusted model arguments before any registered function can run. */
export function validateToolArguments(tool: PageTool, raw: string): Record<string, unknown> {
  let args: unknown;
  try {
    args = JSON.parse(raw);
  } catch {
    throw new Error('The tool arguments are not valid JSON.');
  }
  if (!args || typeof args !== 'object' || Array.isArray(args))
    throw new Error('Tool arguments must be a JSON object.');
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  const validate = ajv.compile(tool.parameters);
  if (!validate(args))
    throw new Error(`Invalid arguments: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
  return args as Record<string, unknown>;
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const cancel = () => reject(aborted());
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

function jsonResult(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ error: 'Tool result could not be serialized.' });
  }
}

/** Framework-independent runner; only explicitly registered tools are executable. */
export class PagewayEngine {
  private snapshot = initialState();
  private listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private threadId = uid();
  private attemptedCalls = new Set<string>();
  private completedCalls = new Set<string>();
  private epoch = 0;

  constructor(private options: PagewayEngineOptions) {}

  updateOptions(options: PagewayEngineOptions) {
    this.options = options;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  private publish(patch: Partial<PagewaySnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => {
      listener();
    });
  }
  private appendMessage(message: PagewayMessage) {
    this.publish({ messages: [...this.snapshot.messages, message] });
  }
  private patchMessage(id: string, update: (message: PagewayMessage) => PagewayMessage) {
    this.publish({
      messages: this.snapshot.messages.map((message) =>
        message.id === id ? update(message) : message,
      ),
    });
  }
  private ensureAssistant(id: string) {
    const existing = this.snapshot.messages.find((message) => message.id === id);
    if (existing && existing.role !== 'assistant')
      throw new Error('Agent emitted an invalid assistant message identifier.');
    if (!existing) this.appendMessage({ id, role: 'assistant', content: '' });
  }
  private attachMetadata(id: string, metadata: unknown) {
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      this.patchMessage(id, (message) => ({
        ...message,
        metadata: { ...message.metadata, ...(metadata as Record<string, unknown>) },
      }));
    }
  }
  private patchAction(id: string, patch: Partial<ActionStep>) {
    this.publish({
      actions: this.snapshot.actions.map((action) =>
        action.id === id ? { ...action, ...patch } : action,
      ),
    });
  }
  private finishCall(call: PagewayToolCall, result: unknown) {
    if (this.completedCalls.has(call.id)) return;
    this.completedCalls.add(call.id);
    this.appendMessage({
      id: uid(),
      role: 'tool',
      toolCallId: call.id,
      content: jsonResult(result),
    });
  }
  private normalizeInterruptedCall(call: PagewayToolCall) {
    try {
      const args = JSON.parse(call.function.arguments);
      if (args && typeof args === 'object' && !Array.isArray(args)) return;
    } catch {
      /* A cancelled token stream can end in the middle of JSON. */
    }
    // Keep failed history valid for the next provider request. The failure tool
    // result makes it explicit that this placeholder was never executed.
    this.publish({
      messages: this.snapshot.messages.map((message) =>
        message.toolCalls?.some((entry) => entry.id === call.id)
          ? {
              ...message,
              toolCalls: message.toolCalls.map((entry) =>
                entry.id === call.id
                  ? { ...entry, function: { ...entry.function, arguments: '{}' } }
                  : entry,
              ),
            }
          : message,
      ),
    });
  }

  stop = () => {
    this.controller?.abort();
  };
  reset = () => {
    this.stop();
    this.epoch += 1;
    this.controller = null;
    this.threadId = uid();
    this.attemptedCalls.clear();
    this.completedCalls.clear();
    this.snapshot = initialState();
    this.listeners.forEach((listener) => {
      listener();
    });
  };

  sendMessage = async (text: string): Promise<void> => {
    if (!text.trim() || this.controller) return;
    const epoch = this.epoch;
    const controller = new AbortController();
    this.controller = controller;
    const { signal } = controller;
    const pending = new Map<string, PagewayToolCall>();
    this.appendMessage({ id: uid(), role: 'user', content: text.trim() });
    this.publish({
      status: 'running',
      error: null,
      spotlight: null,
      path: [],
      cursor: this.cursorOrigin(),
      activity: { phase: 'planning', label: 'Understanding your request' },
      animationDuration: this.motionDuration(),
    });
    try {
      for (let round = 0; round < 12; round += 1) {
        signal.throwIfAborted();
        const calls = await this.runRound(signal, pending);
        if (!calls.length) {
          if (epoch === this.epoch)
            this.publish({ status: 'idle', spotlight: null, activity: null });
          return;
        }
        for (const call of calls) {
          signal.throwIfAborted();
          await this.executeCall(call, signal);
          pending.delete(call.id);
        }
      }
      throw new Error(
        'The agent reached the limit of 12 tool rounds. Send a new message to continue.',
      );
    } catch (error) {
      if (epoch !== this.epoch) return;
      const cancelled = isAbort(error, signal);
      const message = cancelled ? 'Cancelled by user.' : errorText(error);
      for (const call of pending.values()) {
        // Cancelling during a completion acknowledgment must not relabel an
        // already-applied operation as cancelled.
        if (this.completedCalls.has(call.id)) continue;
        this.normalizeInterruptedCall(call);
        this.patchAction(call.id, {
          status: cancelled ? 'cancelled' : 'error',
          error: message,
          endedAt: Date.now(),
        });
        this.finishCall(call, { ok: false, error: message });
      }
      this.publish({
        status: cancelled ? 'idle' : 'error',
        error: cancelled ? null : message,
        spotlight: null,
        activity: null,
      });
    } finally {
      if (epoch === this.epoch && this.controller === controller) this.controller = null;
    }
  };

  private async runRound(
    signal: AbortSignal,
    pending: Map<string, PagewayToolCall>,
  ): Promise<PagewayToolCall[]> {
    this.publish({
      activity: {
        phase: 'planning',
        label: this.snapshot.actions.length
          ? 'Planning the next step'
          : 'Understanding your request',
      },
      spotlight: null,
    });
    const runId = uid();
    const contexts = this.options.getContexts();
    const tools = this.options
      .getTools()
      .map(({ name, description, parameters }) => ({ name, description, parameters }));
    const request = {
      threadId: this.threadId,
      runId,
      messages: this.snapshot.messages,
      tools,
      context: contexts.map(({ id, title, description, data }) => ({
        description: `${title}${description ? ` — ${description}` : ''}`,
        value: jsonResult({ id, data }),
      })),
      state: { page: contexts },
      forwardedProps: { source: '@zllling/pageway-react' },
    };
    const response = await (this.options.fetch ?? globalThis.fetch)(this.options.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...this.options.headers,
      },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 600);
      throw new Error(`Agent request failed (${response.status})${detail ? `: ${detail}` : ''}`);
    }
    if (!response.body) throw new Error('The agent returned an empty response.');
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream'))
      throw new Error('Expected an AG-UI text/event-stream response.');
    const calls = new Map<string, PagewayToolCall>();
    const endedCalls = new Set<string>();
    const parentMessages = new Map<string, string>();
    let assistantId: string | undefined;
    let started = false;
    let finished = false;
    for await (const rawEvent of readAgentEvents(response.body, signal)) {
      signal.throwIfAborted();
      const event = rawEvent as unknown as PagewayEvent;
      if (!started && event.type !== 'RUN_STARTED')
        throw new Error('The agent stream must begin with RUN_STARTED.');
      this.publish({ events: [...this.snapshot.events.slice(-249), event] });
      const messageId = typeof event.messageId === 'string' ? event.messageId : undefined;
      switch (event.type) {
        case 'RUN_STARTED': {
          if (started || event.threadId !== this.threadId || event.runId !== runId)
            throw new Error('Agent run identifiers do not match the current request.');
          started = true;
          break;
        }
        case 'TEXT_MESSAGE_START': {
          if (!messageId) throw new Error('Agent omitted a message identifier.');
          assistantId = messageId;
          this.ensureAssistant(messageId);
          break;
        }
        case 'TEXT_MESSAGE_CONTENT': {
          if (!messageId || typeof event.delta !== 'string')
            throw new Error('Invalid assistant text event.');
          this.ensureAssistant(messageId);
          const delta = event.delta;
          this.patchMessage(messageId, (message) => ({
            ...message,
            content: (message.content ?? '') + delta,
          }));
          break;
        }
        case 'TEXT_MESSAGE_END': {
          if (messageId) this.attachMetadata(messageId, event.metadata);
          break;
        }
        case 'TOOL_CALL_START': {
          const id = event.toolCallId;
          const name = event.toolCallName;
          if (typeof id !== 'string' || typeof name !== 'string')
            throw new Error('Invalid tool call event.');
          if (calls.has(id) || this.attemptedCalls.has(id) || this.completedCalls.has(id))
            throw new Error(`Duplicate tool call identifier: ${id}`);
          const call: PagewayToolCall = { id, type: 'function', function: { name, arguments: '' } };
          const parentId =
            typeof event.parentMessageId === 'string'
              ? event.parentMessageId
              : (assistantId ?? uid());
          assistantId = parentId;
          this.ensureAssistant(parentId);
          this.attachMetadata(parentId, event.metadata);
          parentMessages.set(id, parentId);
          calls.set(id, call);
          pending.set(id, call);
          this.patchMessage(parentId, (message) => ({
            ...message,
            toolCalls: [...(message.toolCalls ?? []), call],
          }));
          const tool = this.options.getTools().find((candidate) => candidate.name === name);
          this.publish({
            actions: [
              ...this.snapshot.actions,
              {
                id,
                name,
                label: tool?.description ?? name,
                status: 'planning',
                args: {},
                startedAt: Date.now(),
              },
            ],
          });
          break;
        }
        case 'TOOL_CALL_ARGS': {
          const id = String(event.toolCallId);
          const call = calls.get(id);
          const parentId = parentMessages.get(id);
          if (!call || !parentId || endedCalls.has(id) || typeof event.delta !== 'string')
            throw new Error('Received arguments for an unknown or completed tool call.');
          const updated = {
            ...call,
            function: { ...call.function, arguments: call.function.arguments + event.delta },
          };
          if (updated.function.arguments.length > 200_000)
            throw new Error('Tool arguments exceeded the 200 KB limit.');
          calls.set(id, updated);
          pending.set(id, updated);
          this.patchMessage(parentId, (message) => ({
            ...message,
            toolCalls: message.toolCalls?.map((entry) => (entry.id === id ? updated : entry)),
          }));
          try {
            const args = JSON.parse(updated.function.arguments);
            if (args && typeof args === 'object' && !Array.isArray(args))
              this.patchAction(id, { args });
          } catch {
            /* Streaming JSON is expected to be incomplete until TOOL_CALL_END. */
          }
          break;
        }
        case 'TOOL_CALL_END': {
          const id = String(event.toolCallId);
          const parentId = parentMessages.get(id);
          if (!calls.has(id) || !parentId || endedCalls.has(id))
            throw new Error('Received an end event for an unknown or completed tool call.');
          endedCalls.add(id);
          this.attachMetadata(parentId, event.metadata);
          break;
        }
        case 'RUN_ERROR':
          throw new Error(
            typeof event.message === 'string' ? event.message : 'The agent run failed.',
          );
        case 'RUN_FINISHED': {
          if (event.threadId !== this.threadId || event.runId !== runId)
            throw new Error('Agent completion identifiers do not match the current request.');
          finished = true;
          break;
        }
      }
      if (finished) break;
    }
    if (!finished) throw new Error('The agent stream ended before RUN_FINISHED.');
    if ([...calls.keys()].some((id) => !endedCalls.has(id)))
      throw new Error('The agent stream ended with an unfinished tool call.');
    return [...calls.values()];
  }

  private async executeCall(call: PagewayToolCall, signal: AbortSignal) {
    this.attemptedCalls.add(call.id);
    const tool = this.options.getTools().find((candidate) => candidate.name === call.function.name);
    try {
      if (!tool) throw new Error(`The page has not registered the tool "${call.function.name}".`);
      const args = validateToolArguments(tool, call.function.arguments || '{}');
      if (!call.function.arguments) this.normalizeInterruptedCall(call);
      this.patchAction(call.id, {
        status: 'running',
        args,
        target: typeof tool.target === 'string' ? tool.target : undefined,
      });
      await this.revealTarget(tool, args, call.id, signal);
      signal.throwIfAborted();
      const result = await withAbort(
        Promise.resolve().then(() => {
          signal.throwIfAborted();
          // Scrolling/highlighting can outlive a React render or component unmount.
          // Resolve both the capability and its schema at the moment of execution.
          const currentTool = this.options
            .getTools()
            .find((candidate) => candidate.name === call.function.name);
          if (!currentTool)
            throw new Error(
              `The tool "${call.function.name}" is no longer registered on this page.`,
            );
          const currentArgs = validateToolArguments(currentTool, call.function.arguments || '{}');
          this.patchAction(call.id, { args: currentArgs });
          return currentTool.execute(currentArgs, { signal });
        }),
        signal,
      );
      signal.throwIfAborted();
      this.patchAction(call.id, { status: 'success', result, endedAt: Date.now() });
      this.finishCall(call, { ok: true, result: result ?? null });
      await this.refreshTarget(
        this.options.getTools().find((candidate) => candidate.name === tool.name) ?? tool,
        args,
        call.id,
        signal,
      );
      await this.acknowledgeStep(tool.name, 'success', signal);
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      const message = errorText(error);
      this.normalizeInterruptedCall(call);
      this.patchAction(call.id, { status: 'error', error: message, endedAt: Date.now() });
      this.finishCall(call, { ok: false, error: message });
      await this.acknowledgeStep(call.function.name, 'error', signal);
    }
  }

  private motionDuration() {
    const reducedMotion =
      globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    return reducedMotion ? 0 : Math.max(0, this.options.animationDuration ?? 850);
  }

  private cursorOrigin(): { x: number; y: number } | null {
    if (typeof document === 'undefined') return null;
    const composer = document.querySelector<HTMLElement>('[data-pageway-origin]');
    if (composer) {
      const rect = composer.getBoundingClientRect();
      return this.viewportPoint({
        left: rect.left + rect.width * 0.8,
        top: rect.top + rect.height / 2,
        width: 0,
        height: 0,
      });
    }
    return {
      x: Math.max(30, (globalThis.innerWidth || 1200) - 120),
      y: Math.max(30, (globalThis.innerHeight || 800) - 90),
    };
  }

  private async acknowledgeStep(toolName: string, phase: 'success' | 'error', signal: AbortSignal) {
    this.publish({
      activity: {
        phase,
        label: phase === 'success' ? 'Step completed' : 'This step could not be completed',
        toolName,
      },
    });
    if (typeof document !== 'undefined')
      await delay(
        this.motionDuration() ? Math.max(600, Math.min(800, this.motionDuration() * 0.7)) : 180,
        signal,
      );
  }

  private viewportPoint(rect: { left: number; top: number; width: number; height: number }) {
    const viewportWidth = globalThis.innerWidth || 1200;
    const viewportHeight = globalThis.innerHeight || 800;
    const clamp = (value: number, maximum: number) =>
      Math.min(Math.max(12, value), Math.max(12, maximum - 12));
    // Aim at the visible intersection, including targets larger than a viewport.
    return {
      x: (clamp(rect.left, viewportWidth) + clamp(rect.left + rect.width, viewportWidth)) / 2,
      y: (clamp(rect.top, viewportHeight) + clamp(rect.top + rect.height, viewportHeight)) / 2,
    };
  }

  private async measureTarget(
    tool: PageTool,
    args: Record<string, unknown>,
    signal: AbortSignal,
    alwaysScroll: boolean,
  ) {
    if (typeof document === 'undefined' || !tool.target) return null;
    const resolveElement = () =>
      typeof tool.target === 'string'
        ? document.querySelector<HTMLElement>(tool.target)
        : (tool.target?.(args) ?? null);
    let element: HTMLElement | null = null;
    try {
      element = resolveElement();
    } catch {
      return null;
    }
    if (!element) return null;
    const bounds = element.getBoundingClientRect();
    const outside =
      bounds.left < 0 ||
      bounds.top < 0 ||
      bounds.left + bounds.width > (globalThis.innerWidth || 1200) ||
      bounds.top + bounds.height > (globalThis.innerHeight || 800);
    if (alwaysScroll || outside) {
      // Instant scrolling has a deterministic final geometry. A short cancellable
      // layout turn avoids measuring a long smooth scroll midway through its trip.
      element.scrollIntoView?.({ behavior: 'instant', block: 'center', inline: 'nearest' });
      await delay(32, signal);
      try {
        element = resolveElement();
      } catch {
        return null;
      }
      if (!element) return null;
    }
    signal.throwIfAborted();
    const { left, top, width, height } = element.getBoundingClientRect();
    return { left, top, width, height };
  }

  private async refreshTarget(
    tool: PageTool,
    args: Record<string, unknown>,
    id: string,
    signal: AbortSignal,
  ) {
    const rect = await this.measureTarget(tool, args, signal, false);
    if (!rect) return;
    const point = this.viewportPoint(rect);
    const previous = this.snapshot.cursor;
    const changed =
      !previous || Math.abs(previous.x - point.x) + Math.abs(previous.y - point.y) > 2;
    this.publish({
      spotlight: { id, label: tool.name, rect },
      cursor: point,
      ...(changed ? { path: [...this.snapshot.path.slice(-15), point] } : {}),
    });
  }

  private async revealTarget(
    tool: PageTool,
    args: Record<string, unknown>,
    id: string,
    signal: AbortSignal,
  ) {
    this.publish({
      spotlight: null,
      activity: { phase: 'acting', label: tool.description, toolName: tool.name },
    });
    if (typeof document === 'undefined') return;
    const duration = this.motionDuration();
    const rect = await this.measureTarget(tool, args, signal, true);
    if (!rect) {
      await delay(duration ? 160 : 80, signal);
      return;
    }
    const point = this.viewportPoint(rect);
    const path = this.snapshot.path.slice(-15);
    if (!path.length) path.push(this.snapshot.cursor ?? this.cursorOrigin() ?? point);
    this.publish({
      spotlight: { id, label: tool.name, rect },
      path: [...path, point],
      cursor: point,
      activity: {
        phase: duration ? 'moving' : 'acting',
        label: tool.description,
        toolName: tool.name,
      },
      animationDuration: duration,
    });
    if (duration) await delay(duration, signal);
    this.publish({ activity: { phase: 'acting', label: tool.description, toolName: tool.name } });
    await delay(duration ? 160 : 80, signal);
  }
}
