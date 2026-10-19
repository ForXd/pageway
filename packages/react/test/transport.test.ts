import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventType, readAgentEvents, type RunAgentInput } from '@zllling/pageway-protocol';
import { requestAgentRound } from '../src/transport.js';

const input = (): RunAgentInput => ({
  threadId: 'thread',
  runId: 'run',
  messages: [{ id: 'u', role: 'user', content: 'Set the counter to 2.' }],
  tools: [
    {
      name: 'set_counter',
      description: 'Set counter',
      parameters: {
        type: 'object',
        properties: { value: { type: 'number' } },
        required: ['value'],
        additionalProperties: false,
      },
    },
  ],
  context: [{ description: 'Counter', value: '0' }],
  state: { value: 0 },
});
const chunk = (delta: unknown, finish_reason: string | null = null) =>
  `data: ${JSON.stringify({ model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const sse = (body: string) =>
  new Response(`${body}data: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
const events = async (response: Response) => {
  const result = [];
  for await (const event of readAgentEvents(response.body!)) result.push(event);
  return result;
};

afterEach(() => vi.unstubAllGlobals());

describe('frontend OpenAI transport', () => {
  it('adapts ordinary completions, page tools and a fresh tool-result round without an AG-UI server', async () => {
    const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      return requests.length === 1
        ? sse(
            chunk({
              tool_calls: [
                {
                  index: 0,
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'set_counter', arguments: '{"value":2}' },
                },
              ],
            }) + chunk({}, 'tool_calls'),
          )
        : sse(chunk({ content: 'Counter is now 2.' }) + chunk({}, 'stop'));
    };
    const options = {
      apiOrigin: 'https://app.test/api/openai/',
      model: 'fixture',
      headers: { Authorization: 'Bearer application-session' },
      fetch: fetcher,
    };
    const first = await events(
      await requestAgentRound(options, input(), new AbortController().signal),
    );
    expect(first).toContainEqual(
      expect.objectContaining({ type: EventType.TOOL_CALL_END, toolCallId: 'call-1' }),
    );
    expect(first.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    const secondInput = input();
    secondInput.messages.push(
      {
        id: 'a',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'set_counter', arguments: '{"value":2}' },
          },
        ],
      },
      { id: 't', role: 'tool', toolCallId: 'call-1', content: '{"value":2}' },
    );
    secondInput.context = [{ description: 'Counter', value: '2' }];
    secondInput.state = { value: 2 };
    const second = await events(
      await requestAgentRound(options, secondInput, new AbortController().signal),
    );
    expect(second).toContainEqual(
      expect.objectContaining({ type: EventType.TEXT_MESSAGE_CONTENT, delta: 'Counter is now 2.' }),
    );
    expect(requests).toHaveLength(2);
    expect(requests[0]!.url).toBe('https://app.test/api/openai/chat/completions');
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer application-session');
    expect(requests[0]!.body).toMatchObject({
      model: 'fixture',
      stream: true,
      tools: [{ type: 'function', function: { name: 'set_counter' } }],
    });
    expect(requests[0]!.body).not.toHaveProperty('threadId');
    expect(requests[1]!.body.messages).toEqual(
      expect.arrayContaining([{ role: 'tool', tool_call_id: 'call-1', content: '{"value":2}' }]),
    );
    expect(JSON.stringify(requests[1]!.body.messages)).toContain('\\"value\\":2');
  });

  it('resolves relative apiOrigin and custom routes while preserving the base path', async () => {
    vi.stubGlobal('location', { href: 'https://app.test/workspace/' });
    const fetcher = vi.fn<typeof fetch>(async () =>
      sse(chunk({ content: 'Hello' }) + chunk({}, 'stop')),
    );
    await events(
      await requestAgentRound(
        {
          apiOrigin: '/api/models/v1',
          apiPath: '/completions/chat',
          model: 'fixture',
          fetch: fetcher,
        },
        input(),
        new AbortController().signal,
      ),
    );
    expect(fetcher.mock.calls[0]![0]).toBe('https://app.test/api/models/v1/completions/chat');
  });

  it.each([
    [{ endpoint: '/agent', apiOrigin: 'https://app.test/v1', model: 'fixture' }, 'either endpoint'],
    [{ apiOrigin: 'https://app.test/v1' }, 'model'],
    [{ apiOrigin: '', model: 'fixture' }, 'non-empty'],
    [{ apiOrigin: '/api/openai', model: 'fixture' }, 'browser location'],
    [{ apiOrigin: 'file:///tmp', model: 'fixture' }, 'HTTP(S)'],
    [{ apiOrigin: 'https://user:secret@app.test', model: 'fixture' }, 'credentials'],
    [{ apiOrigin: 'https://app.test/v1?key=secret', model: 'fixture' }, 'query'],
    [{ apiOrigin: 'https://app.test/v1', apiPath: '../escape', model: 'fixture' }, 'apiPath'],
    [{ apiOrigin: 'https://app.test/v1', model: 'fixture', timeoutMs: 0 }, 'timeoutMs'],
    [{}, 'Chat requires'],
  ])(
    'rejects invalid transport settings before contacting a model: %j',
    async (options, message) => {
      const fetcher = vi.fn<typeof fetch>();
      await expect(
        requestAgentRound({ ...options, fetch: fetcher }, input(), new AbortController().signal),
      ).rejects.toThrow(message);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('keeps existing AG-UI endpoint requests and abort signals unchanged', async () => {
    const expected = new Response('legacy');
    const fetcher = vi.fn<typeof fetch>(async () => expected);
    const controller = new AbortController();
    const response = await requestAgentRound(
      { endpoint: '/api/agent', headers: { 'X-Session': 'session' }, fetch: fetcher },
      input(),
      controller.signal,
    );
    expect(response).toBe(expected);
    expect(fetcher.mock.calls[0]![0]).toBe('/api/agent');
    expect(fetcher.mock.calls[0]![1]?.signal).toBe(controller.signal);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual(input());
    controller.abort();
    await expect(
      requestAgentRound({ endpoint: '/api/agent', fetch: fetcher }, input(), controller.signal),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('cancels upstream completion work when the browser stops a task', async () => {
    let upstreamSignal: AbortSignal | null | undefined;
    const fetcher: typeof fetch = async (_url, init) => {
      upstreamSignal = init?.signal;
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), {
          once: true,
        }),
      );
    };
    const controller = new AbortController();
    const response = await requestAgentRound(
      { apiOrigin: 'https://app.test/v1', model: 'fixture', fetch: fetcher },
      input(),
      controller.signal,
    );
    controller.abort();
    const result = await events(response);
    expect(upstreamSignal?.aborted).toBe(true);
    expect(result).toContainEqual(
      expect.objectContaining({ type: EventType.RUN_ERROR, code: 'CANCELLED' }),
    );
  });

  it('bounds stalled model rounds with the frontend timeout', async () => {
    let signal: AbortSignal | null | undefined;
    const response = await requestAgentRound(
      {
        apiOrigin: 'https://app.test/v1',
        model: 'fixture',
        timeoutMs: 10,
        fetch: async (_url, init) => {
          signal = init?.signal;
          return new Promise((_resolve, reject) =>
            signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true }),
          );
        },
      },
      input(),
      new AbortController().signal,
    );
    expect(await events(response)).toContainEqual(
      expect.objectContaining({ type: EventType.RUN_ERROR, code: 'TIMEOUT' }),
    );
    expect(signal?.aborted).toBe(true);
  });
});
