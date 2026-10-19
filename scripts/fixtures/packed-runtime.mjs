import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { EventType, encodeSSE, readAgentEvents } from '@zllling/pageway-protocol';
import { createAgentHandler } from '@zllling/pageway-agent';
import {
  PagewayProvider,
  PagewayChat,
  PagewayOverlay,
  ActionTimeline,
  usePageTool,
  usePageContext,
} from '@zllling/pageway-react';

assert(
  encodeSSE({ type: EventType.RUN_FINISHED, runId: 'run', threadId: 'thread' }).startsWith('data:'),
);
for (const name of ['protocol', 'agent', 'react'])
  assert(import.meta.resolve(`@zllling/pageway-${name}`).includes('/dist/'));
assert(
  (
    await readFile(new URL(import.meta.resolve('@zllling/pageway-react/styles.css')), 'utf8')
  ).includes('.pw-'),
);
const errors = [];
const originalError = console.error;
console.error = (...args) => {
  errors.push(args.map(String).join(' '));
  originalError(...args);
};
let html;
function ServerPage() {
  usePageContext({ id: 'ssr', title: 'Server page', data: { value: 0 } });
  usePageTool({
    name: 'echo',
    description: 'Echo',
    parameters: { type: 'object' },
    execute: (value) => value,
  });
  return createElement(ActionTimeline);
}
try {
  html = renderToString(
    createElement(
      PagewayProvider,
      { endpoint: '/api/agent' },
      createElement(PagewayChat),
      createElement(PagewayOverlay),
      createElement(ServerPage),
    ),
  );
} finally {
  console.error = originalError;
}
assert.deepEqual(errors, [], 'React SSR must not emit layout effect warnings.');
assert(html.includes('Pageway'));
const request = new Request('http://localhost/api/agent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    threadId: 'consumer',
    runId: 'run',
    messages: [{ id: 'message', role: 'user', content: 'Hello' }],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  }),
});
const response = await createAgentHandler({ mode: 'demo' })(request);
assert.equal(response.status, 200);
const events = [];
for await (const event of readAgentEvents(response.body)) events.push(event.type);
assert(events.includes(EventType.RUN_STARTED) && events.includes(EventType.RUN_FINISHED));
console.log('Packed runtime, CSS, SSR and HTTP consumer checks passed.');
