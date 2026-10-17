export * from '@ag-ui/core';
// Runtime validators are a separate entry point in AG-UI 1.x.
export {
  EventSchema,
  EventSchemas,
  RunAgentInputSchema,
  MessageSchema,
  ToolSchema,
} from '@ag-ui/core/schemas';
export { encodeSSE, parseSSE, readAgentEvents } from './sse.js';
export type { SSEMessage, ByteStream } from './sse.js';

import type { Tool } from '@ag-ui/core';

export type JSONSchema = Record<string, unknown>;

/** Application-owned, explicitly registered context; never a DOM dump. */
export interface PageContext {
  id: string;
  title: string;
  description?: string;
  data: unknown;
}

export type ToolDefinition = Omit<Tool, 'parameters'> & { parameters: JSONSchema };
