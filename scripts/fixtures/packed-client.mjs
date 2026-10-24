import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// This file is copied into each npm consumer so every import, including React
// inside the SDK, resolves against that consumer's installed packages.
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
for (const name of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLDialogElement',
  'MutationObserver',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
])
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
// Let concurrent updates use React's normal scheduler. Wrapping a whole agent
// task in async act artificially holds React 18 updates across tool boundaries.
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
const React = await import('react');
const { createElement: h, StrictMode, useState } = React;
const { createRoot } = await import('react-dom/client');
const { flushSync } = await import('react-dom');
const { encodeSSE } = await import('@zllling/pageway-protocol');
const {
  PagewayProvider,
  PagewayChat,
  PagewayOverlay,
  ActionTimeline,
  usePageTool,
  usePageContext,
  usePageway,
} = await import('@zllling/pageway-react');

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function deadline(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Consumer task did not finish in 10s.')), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(predicate) {
  const end = Date.now() + 10_000;
  while (!predicate()) {
    assert(Date.now() < end, 'Consumer state did not settle in 10s.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function connect(count = 2) {
  const requests = [];
  const signals = [];
  const fetcher = async (_url, init) => {
    const request = JSON.parse(init.body);
    requests.push(request);
    signals.push(init.signal);
    const events = [{ type: 'RUN_STARTED', runId: request.runId, threadId: request.threadId }];
    if (requests.length === 1) {
      for (let index = 0; index < count; index++) {
        const toolCallId = `change-${index}`;
        events.push(
          {
            type: 'TOOL_CALL_START',
            toolCallId,
            toolCallName: 'add_value',
            parentMessageId: 'assistant-1',
          },
          { type: 'TOOL_CALL_ARGS', toolCallId, delta: '{"value":2}' },
          { type: 'TOOL_CALL_END', toolCallId },
        );
      }
    } else {
      events.push(
        { type: 'TEXT_MESSAGE_START', messageId: 'reply', role: 'assistant' },
        { type: 'TEXT_MESSAGE_CONTENT', messageId: 'reply', delta: 'The update is confirmed.' },
        { type: 'TEXT_MESSAGE_END', messageId: 'reply' },
      );
    }
    events.push({ type: 'RUN_FINISHED', runId: request.runId, threadId: request.threadId });
    return new Response(events.map(encodeSSE).join(''), {
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  return { requests, signals, fetcher };
}

async function mount(fetcher, pending, policy = {}) {
  const host = document.createElement('div');
  host.inert = false;
  document.body.append(host);
  const root = createRoot(host);
  let current;
  function Page({ factor }) {
    const [value, setValue] = useState(0);
    current = usePageway();
    usePageContext({ id: 'counter', title: 'Counter', data: { value, factor } });
    usePageTool({
      name: 'add_value',
      description: `Add with multiplier ${factor}`,
      parameters: {
        type: 'object',
        properties: { value: { type: 'number' } },
        required: ['value'],
        additionalProperties: false,
      },
      ...policy,
      execute: async (args, { signal }) => {
        if (pending) {
          pending.signal = signal;
          pending.entered.resolve();
          await pending.complete.promise;
          signal.throwIfAborted();
        } else await Promise.resolve();
        const next = value + args.value * factor;
        setValue(next);
        return { value: next };
      },
    });
    return h(
      'main',
      null,
      h('output', { 'aria-label': 'Page value' }, value),
      h('button', { type: 'button', 'aria-label': 'Host control' }, 'Host control'),
      h(PagewayChat),
      h(ActionTimeline),
      h(PagewayOverlay),
    );
  }
  const render = (factor) => {
    flushSync(() => {
      root.render(
        h(
          StrictMode,
          null,
          h(
            PagewayProvider,
            { endpoint: '/agent', fetch: fetcher, animationDuration: 0 },
            h(Page, { factor }),
          ),
        ),
      );
    });
  };
  const unmount = () => {
    flushSync(() => root.unmount());
    host.remove();
  };
  await render(1);
  return {
    host,
    render,
    unmount,
    get agent() {
      return current;
    },
  };
}

function assertUnlocked(host, overflow) {
  assert.equal(document.querySelector('dialog[open]'), null);
  assert.equal(document.body.style.overflow, overflow.body);
  assert.equal(document.documentElement.style.overflow, overflow.root);
  assert.equal(host.inert, false);
}

const errors = [];
const originalError = console.error;
console.error = (...args) => {
  errors.push(args.map(String).join(' '));
  originalError(...args);
};
try {
  const connection = connect();
  const page = await mount(connection.fetcher);
  try {
    await page.render(3);
    assert.equal(page.agent.tools.length, 1, 'Strict Mode must leave exactly one registration.');
    await deadline(page.agent.sendMessage('Update the counter twice'));
    await waitFor(() => page.agent.status === 'idle');
    assert.equal(page.host.querySelector('output').textContent, '12');
    assert.equal(page.agent.status, 'idle');
    assert.equal(connection.requests.length, 2);
    assert.equal(connection.requests[0].tools[0].description, 'Add with multiplier 3');
    assert.deepEqual(connection.requests[1].state.page[0].data, { value: 12, factor: 3 });
    assert.deepEqual(
      connection.requests[1].messages
        .filter((message) => message.role === 'tool')
        .map((message) => JSON.parse(message.content)),
      [
        { ok: true, result: { value: 6 } },
        { ok: true, result: { value: 12 } },
      ],
    );
    assert.equal(page.agent.actions.filter((action) => action.status === 'success').length, 2);
    assert(page.host.textContent.includes('The update is confirmed.'));
  } finally {
    await page.unmount();
  }

  const reviewedConnection = connect(2);
  const reviewedPage = await mount(reviewedConnection.fetcher, undefined, {
    enabled: true,
    allowedSources: ['chat'],
    approval: {
      title: 'Approve counter change?',
      description: 'The page counter will increase by the requested value.',
    },
  });
  try {
    assert.equal(reviewedPage.agent.tools[0].enabled, true);
    assert.deepEqual(reviewedPage.agent.tools[0].allowedSources, ['chat']);
    const task = reviewedPage.agent.sendMessage('Review each counter change');
    await waitFor(() => reviewedPage.agent.pendingApproval !== null);
    const firstReview = reviewedPage.agent.pendingApproval;
    assert.equal(firstReview.source, 'chat');
    assert.equal(firstReview.title, 'Approve counter change?');
    assert.deepEqual(firstReview.args, { value: 2 });
    assert.equal(reviewedPage.agent.status, 'running');
    assert.equal(reviewedPage.host.querySelector('output').textContent, '0');
    assert.equal(reviewedPage.agent.approveAction('stale-review'), false);
    assert.equal(reviewedPage.agent.approveAction(firstReview.id), true);
    assert.equal(reviewedPage.agent.approveAction(firstReview.id), false);
    await waitFor(() => {
      const pending = reviewedPage.agent.pendingApproval;
      return pending !== null && pending.id !== firstReview.id;
    });
    const secondReview = reviewedPage.agent.pendingApproval;
    assert.equal(reviewedPage.host.querySelector('output').textContent, '2');
    assert.equal(reviewedPage.agent.rejectAction(secondReview.id), true);
    assert.equal(reviewedPage.agent.approveAction(secondReview.id), false);
    await deadline(task);
    await waitFor(() => reviewedPage.agent.status === 'idle');
    assert.equal(reviewedPage.agent.pendingApproval, null);
    assert.equal(reviewedPage.host.querySelector('output').textContent, '2');
    assert.deepEqual(
      reviewedPage.agent.actions.map((action) => action.status),
      ['success', 'rejected'],
    );
    assert.deepEqual(
      reviewedPage.agent.actions.map((action) => action.approval.status),
      ['approved', 'rejected'],
    );
    assert.equal(reviewedConnection.requests.length, 2);
    assert.deepEqual(
      reviewedConnection.requests[1].messages
        .filter((message) => message.role === 'tool')
        .map((message) => JSON.parse(message.content).ok),
      [true, false],
    );
  } finally {
    await reviewedPage.unmount();
  }

  for (const action of ['stop', 'unmount']) {
    const pending = { entered: deferred(), complete: deferred() };
    const connection = connect(1);
    const page = await mount(connection.fetcher, pending);
    const overflow = {
      body: document.body.style.overflow,
      root: document.documentElement.style.overflow,
    };
    const hostControl = page.host.querySelector('[aria-label="Host control"]');
    hostControl.focus();
    let task;
    let mounted = true;
    try {
      task = page.agent.sendMessage('Start a pending update');
      await deadline(pending.entered.promise);
      await waitFor(() => page.agent.status === 'running');
      assert.equal(page.agent.status, 'running');
      assert.equal(pending.signal.aborted, false);
      assert(document.querySelector('dialog[open]'));
      assert.equal(document.body.style.overflow, 'hidden');
      assert.equal(page.host.inert, true);
      const keyboard = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
      hostControl.dispatchEvent(keyboard);
      assert.equal(
        keyboard.defaultPrevented,
        true,
        'The active task must block host keyboard input.',
      );
      if (action === 'stop') {
        const stop = document.querySelector('dialog button');
        assert(stop);
        stop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await deadline(task);
        await waitFor(() => page.agent.status === 'idle');
        assert.equal(page.agent.status, 'idle');
        assert.equal(document.activeElement, hostControl);
      } else {
        await page.unmount();
        mounted = false;
        await deadline(task);
      }
      assert.equal(pending.signal.aborted, true);
      assert.equal(connection.signals[0].aborted, true);
      assertUnlocked(page.host, overflow);
      pending.complete.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(connection.requests.length, 1, 'Cancelled work must not send a continuation.');
      if (mounted) assert.equal(page.host.querySelector('output').textContent, '0');
    } finally {
      if (mounted) await page.unmount();
      pending.complete.resolve();
    }
  }
  assert.deepEqual(errors, [], 'React client must not emit lifecycle warnings.');
  console.log(
    `React ${React.version}: StrictMode, async tool roundtrip, fresh state, approval/rejection, stop and unmount cleanup passed.`,
  );
} finally {
  console.error = originalError;
  dom.window.close();
}
