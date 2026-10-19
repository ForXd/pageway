# @zllling/pageway-protocol

AG-UI contracts and SSE transport utilities for [Pageway](https://github.com/ForXd/pageway).

Pageway 0.2 uses these events as its internal execution contract. With React
`apiOrigin`, the HTTP boundary remains ordinary OpenAI Chat Completions and the
browser performs the event adaptation. Existing `endpoint` integrations continue
to send AG-UI requests and events over HTTP. WebMCP tool calls use the browser API
and the shared frontend executor, without requiring an AG-UI server.

```sh
pnpm add @zllling/pageway-protocol
```

```ts
import { encodeSSE, readAgentEvents, EventType } from '@zllling/pageway-protocol';

const frame = encodeSSE({
  type: EventType.RUN_STARTED,
  threadId: 'thread-1',
  runId: 'run-1',
});

for await (const event of readAgentEvents(response.body, abortController.signal)) {
  console.log(event.type);
}
```

Exports the official AG-UI event/run types and schemas, Pageway page-context types, and `encodeSSE`, `parseSSE`, `readAgentEvents`. Streams handle UTF-8 byte boundaries, LF/CRLF/CR, multiline data, bounded frames and cancellation. Incomplete frames are never promoted to completed actions.

See the [protocol guide](https://github.com/ForXd/pageway/blob/main/docs/protocol.md). MIT licensed.
