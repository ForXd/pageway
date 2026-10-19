// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { encodeSSE } from '@zllling/pageway-protocol';
import {
  ActionTimeline,
  PagewayChat,
  PagewayOverlay,
  PagewayProvider,
  usePageContext,
  usePageTool,
  usePageway,
} from '../src/index.js';

type RunInput = {
  threadId: string;
  runId: string;
  tools: { name: string; description: string }[];
  messages: { role: string; content?: string; toolCallId?: string }[];
  state: { page: { id: string; data: unknown }[] };
};
type Event = Record<string, unknown>;
const toolEvents = (id = 'change-1'): Event[] => [
  {
    type: 'TOOL_CALL_START',
    toolCallId: id,
    toolCallName: 'add_value',
    parentMessageId: 'assistant-1',
  },
  { type: 'TOOL_CALL_ARGS', toolCallId: id, delta: '{"value":2}' },
  { type: 'TOOL_CALL_END', toolCallId: id },
];
const replyEvents: Event[] = [
  { type: 'TEXT_MESSAGE_START', messageId: 'reply', role: 'assistant' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'reply', delta: 'The update is confirmed.' },
  { type: 'TEXT_MESSAGE_END', messageId: 'reply' },
];
function connect(rounds: Event[][] = [replyEvents], stubGlobal = true) {
  const requests: RunInput[] = [];
  const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as RunInput;
    requests.push(request);
    const events = [
      { type: 'RUN_STARTED', threadId: request.threadId, runId: request.runId },
      ...(rounds[requests.length - 1] ?? replyEvents),
      { type: 'RUN_FINISHED', threadId: request.threadId, runId: request.runId },
    ];
    return new Response(events.map((event) => encodeSSE(event as never)).join(''), {
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  if (stubGlobal) vi.stubGlobal('fetch', fetcher);
  return { requests, fetcher };
}
function Tools({
  value,
  factor,
  setValue,
  asynchronous = false,
}: {
  value: number;
  factor: number;
  setValue: (value: number) => void;
  asynchronous?: boolean;
}) {
  usePageContext({ id: 'counter', title: 'Counter', data: { value, factor } });
  usePageTool<{ value: number }>({
    name: 'add_value',
    description: `Add with multiplier ${factor}`,
    parameters: {
      type: 'object',
      properties: { value: { type: 'number' } },
      required: ['value'],
      additionalProperties: false,
    },
    execute: asynchronous
      ? async (args) => {
          await Promise.resolve();
          const next = value + args.value * factor;
          setValue(next);
          return { value: next };
        }
      : (args) => {
          const next = value + args.value * factor;
          setValue(next);
          return { value: next };
        },
  });
  return null;
}
function Page({
  factor = 1,
  enabled = true,
  asynchronous = false,
}: {
  factor?: number;
  enabled?: boolean;
  asynchronous?: boolean;
}) {
  const [value, setValue] = useState(0);
  const agent = usePageway();
  return (
    <>
      {enabled && (
        <Tools value={value} factor={factor} setValue={setValue} asynchronous={asynchronous} />
      )}
      <output aria-label="Page value">{value}</output>
      <output aria-label="Available tools">
        {agent.tools.map((tool) => tool.description).join(', ') || 'None'}
      </output>
      <output aria-label="Agent state">{agent.status}</output>
      <PagewayChat suggestions={['Update the counter']} />
      <ActionTimeline />
    </>
  );
}
function send(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Pageway' }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('React public integration', () => {
  it('executes and returns tools through an injected transport, then switches transport without losing history', async () => {
    const globalFetch = vi.fn(() => Promise.reject(new Error('Unexpected network request')));
    vi.stubGlobal('fetch', globalFetch);
    const first = connect([toolEvents()], false);
    const second = connect([replyEvents], false);
    const page = render(
      <PagewayProvider endpoint="/local-agent" fetch={first.fetcher} animationDuration={0}>
        <Page />
      </PagewayProvider>,
    );
    send('Update using the local transport');
    await screen.findByText('The update is confirmed.');
    expect(screen.getByLabelText('Page value').textContent).toBe('2');
    expect(first.requests).toHaveLength(2);
    expect(first.requests[1].messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'change-1',
      content: '{"ok":true,"result":{"value":2}}',
    });

    page.rerender(
      <PagewayProvider endpoint="/other-agent" fetch={second.fetcher} animationDuration={0}>
        <Page />
      </PagewayProvider>,
    );
    send('Continue using another transport');
    await waitFor(() => expect(second.requests).toHaveLength(1));
    expect(second.fetcher.mock.calls[0][0]).toBe('/other-agent');
    expect(
      second.requests[0].messages
        .filter((message) => message.role === 'user')
        .map((message) => message.content),
    ).toEqual(['Update using the local transport', 'Continue using another transport']);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('aborts an injected transport when the provider unmounts', async () => {
    let signal: AbortSignal | null | undefined;
    const fetcher = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal?.reason), { once: true });
      });
    });
    const page = render(
      <PagewayProvider endpoint="/local-agent" fetch={fetcher}>
        <Page />
      </PagewayProvider>,
    );
    send('Start a local request');
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(signal?.aborted).toBe(false);
    page.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('publishes registered tools and context and removes them when their owner unmounts', async () => {
    const { requests } = connect();
    const page = render(
      <PagewayProvider endpoint="/agent" animationDuration={0}>
        <Page />
      </PagewayProvider>,
    );
    expect(screen.getByLabelText('Available tools').textContent).toBe('Add with multiplier 1');
    send('Inspect the page');
    await waitFor(() => expect(screen.getByLabelText('Agent state').textContent).toBe('idle'));
    expect(requests[0].tools).toEqual([
      expect.objectContaining({ name: 'add_value', description: 'Add with multiplier 1' }),
    ]);
    expect(requests[0].state.page).toEqual([
      expect.objectContaining({ id: 'counter', data: { value: 0, factor: 1 } }),
    ]);
    page.rerender(
      <PagewayProvider endpoint="/agent" animationDuration={0}>
        <Page enabled={false} />
      </PagewayProvider>,
    );
    expect(screen.getByLabelText('Available tools').textContent).toBe('None');
    send('Inspect the unmounted page');
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].tools).toEqual([]);
    expect(requests[1].state.page).toEqual([]);
  });

  it.each([false, true])(
    'commits current callback state (async=%s) before the next tool and result continuation',
    async (asynchronous) => {
      const { requests } = connect([[...toolEvents(), ...toolEvents('change-2')]]);
      const page = render(
        <PagewayProvider endpoint="/agent" animationDuration={0}>
          <Page asynchronous={asynchronous} />
        </PagewayProvider>,
      );
      page.rerender(
        <PagewayProvider endpoint="/agent" animationDuration={0}>
          <Page factor={3} asynchronous={asynchronous} />
        </PagewayProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Update the counter' }));
      await waitFor(() => expect(screen.getByLabelText('Page value').textContent).toBe('12'));
      await waitFor(() => expect(screen.getByLabelText('Agent state').textContent).toBe('idle'));
      expect(requests).toHaveLength(2);
      expect(requests[0].tools[0].description).toBe('Add with multiplier 3');
      expect(requests[1].state.page[0].data).toEqual({ value: 12, factor: 3 });
      expect(requests[1].messages.filter((message) => message.role === 'tool')).toEqual([
        expect.objectContaining({
          toolCallId: 'change-1',
          content: '{"ok":true,"result":{"value":6}}',
        }),
        expect.objectContaining({
          toolCallId: 'change-2',
          content: '{"ok":true,"result":{"value":12}}',
        }),
      ]);
      expect(screen.getByText('2 completed')).toBeTruthy();
      expect(screen.getByText('The update is confirmed.')).toBeTruthy();
    },
  );

  it('rejects hooks used without a provider with actionable errors', () => {
    expect(() => renderHook(() => usePageway())).toThrow(
      'usePageway must be called inside PagewayProvider',
    );
    expect(() =>
      renderHook(() => usePageContext({ id: 'outside', title: 'Outside', data: {} })),
    ).toThrow('Pageway hooks must be called inside PagewayProvider');
  });

  it('keeps one usable registration after Strict Mode remounts effects', async () => {
    const { requests } = connect([toolEvents()]);
    render(
      <StrictMode>
        <PagewayProvider endpoint="/agent" animationDuration={0}>
          <Page />
        </PagewayProvider>
      </StrictMode>,
    );
    send('Apply under Strict Mode');
    await screen.findByText('The update is confirmed.');
    expect(screen.getByLabelText('Page value').textContent).toBe('2');
    expect(requests[0].tools).toHaveLength(1);
    expect(requests[1].messages.filter((message) => message.role === 'tool')).toHaveLength(1);
  });

  it('ignores a queued close from Strict Mode cleanup when a conditional overlay has already reopened', async () => {
    const prototype = HTMLDialogElement.prototype;
    const previousShowModal = Object.getOwnPropertyDescriptor(prototype, 'showModal');
    const previousClose = Object.getOwnPropertyDescriptor(prototype, 'close');
    let queuedCloses = 0;
    // jsdom does not implement these native methods. Match the browser boundary:
    // close events dispatch in a later task, after Strict Mode re-runs effects.
    Object.defineProperties(prototype, {
      showModal: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.open = true;
        },
      },
      close: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.open = false;
          setTimeout(() => {
            queuedCloses += 1;
            this.dispatchEvent(new Event('close'));
          }, 0);
        },
      },
    });
    const { fetcher } = connect([toolEvents()]);
    function ConditionalPage() {
      const agent = usePageway();
      return (
        <>
          <Page />
          {agent.status === 'running' && <PagewayOverlay />}
        </>
      );
    }
    const page = render(
      <StrictMode>
        <PagewayProvider endpoint="/agent" animationDuration={0}>
          <ConditionalPage />
        </PagewayProvider>
      </StrictMode>,
    );
    try {
      send('Keep running until the user stops');
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(queuedCloses).toBe(1);
      expect(screen.getByLabelText('Agent state').textContent).toBe('running');
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
      expect(document.querySelector('dialog[open]')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Stop task/ }));
      await waitFor(() => expect(screen.getByLabelText('Agent state').textContent).toBe('idle'));
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    } finally {
      page.unmount();
      if (previousShowModal) Object.defineProperty(prototype, 'showModal', previousShowModal);
      else Reflect.deleteProperty(prototype, 'showModal');
      if (previousClose) Object.defineProperty(prototype, 'close', previousClose);
      else Reflect.deleteProperty(prototype, 'close');
    }
  });

  it.each([true, false])(
    'respects lockPage=%s for newly mounted host content and releases the lock after Stop',
    async (lockPage) => {
      connect([toolEvents()]);
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      function PendingPage() {
        usePageTool({
          name: 'add_value',
          description: 'Pending change',
          parameters: { type: 'object' },
          execute: () => {
            entered();
            return new Promise(() => {});
          },
        });
        return (
          <>
            <PagewayChat />
            <PagewayOverlay lockPage={lockPage} />
          </>
        );
      }
      render(
        <PagewayProvider endpoint="/agent" animationDuration={0}>
          <PendingPage />
        </PagewayProvider>,
      );
      send('Start pending action');
      await act(async () => {
        await started;
      });
      const popup = document.createElement('aside');
      document.body.append(popup);
      try {
        await act(async () => {
          await Promise.resolve();
        });
        expect(Boolean(popup.inert)).toBe(lockPage);
        expect(Boolean(document.querySelector('dialog[open]'))).toBe(lockPage);
        fireEvent.click(screen.getByRole('button', { name: /Stop task/ }));
        await waitFor(() => expect(document.querySelector('[data-pageway-lock]')).toBeNull());
        expect(Boolean(popup.inert)).toBe(false);
      } finally {
        popup.remove();
      }
    },
  );

  it('uses updated endpoint and headers without losing conversation history', async () => {
    const { requests, fetcher } = connect();
    const page = render(
      <PagewayProvider endpoint="/old" headers={{ 'X-App': 'first' }}>
        <Page />
      </PagewayProvider>,
    );
    send('First message');
    await waitFor(() => expect(screen.getByLabelText('Agent state').textContent).toBe('idle'));
    page.rerender(
      <PagewayProvider endpoint="/new" headers={{ 'X-App': 'second' }}>
        <Page />
      </PagewayProvider>,
    );
    send('Second message');
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(fetcher.mock.calls[1][0]).toBe('/new');
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('X-App')).toBe('second');
    expect(
      requests[1].messages
        .filter((message) => message.role === 'user')
        .map((message) => message.content),
    ).toEqual(['First message', 'Second message']);
  });

  it('supports keyboard submission without sending an IME composition or Shift+Enter', async () => {
    const { requests } = connect();
    render(
      <PagewayProvider endpoint="/agent">
        <Page />
      </PagewayProvider>,
    );
    const input = screen.getByRole('textbox', { name: 'Message Pageway' });
    fireEvent.change(input, { target: { value: 'Keyboard request' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(requests).toHaveLength(0);
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('The update is confirmed.');
    expect(requests[0].messages[0].content).toBe('Keyboard request');
    expect((input as HTMLTextAreaElement).value).toBe('');
  });

  it('lets the user edit a failed request, recover, and start a fresh conversation', async () => {
    const { requests, fetcher } = connect();
    fetcher.mockImplementationOnce(async () => new Response('Temporary outage', { status: 503 }));
    render(
      <PagewayProvider endpoint="/agent">
        <Page />
      </PagewayProvider>,
    );
    send('Recover this request');
    expect((await screen.findByRole('alert')).textContent).toContain('Temporary outage');
    expect(screen.getByLabelText('Agent state').textContent).toBe('error');
    fireEvent.click(screen.getByRole('button', { name: 'Edit and try again ↗' }));
    const input = screen.getByRole('textbox', { name: 'Message Pageway' }) as HTMLTextAreaElement;
    expect(input.value).toBe('Recover this request');
    expect(document.activeElement).toBe(input);
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('The update is confirmed.');
    expect(screen.queryByRole('alert')).toBeNull();
    const oldThreadId = requests[0].threadId;
    fireEvent.click(screen.getByRole('button', { name: 'Start a new conversation' }));
    expect(screen.queryByText('The update is confirmed.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Update the counter' })).toBeTruthy();
    expect(screen.getByLabelText('Available tools').textContent).toBe('Add with multiplier 1');
    send('A clean conversation');
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].threadId).not.toBe(oldThreadId);
    expect(requests[1].messages).toHaveLength(1);
    expect(requests[1].messages[0].content).toBe('A clean conversation');
  });

  it('shows invalid page-tool arguments in the action trail and returns the failure for agent recovery', async () => {
    const events = toolEvents();
    events[1] = { ...events[1], delta: '{"value":"wrong"}' };
    const { requests } = connect([events]);
    render(
      <PagewayProvider endpoint="/agent" animationDuration={0}>
        <Page />
      </PagewayProvider>,
    );
    send('Send an invalid change');
    await screen.findByText('The update is confirmed.');
    expect(screen.getByLabelText('Page value').textContent).toBe('0');
    expect(screen.getByText('Error')).toBeTruthy();
    expect(screen.getByText(/Invalid arguments:.*must be number/)).toBeTruthy();
    expect(
      JSON.parse(requests[1].messages.find((message) => message.role === 'tool')!.content!),
    ).toMatchObject({ ok: false, error: expect.stringContaining('must be number') });
  });

  it('aborts an active callback and releases the page lock when the provider unmounts', async () => {
    connect([toolEvents()]);
    let signal: AbortSignal | undefined;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    function PendingPage() {
      usePageTool({
        name: 'add_value',
        description: 'Pending change',
        parameters: { type: 'object' },
        execute: (_args, context) => {
          signal = context.signal;
          entered();
          return new Promise(() => {});
        },
      });
      return (
        <>
          <PagewayChat />
          <PagewayOverlay />
        </>
      );
    }
    const page = render(
      <PagewayProvider endpoint="/agent" animationDuration={0}>
        <PendingPage />
      </PagewayProvider>,
    );
    const originalOverflow = document.body.style.overflow;
    send('Start pending action');
    await act(async () => {
      await started;
    });
    expect(document.querySelector('dialog[open]')).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');
    page.unmount();
    expect(signal?.aborted).toBe(true);
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(document.body.style.overflow).toBe(originalOverflow);
  });
  it('checkpoints and cancels an interrupted conversation on pagehide without replaying it on remount', async () => {
    const key = 'pageway-provider-navigation';
    localStorage.removeItem(key);
    let requestSignal: AbortSignal | null | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      requestSignal = init?.signal;
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener(
          'abort',
          () => reject(new DOMException('Cancelled', 'AbortError')),
          { once: true },
        );
      });
    });
    const page = render(
      <PagewayProvider endpoint="/agent" storageKey={key} fetch={fetcher}>
        <Page />
        <PagewayOverlay />
      </PagewayProvider>,
    );
    send('Remember my interrupted request');
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(localStorage.getItem(key)).toBeNull();
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(requestSignal?.aborted).toBe(true);
    expect(JSON.parse(localStorage.getItem(key)!).state.messages[0].content).toBe(
      'Remember my interrupted request',
    );
    page.unmount();
    const restored = render(
      <StrictMode>
        <PagewayProvider endpoint="/agent" storageKey={key} fetch={fetcher}>
          <Page />
          <PagewayOverlay />
        </PagewayProvider>
      </StrictMode>,
    );
    expect(screen.getByText('Remember my interrupted request')).toBeTruthy();
    expect(screen.getByLabelText('Agent state').textContent).toBe('idle');
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
    restored.unmount();
    localStorage.removeItem(key);
  });
});
