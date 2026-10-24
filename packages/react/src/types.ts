import type { JSONSchema, PageContext } from '@zllling/pageway-protocol';

export type { JSONSchema, PageContext } from '@zllling/pageway-protocol';

export type PagewayActionSource = 'chat' | 'webmcp';

export interface PageToolApproval {
  title: string;
  description: string;
}

export interface PendingApproval extends PageToolApproval {
  /** Opaque, single-use approval token; distinct from the model's tool-call ID. */
  id: string;
  name: string;
  args: Record<string, unknown>;
  source: PagewayActionSource;
}

export interface PageTool<T extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: JSONSchema;
  target?: string | ((args: T) => HTMLElement | null);
  /** Defaults to true. Disabled tools are neither advertised nor executable. */
  enabled?: boolean;
  /** Defaults to both sources. An empty list disables all agent access. */
  allowedSources?: PagewayActionSource[];
  /** Application-owned review text. Return false for calls that need no approval. */
  approval?: PageToolApproval | ((args: T) => PageToolApproval | false);
  execute: (args: T, context: { signal: AbortSignal }) => unknown | Promise<unknown>;
}

export interface PagewayToolInfo {
  name: string;
  description: string;
  parameters: JSONSchema;
  enabled?: boolean;
  allowedSources?: PagewayActionSource[];
}

export interface PagewayToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface PagewayMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  toolCalls?: PagewayToolCall[];
  toolCallId?: string;
  metadata?: Record<string, unknown>;
}

export interface ActionStep {
  id: string;
  name: string;
  label: string;
  status:
    'planning' | 'awaiting-approval' | 'running' | 'success' | 'error' | 'cancelled' | 'rejected';
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  startedAt: number;
  endedAt?: number;
  target?: string;
  source?: PagewayActionSource;
  approval?: PageToolApproval & {
    status: 'pending' | 'approved' | 'rejected';
    requestedAt: number;
    decidedAt?: number;
  };
}

export type PagewayToolResult = { ok: true; result: unknown } | { ok: false; error: string };

export interface PagewayEvent {
  type: string;
  [key: string]: unknown;
}

export interface Spotlight {
  id: string;
  label: string;
  rect: { left: number; top: number; width: number; height: number };
}

export interface PagewayActivity {
  phase: 'planning' | 'awaiting-approval' | 'moving' | 'acting' | 'success' | 'error';
  label: string;
  toolName?: string;
}

export interface PagewaySnapshot {
  messages: PagewayMessage[];
  status: 'idle' | 'running' | 'error';
  error: string | null;
  actions: ActionStep[];
  events: PagewayEvent[];
  spotlight: Spotlight | null;
  path: { x: number; y: number }[];
  cursor: { x: number; y: number } | null;
  activity: PagewayActivity | null;
  animationDuration: number;
  pendingApproval: PendingApproval | null;
}

export interface PagewayEngineOptions {
  /** Legacy AG-UI endpoint. Use apiOrigin for an OpenAI-compatible proxy. */
  endpoint?: string;
  apiOrigin?: string;
  apiPath?: string;
  model?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  animationDuration?: number;
  getTools: () => PageTool[];
  getContexts: () => PageContext[];
  fetch?: typeof fetch;
}
