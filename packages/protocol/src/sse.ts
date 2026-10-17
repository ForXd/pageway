import type { AGUIEvent } from '@ag-ui/core';
import { EventSchema } from '@ag-ui/core/schemas';

export type ByteStream = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;
export interface SSEMessage {
  data: string;
  event?: string;
  id?: string;
}

/** JSON encodes line breaks inside strings, keeping each event one SSE frame. */
export function encodeSSE(event: AGUIEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function* readBytes(source: ByteStream, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  if ('getReader' in source) {
    const reader = source.getReader();
    const cancel = () => {
      void reader.cancel(signal?.reason).catch(() => undefined);
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      while (true) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        signal?.throwIfAborted();
        if (done) break;
        yield value;
      }
    } finally {
      signal?.removeEventListener('abort', cancel);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  } else {
    const iterator = source[Symbol.asyncIterator]();
    let finished = false;
    try {
      while (true) {
        signal?.throwIfAborted();
        const next = signal
          ? new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
              const cancel = () => reject(signal.reason);
              signal.addEventListener('abort', cancel, { once: true });
              Promise.resolve()
                .then(() => {
                  signal.throwIfAborted();
                  return iterator.next();
                })
                .then(resolve, reject)
                .finally(() => signal.removeEventListener('abort', cancel));
            })
          : iterator.next();
        const result = await next;
        if (result.done) {
          finished = true;
          break;
        }
        yield result.value;
      }
    } finally {
      if (!finished && iterator.return) {
        const cleanup = Promise.resolve(iterator.return());
        // An async generator may itself be waiting on uncancellable I/O. Do not
        // make task cancellation wait for that generator's return() to settle.
        if (signal?.aborted) void cleanup.catch(() => undefined);
        else await cleanup;
      }
    }
  }
}

/** Handles UTF-8 boundaries, LF/CRLF/CR, comments and multiline data fields. */
export async function* parseSSE(
  source: ByteStream,
  signal?: AbortSignal,
): AsyncGenerator<SSEMessage> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let data: string[] = [];
  let event: string | undefined;
  let id: string | undefined;
  let frameSize = 0;
  const maxFrameSize = 1_048_576;

  function line(value: string): SSEMessage | undefined {
    if (value === '') {
      const message = data.length
        ? {
            data: data.join('\n'),
            ...(event ? { event } : {}),
            ...(id !== undefined ? { id } : {}),
          }
        : undefined;
      data = [];
      event = undefined;
      frameSize = 0;
      return message;
    }
    frameSize += value.length;
    if (frameSize > maxFrameSize) throw new Error('SSE event exceeds the 1 MiB limit.');
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? '' : value.slice(colon + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (field === 'data') data.push(content);
    if (field === 'event') event = content;
    if (field === 'id' && !content.includes('\0')) id = content;
  }

  function* drain(final = false): Generator<SSEMessage> {
    while (true) {
      const index = buffer.search(/[\r\n]/);
      if (index < 0) break;
      // Hold a trailing CR until we know whether the next byte is LF.
      if (!final && buffer[index] === '\r' && index === buffer.length - 1) break;
      const value = buffer.slice(0, index);
      const size = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
      buffer = buffer.slice(index + size);
      const message = line(value);
      if (message) yield message;
    }
    if (buffer.length + frameSize > maxFrameSize)
      throw new Error('SSE event exceeds the 1 MiB limit.');
  }

  for await (const chunk of readBytes(source, signal)) {
    buffer += decoder.decode(chunk, { stream: true });
    yield* drain();
  }
  buffer += decoder.decode();
  yield* drain(true);
  // SSE dispatch requires an empty line. An unterminated frame is a truncated
  // transport, not a completed action; callers detect missing lifecycle events.
}

export async function* readAgentEvents(
  source: ByteStream,
  signal?: AbortSignal,
): AsyncGenerator<AGUIEvent> {
  for await (const message of parseSSE(source, signal)) {
    let json: unknown;
    try {
      json = JSON.parse(message.data);
    } catch {
      throw new Error('Agent returned malformed event JSON.');
    }
    const parsed = EventSchema.safeParse(json);
    if (!parsed.success) throw new Error('Agent returned an invalid AG-UI event.');
    yield parsed.data as AGUIEvent;
  }
}
