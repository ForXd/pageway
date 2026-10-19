# @zllling/pageway-agent

OpenAI-compatible credential proxy, streaming model adapter, and optional AG-UI
HTTP handler for [Pageway](https://github.com/ForXd/pageway).

```sh
pnpm add @zllling/pageway-agent
```

## Standard model proxy

The React SDK runs the agent loop in the browser. If you already have an
OpenAI-compatible gateway, point `PagewayProvider`'s `apiOrigin` at it; installing
this server package is optional. To keep a provider credential server-side:

```ts
import { createOpenAIProxyHandler } from '@zllling/pageway-agent';

// Mount at POST /api/openai/chat/completions after application authentication.
export const POST = createOpenAIProxyHandler({
  baseURL: process.env.MODEL_BASE_URL!,
  apiKey: process.env.MODEL_API_KEY,
  allowedModels: [process.env.MODEL_NAME!],
  timeoutMs: 180_000,
});
```

The corresponding frontend uses
`<PagewayProvider apiOrigin="/api/openai" model="your-model">`. Both HTTP sides
speak ordinary Chat Completions, including `messages`, `tools`, `stream`, and
tool results. The proxy does not execute tools or keep conversation state.

The upstream URL is fixed by server configuration. `apiPath` defaults to
`chat/completions`; `apiKey` is optional for anonymous/local providers.
`allowedModels` restricts client-selected model IDs. The handler never forwards
the client's Authorization header upstream; it uses its configured credential.
It enforces a 1 MiB body limit by default (`maxBodyBytes`), supports timeout and
cancellation, streams successful responses, and redacts upstream error bodies.

The handler accepts a standard Fetch `Request` and returns a `Response`, so it
can run in frameworks supporting that interface. Add application authentication,
quota controls, and any CORS policy around the handler. Model providers must
support streaming Chat Completions, function calls, and tool-result continuation.

## Existing AG-UI endpoint

Applications using `endpoint="/api/agent"` can continue using the original API:

```ts
import { createAgentHandler } from '@zllling/pageway-agent';

export const POST = createAgentHandler({
  mode: 'openai',
  baseURL: process.env.MODEL_BASE_URL,
  model: process.env.MODEL_NAME,
  apiKey: process.env.MODEL_API_KEY,
  timeoutMs: 180_000,
});
```

This handler accepts AG-UI `RunAgentInput` and returns AG-UI SSE. Browser tools
still execute on the frontend, with their results supplied in the next request.
`createAgentHandler()` without configuration uses a deterministic playground demo,
not an LLM. The HTTP proxy and AG-UI handler are alternatives; do not route an
apiOrigin frontend to an AG-UI endpoint.

WebMCP-only pages do not need either handler: external browser agents call the
registered frontend tools through the browser API.

See [integration](https://github.com/ForXd/pageway#readme),
[protocol](https://github.com/ForXd/pageway/blob/main/docs/protocol.md), and
[provider setup](https://github.com/ForXd/pageway/blob/main/docs/providers.md). MIT licensed.
