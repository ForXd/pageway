import Ajv, { type ValidateFunction } from 'ajv';
import { RunAgentInputSchema, type RunAgentInput } from '@zllling/pageway-protocol';
import { AgentError } from './errors.js';

export interface ValidatedRun {
  input: RunAgentInput;
  validators: Map<string, ValidateFunction>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new AgentError('INVALID_INPUT', message);
}

export function validateInput(value: unknown): ValidatedRun {
  const parsed = RunAgentInputSchema.safeParse(value);
  if (!parsed.success) invalid('Request must be a valid AG-UI RunAgentInput.');
  const input = parsed.data as RunAgentInput;
  input.tools ??= [];
  input.context ??= [];
  if (
    !input.threadId.trim() ||
    !input.runId.trim() ||
    input.threadId.length > 200 ||
    input.runId.length > 200
  ) {
    invalid('threadId and runId must be non-empty identifiers under 200 characters.');
  }
  if (!input.messages.length || input.messages.length > 256)
    invalid('Provide between 1 and 256 messages.');
  if (input.tools.length > 64) invalid('At most 64 frontend tools can be registered.');
  const validators = new Map<string, ValidateFunction>();
  const ajv = new Ajv({ strict: false, allErrors: false, validateFormats: false });
  for (const tool of input.tools) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name) || validators.has(tool.name)) {
      invalid('Tool names must be unique and use 1–64 letters, numbers, underscores or hyphens.');
    }
    const schema: unknown = tool.parameters ?? {
      type: 'object',
      properties: {},
      additionalProperties: false,
    };
    if (!isRecord(schema) || (schema.type !== undefined && schema.type !== 'object')) {
      invalid('Tool parameters must be a JSON Schema object describing object arguments.');
    }
    try {
      validators.set(tool.name, ajv.compile(schema));
    } catch {
      invalid(`Tool ${tool.name} has an invalid or unsupported JSON Schema.`);
    }
  }

  const messageIds = new Set<string>();
  const toolCallIds = new Set<string>();
  const pending = new Set<string>();
  let hasUser = false;
  for (const message of input.messages) {
    if (!message.id.trim() || messageIds.has(message.id))
      invalid('Message identifiers must be non-empty and unique.');
    messageIds.add(message.id);
    if (!['user', 'assistant', 'tool'].includes(message.role)) {
      invalid(
        'The adapter accepts user, assistant and tool messages; set system instructions on the server.',
      );
    }
    if (
      'content' in message &&
      message.content !== undefined &&
      typeof message.content !== 'string'
    ) {
      invalid('This adapter supports text message content.');
    }
    if (message.role === 'tool') {
      if (!pending.delete(message.toolCallId))
        invalid('A tool result must match an unresolved assistant tool call.');
      continue;
    }
    if (pending.size) invalid('Provide all tool results before the next conversation message.');
    if (message.role === 'user') hasUser = true;
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        if (!call.id || toolCallIds.has(call.id))
          invalid('Tool call identifiers must be non-empty and unique.');
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(call.function.name))
          invalid('Invalid historic tool name.');
        try {
          if (!isRecord(JSON.parse(call.function.arguments)))
            invalid('Tool call arguments must be JSON objects.');
        } catch {
          invalid('Tool call arguments must be JSON objects.');
        }
        toolCallIds.add(call.id);
        pending.add(call.id);
      }
    }
  }
  if (!hasUser) invalid('The conversation must contain a user message.');
  if (pending.size) invalid('All requested frontend tools must have results before resuming.');
  return { input, validators };
}

export function validateToolCall(
  name: string,
  argumentsJSON: string,
  validators: Map<string, ValidateFunction>,
): void {
  const validate = validators.get(name);
  if (!validate)
    throw new AgentError(
      'UNKNOWN_TOOL',
      'The model requested a tool that is not registered on this page.',
    );
  let args: unknown;
  try {
    args = JSON.parse(argumentsJSON);
  } catch {
    throw new AgentError(
      'INVALID_TOOL_ARGUMENTS',
      'The model returned incomplete or invalid tool arguments.',
    );
  }
  if (!isRecord(args) || !validate(args)) {
    throw new AgentError(
      'INVALID_TOOL_ARGUMENTS',
      'The model returned arguments that do not match the registered tool schema.',
    );
  }
}
