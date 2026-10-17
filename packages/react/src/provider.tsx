import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { PageContext } from '@zllling/pageway-protocol';
import { PagewayEngine } from './engine.js';
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
  tools: PagewayToolInfo[];
}

const StateContext = createContext<PagewayValue | null>(null);
const RegistryContext = createContext<Registry | null>(null);

export interface PagewayProviderProps {
  endpoint: string;
  children: ReactNode;
  headers?: Record<string, string>;
  animationDuration?: number;
}

export function PagewayProvider({
  endpoint,
  headers,
  animationDuration,
  children,
}: PagewayProviderProps) {
  const toolRegistry = useRef(new Map<string, () => PageTool>());
  const contextRegistry = useRef(new Map<string, () => PageContext>());
  const [tools, setTools] = useState<PagewayToolInfo[]>([]);
  const getTools = useCallback(() => [...toolRegistry.current.values()].map((read) => read()), []);
  const getContexts = useCallback(
    () => [...contextRegistry.current.values()].map((read) => read()),
    [],
  );
  const [engine] = useState(
    () => new PagewayEngine({ endpoint, headers, animationDuration, getTools, getContexts }),
  );
  useLayoutEffect(() => {
    engine.updateOptions({ endpoint, headers, animationDuration, getTools, getContexts });
  });
  useEffect(() => () => engine.stop(), [engine]);
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);

  const refreshTools = useCallback(() => {
    const next = getTools().map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
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
      sendMessage: engine.sendMessage,
      stop: engine.stop,
      reset: engine.reset,
    }),
    [snapshot, tools, engine],
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
  useLayoutEffect(
    () =>
      registry.registerTool(
        definition.name,
        () =>
          ({
            ...current.current,
            execute: async (args: Record<string, unknown>, context: { signal: AbortSignal }) => {
              // Commit synchronous updates before another tool reads the application.
              let result: unknown;
              flushSync(() => {
                result = current.current.execute(args as T, context);
              });
              const value = await result;
              // Async handlers can schedule another update immediately before resolving.
              flushSync(() => {});
              return value;
            },
          }) as unknown as PageTool,
      ),
    [registry, definition.name],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: Tool metadata lives in a ref; these values explicitly trigger public registry refreshes.
  useLayoutEffect(() => {
    registry.refreshTools();
  }, [registry, definition.name, definition.description, schemaKey]);
}

/** Publish only the application state that the agent needs to understand this page. */
export function usePageContext(context: PageContext): void {
  const registry = useRegistry();
  const current = useRef(context);
  current.current = context;
  useLayoutEffect(
    () => registry.registerContext(context.id, () => current.current),
    [registry, context.id],
  );
}
