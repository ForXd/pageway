// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { encodeSSE } from '@zllling/pageway-protocol';
import {
  ActionTimeline,
  PagewayChat,
  PagewayOverlay,
  PagewayProvider,
  usePageTool,
  usePageway,
  type PagewayActionSource,
} from '../src/index.js';

type Request = {
  threadId: string;
  runId: string;
  tools: { name: string }[];
  messages: { role: string; content?: string; toolCallId?: string }[];
};

function transport() {
  const requests: Request[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as Request;
    requests.push(request);
    const events =
      requests.length === 1
        ? [
            {
              type: 'TOOL_CALL_START',
              toolCallId: 'delete-1',
              toolCallName: 'delete_item',
              parentMessageId: 'assistant-1',
            },
            { type: 'TOOL_CALL_ARGS', toolCallId: 'delete-1', delta: '{"id":"item-7"}' },
            { type: 'TOOL_CALL_END', toolCallId: 'delete-1' },
          ]
        : [
            { type: 'TEXT_MESSAGE_START', messageId: 'reply', role: 'assistant' },
            { type: 'TEXT_MESSAGE_CONTENT', messageId: 'reply', delta: 'The request is complete.' },
            { type: 'TEXT_MESSAGE_END', messageId: 'reply' },
          ];
    return new Response(
      [
        { type: 'RUN_STARTED', threadId: request.threadId, runId: request.runId },
        ...events,
        { type: 'RUN_FINISHED', threadId: request.threadId, runId: request.runId },
      ]
        .map((event) => encodeSSE(event as never))
        .join(''),
      {
        headers: { 'content-type': 'text/event-stream' },
      },
    );
  });
  return { requests, fetcher };
}

interface ToolProps {
  execute: (id: string, revision: number) => unknown;
  revision?: number;
  enabled?: boolean;
  allowedSources?: PagewayActionSource[];
}
function Tool({ execute, revision = 1, enabled, allowedSources }: ToolProps) {
  usePageTool<{ id: string }>({
    name: 'delete_item',
    description: 'Delete one item',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    enabled,
    allowedSources,
    approval: ({ id }) => ({
      title: `Delete ${id}?`,
      description: 'This removes the item permanently.',
    }),
    execute: ({ id }) => execute(id, revision),
  });
  return null;
}
function Surface({ lockPage = true }: { lockPage?: boolean }) {
  const agent = usePageway();
  return (
    <>
      <output aria-label="Agent state">{agent.status}</output>
      <output aria-label="Tool metadata">{JSON.stringify(agent.tools)}</output>
      <PagewayChat suggestions={['Delete the item']} />
      <ActionTimeline />
      <PagewayOverlay lockPage={lockPage} />
    </>
  );
}

function start() {
  fireEvent.click(screen.getByRole('button', { name: 'Delete the item' }));
}
async function approval() {
  return screen.findByRole('button', { name: 'Reject action' });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('approval React integration', () => {
  it('keeps the page locked and defaults to Reject, then executes the latest callback after keyboard approval', async () => {
    const { fetcher, requests } = transport();
    let complete!: () => void;
    const execute = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const view = (revision: number) => (
      <StrictMode>
        <PagewayProvider endpoint="/agent" fetch={fetcher} animationDuration={0} webmcp={false}>
          <Tool execute={execute} revision={revision} />
          <Surface />
        </PagewayProvider>
      </StrictMode>
    );
    const page = render(view(1));
    start();
    const reject = await approval();
    expect(execute).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(reject);
    expect(document.querySelector('dialog[open]')?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getByText('Chat assistant')).toBeTruthy();
    expect(screen.getByText('Waiting for your approval…')).toBeTruthy();
    expect(page.container.inert).toBe(true);
    page.rerender(view(2));
    expect(document.activeElement).toBe(reject);

    fireEvent.keyDown(reject, { key: 'Tab' });
    const approve = screen.getByRole('button', { name: 'Approve this action' });
    expect(document.activeElement).toBe(approve);
    fireEvent.keyDown(approve, { key: 'Enter' });
    await waitFor(() => expect(execute).toHaveBeenCalledWith('item-7', 2));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Stop task/ }));
    expect(page.container.inert).toBe(true);
    await act(async () => complete());
    await screen.findByText('The request is complete.');
    expect(execute).toHaveBeenCalledOnce();
    expect(Boolean(page.container.inert)).toBe(false);
    expect(screen.getByText('Approved by you')).toBeTruthy();
    expect(requests[1].messages.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'delete-1' });
  });

  it('returns rejection without running the handler and records the decision in the trail', async () => {
    const { fetcher, requests } = transport();
    const execute = vi.fn();
    render(
      <PagewayProvider endpoint="/agent" fetch={fetcher} animationDuration={0} webmcp={false}>
        <Tool execute={execute} />
        <Surface />
      </PagewayProvider>,
    );
    start();
    fireEvent.keyDown(await approval(), { key: ' ' });
    await screen.findByText('The request is complete.');
    expect(execute).not.toHaveBeenCalled();
    expect(screen.getByText('Rejected by you')).toBeTruthy();
    expect(screen.getByText('Rejected')).toBeTruthy();
    expect(JSON.parse(requests[1].messages.at(-1)!.content!)).toMatchObject({ ok: false });
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('cycles dialog controls and allows argument scrolling while blocking host shortcuts', async () => {
    const { fetcher } = transport();
    const execute = vi.fn();
    const shortcut = vi.fn();
    document.addEventListener('keydown', shortcut, true);
    try {
      render(
        <PagewayProvider endpoint="/agent" fetch={fetcher} animationDuration={0} webmcp={false}>
          <Tool execute={execute} />
          <Surface />
        </PagewayProvider>,
      );
      start();
      const reject = await approval();
      const content = document.querySelector<HTMLElement>('[data-pageway-scroll]')!;
      Object.defineProperties(content, {
        clientHeight: { value: 200 },
        scrollHeight: { value: 1000 },
      });
      fireEvent.keyDown(reject, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(content);
      fireEvent.keyDown(content, { key: 'PageDown' });
      expect(content.scrollTop).toBe(160);
      fireEvent.keyDown(content, { key: 'End' });
      expect(content.scrollTop).toBe(1000);
      fireEvent.keyDown(content, { key: 'Home' });
      expect(content.scrollTop).toBe(0);
      fireEvent.keyDown(content, { key: 'ArrowDown' });
      expect(content.scrollTop).toBe(40);
      fireEvent.keyDown(content, { key: 'ArrowUp' });
      expect(content.scrollTop).toBe(0);
      fireEvent.keyDown(content, { key: ' ' });
      fireEvent.keyDown(content, { key: 'PageUp' });
      expect(content.scrollTop).toBe(0);
      fireEvent.keyDown(content, { key: 'Tab' });
      expect(document.activeElement).toBe(reject);
      fireEvent.keyDown(reject, { key: 'Tab' });
      const approve = screen.getByRole('button', { name: 'Approve this action' });
      expect(document.activeElement).toBe(approve);
      fireEvent.keyDown(approve, { key: 'Tab' });
      const stop = screen.getByRole('button', { name: /Stop task/ });
      expect(document.activeElement).toBe(stop);
      fireEvent.keyDown(stop, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(approve);
      expect(fireEvent.wheel(content)).toBe(true);
      expect(fireEvent.wheel(document.querySelector('dialog')!)).toBe(false);
      expect(shortcut).not.toHaveBeenCalled();
      fireEvent.keyDown(stop, { key: 'Enter' });
      await waitFor(() => expect(screen.getByLabelText('Agent state').textContent).toBe('idle'));
      expect(execute).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', shortcut, true);
    }
  });

  it.each(['Escape', 'Stop'])(
    'cancels the whole pending task with %s and releases the page',
    async (method) => {
      const { fetcher, requests } = transport();
      const execute = vi.fn();
      const page = render(
        <PagewayProvider endpoint="/agent" fetch={fetcher} animationDuration={0} webmcp={false}>
          <Tool execute={execute} />
          <Surface />
        </PagewayProvider>,
      );
      start();
      const reject = await approval();
      if (method === 'Escape') fireEvent.keyDown(reject, { key: 'Escape' });
      else fireEvent.click(screen.getByRole('button', { name: /Stop task/ }));
      await waitFor(() => expect(screen.getByLabelText('Agent state').textContent).toBe('idle'));
      expect(execute).not.toHaveBeenCalled();
      expect(requests).toHaveLength(1);
      expect(Boolean(page.container.inert)).toBe(false);
      expect(screen.queryByRole('button', { name: 'Approve this action' })).toBeNull();
      expect(screen.getByText('Cancelled')).toBeTruthy();
    },
  );

  it('does not transfer approval to a replacement registration with the same tool name', async () => {
    const { fetcher } = transport();
    const execute = vi.fn();
    const view = (key: string) => (
      <PagewayProvider endpoint="/agent" fetch={fetcher} animationDuration={0} webmcp={false}>
        <Tool key={key} execute={execute} />
        <Surface />
      </PagewayProvider>
    );
    const page = render(view('original'));
    start();
    await approval();
    page.rerender(view('replacement'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve this action' }));
    await screen.findByText('The request is complete.');
    expect(execute).not.toHaveBeenCalled();
    expect(screen.getByText(/Request the operation again for a fresh review/)).toBeTruthy();
  });

  it.each([
    { enabled: false },
    { allowedSources: ['webmcp'] as PagewayActionSource[] },
    { allowedSources: [] as PagewayActionSource[] },
  ])(
    'refreshes capability metadata and prevents execution after permissions change: %j',
    async (policy) => {
      const { fetcher } = transport();
      const execute = vi.fn();
      const view = (props: Partial<ToolProps>) => (
        <PagewayProvider endpoint="/agent" fetch={fetcher} animationDuration={0} webmcp={false}>
          <Tool execute={execute} {...props} />
          <Surface />
        </PagewayProvider>
      );
      const page = render(view({}));
      expect(screen.getByText('1 page tools available')).toBeTruthy();
      start();
      await approval();
      page.rerender(view(policy));
      expect(screen.getByText('0 page tools available')).toBeTruthy();
      expect(JSON.parse(screen.getByLabelText('Tool metadata').textContent!)[0]).toMatchObject(
        policy,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Approve this action' }));
      await screen.findByText('The request is complete.');
      expect(execute).not.toHaveBeenCalled();
      expect(screen.getByText('Error')).toBeTruthy();
    },
  );

  it('leaves custom locking and focus to the host with lockPage=false while decisions remain usable', async () => {
    const { fetcher } = transport();
    const execute = vi.fn();
    const page = render(
      <PagewayProvider endpoint="/agent" fetch={fetcher} animationDuration={0} webmcp={false}>
        <Tool execute={execute} />
        <Surface lockPage={false} />
      </PagewayProvider>,
    );
    const input = screen.getByRole('textbox', { name: 'Message Pageway' });
    input.focus();
    start();
    const reject = await approval();
    expect(document.activeElement).toBe(input);
    expect(Boolean(page.container.inert)).toBe(false);
    expect(document.querySelector('dialog')).toBeNull();
    fireEvent.click(reject);
    await screen.findByText('The request is complete.');
    expect(execute).not.toHaveBeenCalled();
  });

  it('refreshes browser registrations with permission changes and presents browser requests for review', async () => {
    type BrowserTool = {
      name: string;
      execute: (args: Record<string, unknown>) => Promise<unknown>;
    };
    const tools = new Map<string, BrowserTool>();
    vi.stubGlobal('navigator', {
      modelContext: {
        registerTool: (tool: BrowserTool) => {
          tools.set(tool.name, tool);
        },
        unregisterTool: (name: string) => {
          tools.delete(name);
        },
      },
    });
    const execute = vi.fn();
    const view = (props: Partial<ToolProps>) => (
      <PagewayProvider animationDuration={0}>
        <Tool execute={execute} {...props} />
        <Surface />
      </PagewayProvider>
    );
    const page = render(view({ allowedSources: ['chat'] }));
    await waitFor(() => expect(tools.has('pageway_get_context')).toBe(true));
    expect(tools.has('pageway_delete_item')).toBe(false);
    page.rerender(view({ allowedSources: ['webmcp'] }));
    await waitFor(() => expect(tools.has('pageway_delete_item')).toBe(true));
    expect(screen.getByText('0 page tools available')).toBeTruthy();
    let response!: Promise<unknown>;
    act(() => {
      response = tools.get('pageway_delete_item')!.execute({ id: 'item-7' });
    });
    await approval();
    expect(screen.getByText('Browser agent (WebMCP)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve this action' }));
    await act(async () => {
      await response;
    });
    expect(execute).toHaveBeenCalledWith('item-7', 1);
    page.rerender(view({ allowedSources: ['webmcp'], enabled: false }));
    await waitFor(() => expect(tools.has('pageway_delete_item')).toBe(false));
  });
});
