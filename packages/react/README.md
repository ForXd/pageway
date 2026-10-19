# @zllling/pageway-react

React tools, page context, conversation UI, and visible agent actions for Pageway.

Import `@zllling/pageway-react/styles.css` and render `PagewayOverlay` inside `PagewayProvider`
to show the agent cursor, action path, and task controls.

## Connect an existing React application

```tsx
import { useState } from 'react';
import {
  PagewayProvider,
  PagewayChat,
  PagewayOverlay,
  ActionTimeline,
  usePageTool,
  usePageContext,
} from '@zllling/pageway-react';
import '@zllling/pageway-react/styles.css';

function Counter() {
  const [value, setValue] = useState(0);
  usePageContext({ id: 'counter', title: 'Counter', data: { value } });
  usePageTool<{ value: number }>({
    name: 'set_counter',
    description: 'Set the displayed counter to a number',
    parameters: {
      type: 'object',
      properties: { value: { type: 'number' } },
      required: ['value'],
      additionalProperties: false,
    },
    target: '#counter',
    execute: ({ value }) => {
      setValue(value);
      return { value };
    },
  });
  return <output id="counter">{value}</output>;
}

export default function App() {
  return (
    <PagewayProvider
      apiOrigin="/api/openai"
      model="your-tool-capable-model"
      storageKey="my-app:current-user:pageway"
      timeoutMs={180_000}
    >
      <Counter />
      <PagewayChat />
      <ActionTimeline />
      <PagewayOverlay />
    </PagewayProvider>
  );
}
```

The frontend sends ordinary OpenAI Chat Completions requests. A server only needs
to expose a compatible endpoint, optionally proxying server-held credentials;
it does not need to implement an agent loop. Pageway assembles messages and tools,
executes registered callbacks, and continues with actual tool results and fresh
page context. Model API keys belong on the server.

| Provider option     | Meaning                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `apiOrigin`         | Relative or absolute API root, such as `/api/openai` or `https://gateway.example/v1`         |
| `apiPath`           | Completion path appended to that root; defaults to `chat/completions`                        |
| `model`             | Tool-capable model identifier accepted by your endpoint                                      |
| `headers`           | Application authentication headers; do not embed a provider key in browser code              |
| `timeoutMs`         | Per-round timeout in apiOrigin mode: 180000 ms by default, range 1–300000                    |
| `endpoint`          | Existing AG-UI HTTP endpoint; configure this **or** apiOrigin, never both                    |
| `storageKey`        | Optional localStorage key, scoped to the current application/user/workspace                  |
| `webmcp`            | Defaults to `true`; `false` disables registration; `{ prefix: 'shop_' }` selects a namespace |
| `animationDuration` | Cursor travel duration in milliseconds                                                       |
| `fetch`             | Optional HTTP transport override                                                             |

AG-UI endpoint mode preserves the pre-0.2 integration and delegates model timeout
configuration to its server. With neither endpoint nor apiOrigin, the provider can
expose tools through WebMCP without a chat backend. Omit `PagewayChat` in that mode.

`usePageway()` exposes `messages`, `sendMessage`, `stop`, `reset`, `status`, `error`,
`actions`, `events`, `tools`, and `webmcp`. A registered tool's latest callback and
context are read at execution time. Unknown tools and invalid arguments are
rejected before their callback runs. Backend business authorization remains the
responsibility of the application.

## Optional local conversation cache

Set `storageKey` to enable localStorage persistence. Task completion, page exit,
provider unmount, and key changes checkpoint conversation history and action
records. Omit the option to keep the session in memory. Scope the key to the signed-in user and
workspace, and clear the current session with `usePageway().reset()` on logout.
Changing the key switches sessions and stops the previous task.

Entries expire after seven days and are limited to 1 MiB. Unsupported storage,
quota errors, invalid payloads, and expired records are ignored without breaking
chat. Restore never re-executes a tool, resumes a network request, restores a page
lock or animation, or restores application business state. Incomplete restored
tool calls are normalized into failed results, so they cannot be replayed as
pending operations. Reloading during a task restores the saved conversation with
an explicit interrupted result, not a resumable task.

This is same-origin plaintext browser storage, not a server session database. It
contains messages, tool arguments/results, and any message metadata required for
model continuation. Enable it according to your application's data policy. It
does not persist headers, provider options, DOM objects, or tool callbacks.

## WebMCP without an agent server

```tsx
<PagewayProvider webmcp={{ prefix: 'shop_' }}>
  <Counter />
  <ActionTimeline />
  <PagewayOverlay />
</PagewayProvider>
```

Tools registered with `usePageTool` become browser WebMCP tools. The default
prefix is `pageway_`; this example exposes `shop_set_counter`. The reserved
`shop_get_context` tool returns the latest explicitly registered page context as
`{ ok: true, result: { page: [...] } }`. No model endpoint or key is required for
an external browser agent to call those tools.

The bridge prefers `document.modelContext` from the current draft and adapts the
early `navigator.modelContext.registerTool/unregisterTool` API when available.
Native calls return JSON `{ ok: true, result }` or `{ ok: false, error }`; the
legacy adapter wraps the same JSON in an MCP text-content result. Metadata and
schemas update with the React registry, unmount removes owned tools, and name
collisions surface an error without replacing another registration.

`usePageway().webmcp` has `status`, `registered` (tool names), and `error`.
Statuses are `disabled`, `unsupported`, `registering`, `ready`, and `error`.
The bridge is enabled by default; pass `webmcp={false}` to opt out. External
calls share the chat executor's schema validation, action trail, animations,
interaction lock, and stop control. Calls while another task is active are
rejected; execution cancellation propagates to the registered callback.

WebMCP is experimental and requires support in both the browser and invoking
agent. Pageway does not install a polyfill or turn an unsupported browser into an
MCP server. Chrome local testing requires
`chrome://flags/#enable-webmcp-testing`; public sites follow the browser's origin
trial requirements. Cross-origin frames also require the relevant browser
permissions policy; Pageway does not expose tools to arbitrary external origins.
See the [current specification](https://webmachinelearning.github.io/webmcp/)
and [Chrome guide](https://developer.chrome.com/docs/ai/webmcp/imperative-api).

The repository includes an [integration skill](https://github.com/ForXd/pageway/blob/main/skills/integrate-pageway/SKILL.md)
for coding assistants and [typechecked React examples](https://github.com/ForXd/pageway/tree/main/apps/site/src/examples).

## React compatibility

Since version 0.1.3, the SDK supports React and React DOM `^18.0.0 || ^19.0.0`.
Keep `react` and `react-dom` on the same version. TypeScript applications should
use the matching major versions of `@types/react` and `@types/react-dom`.
The repository demos use React 19; the same Pageway APIs work in React 18.

Mount client applications with `createRoot` from `react-dom/client`:

```tsx
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);
```

Release checks install the packed SDK tarballs with React 18.0.0, 18.2.0, 18.3.1,
and 19.3.1, then verify strict peer resolution, TypeScript declarations, SSR, and
client tool execution, state updates, cancellation, and StrictMode cleanup.

## Interaction locking

`PagewayOverlay` locks the host page from the beginning of a run, including model
planning and network waits. It uses a modal dialog, makes surrounding content inert,
prevents manual scrolling and editing, and keeps **Stop task** available. Escape
cancels the task. Completion, cancellation, or unmount releases the lock and restores
the previous focus and scrolling state. Application updates and programmatic
scrolling remain available to registered tools.

Keyboard and `beforeinput` interception runs in the window capture phase, before
document and element handlers. A host shortcut already registered on **window in
capture mode** can run before Pageway's listener; that shortcut must check the
current `usePageway().status` and return while it equals `'running'`. Keep the
current status in a ref when registering a long-lived native event listener.
Pageway does not replace or patch the browser event system.

`<PagewayOverlay lockPage={false} />` disables the built-in lock for applications
that provide their own accessible interaction lock. Registered asynchronous tools
should observe the supplied `AbortSignal` before performing delayed side effects.

## Operation feedback

The overlay separates each action into a curved cursor journey, target focus,
application, and a readable completion cue. The cursor and the progressive SVG
trail share the same Bézier route; previous waypoints remain visible during the
run. A numbered target label ties the current operation to the action timeline.
The target is measured again after the callback commits so moved elements receive
feedback at their new position.

`animationDuration` on `PagewayProvider` controls travel time (850 ms by default).
Normal motion keeps completion feedback visible for 600–800 ms, even for instant
callbacks. The browser's `prefers-reduced-motion: reduce` setting skips travel and
decorative animation, retaining static target and success/error feedback. Stop and
Escape remain responsive during every phase, including the completion cue.
Cancellation after a callback has completed preserves its successful result.

For browser integration tests, the overlay exposes `data-pageway-phase` with
`planning`, `moving`, `acting`, `success`, or `error`, plus
`[data-pageway-stop]`. A locked run uses
`dialog[data-pageway-lock="true"][open]`. Reduced motion omits `moving`; tests
should assert the applied result and static feedback instead of requiring travel.
