import { describe, expect, it } from 'vitest';
import { encodeSSE, EventType, parseSSE, readAgentEvents } from '../src/index.js';

function chunks(text: string, size = 1): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let index = 0; index < bytes.length; index += size)
        controller.enqueue(bytes.slice(index, index + size));
      controller.close();
    },
  });
}

describe('SSE transport', () => {
  it('decodes Chinese UTF-8 split at every byte and mixed newline boundaries', async () => {
    const messages = await collect(
      parseSSE(
        chunks(
          ': ping\r\nid: one\r\nevent: token\r\ndata: 你好\r\ndata: 世界\r\n\r\ndata: second\r\r',
        ),
      ),
    );
    expect(messages).toEqual([
      { id: 'one', event: 'token', data: '你好\n世界' },
      { id: 'one', data: 'second' },
    ]);
  });

  it('validates AG-UI frames and accepts multiline JSON data', async () => {
    const event = {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'm1',
      delta: '你好\nworld',
    } as const;
    const text = `${encodeSSE(event)}data: {"type":"RUN_FINISHED",\ndata: "threadId":"t","runId":"r"}\n\n`;
    expect(await collect(readAgentEvents(chunks(text, 7)))).toEqual([
      event,
      { type: 'RUN_FINISHED', threadId: 't', runId: 'r' },
    ]);
  });

  it('rejects malformed JSON and incomplete event payloads', async () => {
    await expect(collect(readAgentEvents(chunks('data: {nope}\n\n')))).rejects.toThrow(
      'malformed event JSON',
    );
    await expect(
      collect(readAgentEvents(chunks('data: {"type":"TOOL_CALL_START"}\n\n'))),
    ).rejects.toThrow('invalid AG-UI event');
  });

  it('does not dispatch a frame cut off before its empty line', async () => {
    expect(await collect(parseSSE(chunks('data: incomplete\n')))).toEqual([]);
  });

  it('cancels a stalled reader when aborted', async () => {
    const abort = new AbortController();
    let cancelled = false;
    const pending = collect(
      parseSSE(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        abort.signal,
      ),
    );
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toBe(true);
  });

  it('bounds an unclosed SSE frame', async () => {
    await expect(collect(parseSSE(chunks(`data: ${'x'.repeat(1_048_577)}`, 4096)))).rejects.toThrow(
      '1 MiB',
    );
  });
});

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

describe('public byte-stream lifecycle', () => {
  it('interrupts a stalled async iterable and closes it when the run is cancelled', async () => {
    const abort = new AbortController();
    let closed = false;
    const source: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<Uint8Array>>(() => {}),
          return: async () => {
            closed = true;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const pending = collect(parseSSE(source, abort.signal));
    abort.abort(new DOMException('Task stopped', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(closed).toBe(true);
  }, 1000);
});

describe('SSE stream compatibility', () => {
  it('accepts iterable bytes and closes its source when the consumer exits early', async () => {
    let closed = false;
    async function* source() {
      try {
        yield new TextEncoder().encode('data: first\n\ndata: second\n\n');
        yield new TextEncoder().encode('data: never consumed\n\n');
      } finally {
        closed = true;
      }
    }
    for await (const event of parseSSE(source())) {
      expect(event.data).toBe('first');
      break;
    }
    expect(closed).toBe(true);
    expect(await collect(parseSSE(source(), new AbortController().signal))).toHaveLength(3);
  });

  it('handles empty data, BOM, ignored fields and invalid event IDs', async () => {
    const wire =
      '\uFEFFid: original\nretry: 1000\ndata\n\nid: invalid\0id\nevent: update\ndata: next\n\nid:\ndata: final\r\r';
    expect(await collect(parseSSE(chunks(wire)))).toEqual([
      { id: 'original', data: '' },
      { id: 'original', event: 'update', data: 'next' },
      { id: '', data: 'final' },
    ]);
  });

  it('rejects invalid UTF-8 and releases the reader', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff]));
        controller.close();
      },
    });
    await expect(collect(parseSSE(source))).rejects.toThrow();
    expect(source.locked).toBe(false);
  });
});
