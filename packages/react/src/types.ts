import type { JSONSchema, PageContext } from '@zllling/pageway-protocol';

export type { JSONSchema, PageContext } from '@zllling/pageway-protocol';

export interface PageTool<T extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: JSONSchema;
  target?: string | ((args: T) => HTMLElement | null);
  execute: (args: T, context: { signal: AbortSignal }) => unknown | Promise<unknown>;
}

export interface PagewayToolInfo {
  name: string;
  description: string;
  parameters: JSONSchema;
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
  status: 'planning' | 'running' | 'success' | 'error' | 'cancelled';
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  startedAt: number;
  endedAt?: number;
  target?: string;
  source?: 'chat' | 'webmcp';
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
  phase: 'planning' | 'moving' | 'acting' | 'success' | 'error';
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
