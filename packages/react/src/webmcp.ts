import type { JSONSchema, PageContext, PageTool } from './types.js';
import { isToolAllowed } from './tool-policy.js';

export interface WebMCPOptions {
  /** Namespace shared by page tools and the built-in get_context tool. */
  prefix?: string;
}

export interface WebMCPState {
  status: 'disabled' | 'unsupported' | 'registering' | 'ready' | 'error';
  registered: string[];
  error: string | null;
}

export type WebMCPToolResult = { ok: true; result: unknown } | { ok: false; error: string };

interface BrowserTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  annotations?: { readOnlyHint: boolean };
  execute: (args: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>;
}

interface ModelContext {
  registerTool: (tool: BrowserTool, options?: { signal: AbortSignal }) => void | Promise<void>;
  unregisterTool?: (name: string) => void;
}

export interface WebMCPBridgeOptions extends WebMCPOptions {
  getTools: () => PageTool[];
  getContexts: () => PageContext[];
  executeTool: (
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<WebMCPToolResult>;
  onChange?: (state: WebMCPState) => void;
}

export interface WebMCPBridge {
  sync: () => void;
  dispose: () => void;
  getSnapshot: () => WebMCPState;
}

interface Registration {
  name: string;
  fingerprint: string;
  controller: AbortController;
  active: boolean;
  registered: boolean;
  pending: boolean;
  error: string | null;
}

// A legacy asynchronous registration may finish after a StrictMode cleanup. Serialize
// registrations for each browser/name so its cleanup cannot remove the next owner's tool.
const registrations = new WeakMap<ModelContext, Map<string, Promise<void>>>();

function enqueue(context: ModelContext, name: string, run: () => Promise<void>) {
  let queue = registrations.get(context);
  if (!queue) {
    queue = new Map();
    registrations.set(context, queue);
  }
  const pending = (queue.get(name) ?? Promise.resolve()).then(run);
  queue.set(name, pending);
  void pending.then(() => {
    if (queue.get(name) === pending) queue.delete(name);
  });
}

function findModelContext(): { context: ModelContext; legacy: boolean } | null {
  const current =
    typeof document === 'undefined'
      ? undefined
      : (document as Document & { modelContext?: ModelContext }).modelContext;
  if (typeof current?.registerTool === 'function') return { context: current, legacy: false };
  const legacy =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
  if (typeof legacy?.registerTool === 'function' && typeof legacy.unregisterTool === 'function') {
    return { context: legacy, legacy: true };
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Adapts Pageway's registry to the browser's WebMCP API without installing a polyfill. */
export function createWebMCPBridge(options: WebMCPBridgeOptions): WebMCPBridge {
  let browser: ReturnType<typeof findModelContext> = null;
  let configurationError: string | null = null;
  try {
    browser = findModelContext();
  } catch (error) {
    configurationError = errorMessage(error);
  }
  const prefix = options.prefix ?? 'pageway_';
  const contextName = `${prefix}get_context`;
  const entries = new Map<string, Registration>();
  // Registration objects are replaced when metadata changes. Running calls belong
  // to the capability's name, so an ordinary React render must not cancel them.
  const invocations = new Map<string, Set<AbortController>>();
  const lifetime = new AbortController();
  let disposed = false;
  let snapshot: WebMCPState = { status: 'unsupported', registered: [], error: null };

  function emit() {
    if (disposed) return;
    const values = [...entries.values()];
    const error = configurationError ?? values.find((entry) => entry.error)?.error ?? null;
    snapshot = {
      status: error
        ? 'error'
        : !browser
          ? 'unsupported'
          : values.some((entry) => entry.pending)
            ? 'registering'
            : 'ready',
      registered: values.filter((entry) => entry.registered).map((entry) => entry.name),
      error,
    };
    options.onChange?.(snapshot);
  }

  function unregister(entry: Registration) {
    entry.active = false;
    // Native AbortSignal ownership is established only by a successful registration;
    // a rejected name collision never grants us ownership of an existing tool.
    entry.controller.abort();
    if (browser?.legacy && entry.registered) {
      entry.registered = false;
      try {
        browser.context.unregisterTool?.(entry.name);
      } catch (error) {
        configurationError = errorMessage(error);
      }
    }
  }

  async function invoke(
    entry: Registration,
    toolName: string | null,
    args: Record<string, unknown>,
    requestSignal?: AbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController();
    const running = invocations.get(entry.name) ?? new Set<AbortController>();
    running.add(controller);
    invocations.set(entry.name, running);
    const abort = () => controller.abort();
    lifetime.signal.addEventListener('abort', abort, { once: true });
    requestSignal?.addEventListener('abort', abort, { once: true });
    if (lifetime.signal.aborted || requestSignal?.aborted) abort();
    let result: WebMCPToolResult;
    try {
      if (!entry.active) throw new Error('This Pageway tool is no longer registered.');
      if (controller.signal.aborted) throw new Error('The Pageway tool call was cancelled.');
      result =
        toolName !== null
          ? await options.executeTool(toolName, args, controller.signal)
          : { ok: true, result: { page: options.getContexts() } };
      if (result.ok && result.result === undefined) result = { ok: true, result: null };
      // Both APIs require JSON-serializable results. Keep serialization errors in the
      // result channel instead of leaking an unhandled promise from a browser callback.
      result = JSON.parse(JSON.stringify(result)) as WebMCPToolResult;
    } catch (error) {
      result = { ok: false, error: errorMessage(error) };
    } finally {
      lifetime.signal.removeEventListener('abort', abort);
      requestSignal?.removeEventListener('abort', abort);
      running.delete(controller);
      if (!running.size && invocations.get(entry.name) === running) invocations.delete(entry.name);
    }
    return browser?.legacy
      ? { content: [{ type: 'text', text: JSON.stringify(result) }], isError: !result.ok }
      : result;
  }

  function register(tool: Omit<BrowserTool, 'execute'>, toolName: string | null) {
    const fingerprint = JSON.stringify(tool);
    const previous = entries.get(tool.name);
    if (previous?.fingerprint === fingerprint) return;
    if (previous) unregister(previous);
    const entry: Registration = {
      name: tool.name,
      fingerprint,
      controller: new AbortController(),
      active: true,
      registered: false,
      pending: true,
      error: null,
    };
    entries.set(tool.name, entry);
    const target = browser;
    if (!target) return;
    enqueue(target.context, tool.name, async () => {
      if (!entry.active) return;
      try {
        const definition: BrowserTool = {
          ...tool,
          execute: (args, callOptions) => invoke(entry, toolName, args, callOptions?.signal),
        };
        await target.context.registerTool(
          definition,
          target.legacy ? undefined : { signal: entry.controller.signal },
        );
        entry.registered = true;
        if (!entry.active) unregister(entry);
      } catch (error) {
        if (entry.active) entry.error = `${tool.name}: ${errorMessage(error)}`;
      } finally {
        entry.pending = false;
        emit();
      }
    });
  }

  function sync() {
    if (disposed) return;
    if (!browser) {
      emit();
      return;
    }
    configurationError = null;
    const desired = new Set<string>();
    try {
      const definitions: { tool: Omit<BrowserTool, 'execute'>; original: string | null }[] = [
        {
          original: null,
          tool: {
            name: contextName,
            description: 'Read the latest page context explicitly exposed by this application.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            annotations: { readOnlyHint: true },
          },
        },
        ...options
          .getTools()
          .filter((tool) => isToolAllowed(tool, 'webmcp'))
          .map((tool) => ({
            original: tool.name,
            tool: {
              name: `${prefix}${tool.name}`,
              description: tool.description,
              inputSchema: tool.parameters,
            },
          })),
      ];
      for (const { tool, original } of definitions) {
        if (!/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name)) {
          configurationError = `Invalid WebMCP tool name: ${tool.name}`;
          continue;
        }
        if (desired.has(tool.name)) {
          configurationError = `Duplicate WebMCP tool name: ${tool.name}`;
          continue;
        }
        desired.add(tool.name);
        register(tool, original);
      }
    } catch (error) {
      configurationError = errorMessage(error);
    }
    for (const [name, entry] of entries) {
      if (!desired.has(name)) {
        for (const controller of invocations.get(name) ?? []) controller.abort();
        invocations.delete(name);
        unregister(entry);
        entries.delete(name);
      }
    }
    emit();
  }

  sync();
  return {
    sync,
    getSnapshot: () => snapshot,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      lifetime.abort();
      invocations.clear();
      for (const entry of entries.values()) unregister(entry);
      entries.clear();
      snapshot = { status: 'disabled', registered: [], error: null };
    },
  };
}
