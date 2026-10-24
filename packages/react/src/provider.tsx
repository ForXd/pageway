import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactElement, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { PageContext } from '@zllling/pageway-protocol';
import { PagewayEngine } from './engine.js';
import { useClientLayoutEffect } from './client-effect.js';
import { createWebMCPBridge } from './webmcp.js';
import type { WebMCPOptions, WebMCPState } from './webmcp.js';
import type { PageTool, PagewaySnapshot, PagewayToolInfo } from './types.js';

interface Registry {
  registerTool: (name: string, read: () => PageTool) => () => void;
  registerContext: (id: string, read: () => PageContext) => () => void;
  refreshTools: () => void;
}

export interface PagewayValue extends PagewaySnapshot {
  sendMessage: (text: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
  approveAction: (id: string) => boolean;
  rejectAction: (id: string) => boolean;
  tools: PagewayToolInfo[];
  webmcp: WebMCPState;
}

const StateContext = createContext<PagewayValue | null>(null);
const RegistryContext = createContext<Registry | null>(null);

export interface PagewayProviderProps {
  /** Existing AG-UI agent endpoint. Omit for WebMCP-only pages. */
  endpoint?: string;
  /** OpenAI-compatible API root, e.g. /api/openai or https://proxy.example/v1. */
  apiOrigin?: string;
  /** Appended to apiOrigin; defaults to chat/completions. */
  apiPath?: string;
  model?: string;
  /** OpenAI round timeout including stream consumption. Default 180 s; maximum 300 s. */
  timeoutMs?: number;
  /** Opt-in local conversation cache. Scope this to the current user/workspace. */
  storageKey?: string;
  /** Expose registered tools to browser agents when WebMCP is available. Default true. */
  webmcp?: boolean | WebMCPOptions;
  children: ReactNode;
  headers?: Record<string, string>;
  animationDuration?: number;
  /** Optional transport for browser-local agents and custom HTTP clients. */
  fetch?: typeof globalThis.fetch;
}

export function PagewayProvider({
  endpoint,
  apiOrigin,
  apiPath,
  model,
  timeoutMs,
  storageKey,
  webmcp = true,
  headers,
  animationDuration,
  fetch: fetcher,
  children,
}: PagewayProviderProps): ReactElement {
  const toolRegistry = useRef(new Map<string, () => PageTool>());
  const contextRegistry = useRef(new Map<string, () => PageContext>());
  const [tools, setTools] = useState<PagewayToolInfo[]>([]);
  const getTools = useCallback(() => [...toolRegistry.current.values()].map((read) => read()), []);
  const getContexts = useCallback(
    () => [...contextRegistry.current.values()].map((read) => read()),
    [],
  );
  const [engine] = useState(
    () =>
      new PagewayEngine({
        endpoint,
        apiOrigin,
        apiPath,
        model,
        timeoutMs,
        headers,
        animationDuration,
        fetch: fetcher,
        getTools,
        getContexts,
      }),
  );
  useClientLayoutEffect(() => {
    engine.updateOptions({
      endpoint,
      apiOrigin,
      apiPath,
      model,
      timeoutMs,
      headers,
      animationDuration,
      fetch: fetcher,
      getTools,
      getContexts,
    });
  });
  useClientLayoutEffect(() => engine.configureSession(storageKey), [engine, storageKey]);
  useEffect(() => {
    const suspend = () => {
      engine.stop();
      engine.saveSession();
    };
    window.addEventListener('pagehide', suspend);
    return () => {
      window.removeEventListener('pagehide', suspend);
      suspend();
    };
  }, [engine]);
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const bridge = useRef<ReturnType<typeof createWebMCPBridge> | null>(null);
  const [webmcpState, setWebmcpState] = useState<WebMCPState>({
    status: 'disabled',
    registered: [],
    error: null,
  });
  const webmcpEnabled = webmcp !== false;
  const prefix = typeof webmcp === 'object' ? webmcp.prefix : undefined;
  useEffect(() => {
    if (!webmcpEnabled) {
      setWebmcpState({ status: 'disabled', registered: [], error: null });
      return;
    }
    let active = true;
    const current = createWebMCPBridge({
      prefix,
      getTools,
      getContexts,
      executeTool: engine.executeTool,
      onChange: (state) => {
        if (active) setWebmcpState(state);
      },
    });
    bridge.current = current;
    setWebmcpState(current.getSnapshot());
    return () => {
      active = false;
      bridge.current = null;
      current.dispose();
    };
  }, [engine, getTools, getContexts, webmcpEnabled, prefix]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Registry metadata changes trigger synchronization while execute reads the latest tool callback.
  useEffect(() => bridge.current?.sync(), [tools]);

  const refreshTools = useCallback(() => {
    const next = getTools().map(({ name, description, parameters, enabled, allowedSources }) => ({
      name,
      description,
      parameters,
      enabled,
      allowedSources,
    }));
    setTools((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
  }, [getTools]);
  const registerTool = useCallback(
    (name: string, read: () => PageTool) => {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name))
        throw new Error(
          `Invalid Pageway tool name "${name}". Use 1–64 letters, numbers, underscores, or hyphens.`,
        );
      if (toolRegistry.current.has(name))
        throw new Error(`A Pageway tool named "${name}" is already registered.`);
      toolRegistry.current.set(name, read);
      refreshTools();
      return () => {
        if (toolRegistry.current.get(name) === read) {
          toolRegistry.current.delete(name);
          refreshTools();
        }
      };
    },
    [refreshTools],
  );
  const registerContext = useCallback((id: string, read: () => PageContext) => {
    if (contextRegistry.current.has(id))
      throw new Error(`A Pageway context named "${id}" is already registered.`);
    contextRegistry.current.set(id, read);
    return () => {
      if (contextRegistry.current.get(id) === read) contextRegistry.current.delete(id);
    };
  }, []);
  const registry = useMemo(
    () => ({ registerTool, registerContext, refreshTools }),
    [registerTool, registerContext, refreshTools],
  );
  const value = useMemo(
    () => ({
      ...snapshot,
      tools,
      webmcp: webmcpState,
      sendMessage: engine.sendMessage,
      stop: engine.stop,
      reset: engine.reset,
      approveAction: engine.approveAction,
      rejectAction: engine.rejectAction,
    }),
    [snapshot, tools, engine, webmcpState],
  );
  return (
    <RegistryContext.Provider value={registry}>
      <StateContext.Provider value={value}>{children}</StateContext.Provider>
    </RegistryContext.Provider>
  );
}

export function usePageway(): PagewayValue {
  const value = useContext(StateContext);
  if (!value) throw new Error('usePageway must be called inside PagewayProvider.');
  return value;
}

function useRegistry(): Registry {
  const registry = useContext(RegistryContext);
  if (!registry) throw new Error('Pageway hooks must be called inside PagewayProvider.');
  return registry;
}

/** Register a narrow capability. The current callback and state are read at execution time. */
export function usePageTool<T extends Record<string, unknown>>(definition: PageTool<T>): void {
  const registry = useRegistry();
  const current = useRef(definition);
  current.current = definition;
  const schemaKey = JSON.stringify(definition.parameters);
  const sourcesKey = JSON.stringify(definition.allowedSources);
  useClientLayoutEffect(() => {
    // Keep this identity for the lifetime of one registration so a pending
    // approval cannot be transferred to a replacement tool with the same name.
    const execute = async (args: Record<string, unknown>, context: { signal: AbortSignal }) => {
      // Commit synchronous updates before another tool reads the application.
      let result: unknown;
      flushSync(() => {
        result = current.current.execute(args as T, context);
      });
      const value = await result;
      // Async handlers can schedule another update immediately before resolving.
      flushSync(() => {});
      return value;
    };
    return registry.registerTool(
      definition.name,
      () => ({ ...current.current, execute }) as unknown as PageTool,
    );
  }, [registry, definition.name]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Tool metadata lives in a ref; these values explicitly trigger public registry refreshes.
  useClientLayoutEffect(() => {
    registry.refreshTools();
  }, [
    registry,
    definition.name,
    definition.description,
    definition.enabled,
    schemaKey,
    sourcesKey,
  ]);
}

/** Publish only the application state that the agent needs to understand this page. */
export function usePageContext(context: PageContext): void {
  const registry = useRegistry();
  const current = useRef(context);
  current.current = context;
  useClientLayoutEffect(
    () => registry.registerContext(context.id, () => current.current),
    [registry, context.id],
  );
}
