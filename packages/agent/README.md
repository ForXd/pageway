# @zllling/pageway-agent

A Fetch-native AG-UI HTTP handler that connects registered browser tools to an OpenAI-compatible model API. Part of [Pageway](https://github.com/ForXd/pageway).

```sh
pnpm add @zllling/pageway-agent
```

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

Expose the handler at an authenticated HTTP endpoint. It accepts a standard `Request` and returns a streaming `Response`; browser tools run in the frontend and their results arrive in the next request. Keep model credentials on the server.

`createAgentHandler()` without configuration uses a deterministic playground demo, not an LLM. Real providers must support Chat Completions streaming, function tools and tool-result continuation.

See [integration](https://github.com/ForXd/pageway#readme), [protocol](https://github.com/ForXd/pageway/blob/main/docs/protocol.md), and [provider setup](https://github.com/ForXd/pageway/blob/main/docs/providers.md). MIT licensed.
