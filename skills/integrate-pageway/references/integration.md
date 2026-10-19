# Integration examples

These examples use the current `apiOrigin`, `storageKey`, and `webmcp` APIs. Adapt the counter operation to the host application's existing state/service; the counter itself is not a required integration pattern.

## React: tools, page context, chat, and motion

Install `@zllling/pageway-react` with the host's package manager, preserving its existing React/React DOM pair. Import global CSS at the location supported by its framework.

```tsx
'use client';

import { useState } from 'react';
import {
  ActionTimeline,
  PagewayChat,
  PagewayOverlay,
  PagewayProvider,
  usePageContext,
  usePageTool,
  usePageway,
} from '@zllling/pageway-react';
import '@zllling/pageway-react/styles.css';

function CounterPage() {
  const [value, setValue] = useState(0);
  usePageContext({
    id: 'counter',
    title: 'Counter',
    data: { value, minimum: 0, maximum: 100 },
  });
  usePageTool<{ value: number }>({
    name: 'set_counter',
    description: 'Set the visible counter to an integer between 0 and 100.',
    parameters: {
      type: 'object',
      properties: { value: { type: 'integer', minimum: 0, maximum: 100 } },
      required: ['value'],
      additionalProperties: false,
    },
    target: '#counter-value',
    execute(args, { signal }) {
      signal.throwIfAborted();
      setValue(args.value);
      return { value: args.value };
    },
  });
  return (
    <main>
      <h1>Counter</h1>
      <output id="counter-value" aria-live="polite">
        {value}
      </output>
      <button onClick={() => setValue((current) => Math.min(100, current + 1))}>Increment</button>
    </main>
  );
}

function SessionControls({ logout }: { logout: () => void }) {
  const { reset, webmcp } = usePageway();
  return (
    <aside>
      <p>WebMCP: {webmcp.status}</p>
      <button onClick={reset}>Clear conversation</button>
      <button
        onClick={() => {
          reset();
          logout();
        }}
      >
        Sign out
      </button>
    </aside>
  );
}

export function AssistedApp({
  userId,
  workspaceId,
  model,
  logout,
}: {
  userId: string;
  workspaceId: string;
  model: string;
  logout: () => void;
}) {
  return (
    <PagewayProvider
      apiOrigin="/api/openai"
      model={model}
      storageKey={`pageway:${workspaceId}:${userId}`}
      webmcp={{ prefix: 'counter_' }}
    >
      <CounterPage />
      <PagewayChat suggestions={['Set the counter to 12.']} />
      <ActionTimeline />
      <SessionControls logout={logout} />
      <PagewayOverlay />
    </PagewayProvider>
  );
}
```

The completion URL above is `/api/openai/chat/completions`. `model` is a model identifier enabled by that service, not a provider key. The same registered operation is available as `counter_set_counter`; `counter_get_context` reads the counter context.

For an async tool, pass its signal to the existing service and check it before committing the result. For example, an operation using `fetch` should pass `{ signal }`, check `response.ok`, read its response, then call `signal.throwIfAborted()` before updating React state. Return the server's actual result. Use the application's normal persisted store instead of component-local state when data must survive a reload.

## Optional server: ordinary OpenAI completion proxy

Install `@zllling/pageway-agent` in the server workspace. Mount the resulting handler at POST `/api/openai/chat/completions` through the framework's standard `Request`/`Response` adapter. Configure the server environment explicitly; these variables must not be exposed to a browser build.

```ts
import { createOpenAIProxyHandler } from '@zllling/pageway-agent';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

export function createCompletionRoute(authorize: (request: Request) => boolean | Promise<boolean>) {
  const proxy = createOpenAIProxyHandler({
    baseURL: required('MODEL_BASE_URL'),
    apiKey: required('MODEL_API_KEY'),
    allowedModels: [required('MODEL_NAME')],
    timeoutMs: 45_000,
  });

  return async (request: Request): Promise<Response> => {
    if (!(await authorize(request))) {
      return Response.json({ error: 'Authentication required.' }, { status: 401 });
    }
    return proxy(request);
  };
}
```

Supply `authorize` from the application's existing authentication and access-control layer. Preserve its CSRF protection and usage limits. The proxy's upstream base URL is server configuration; do not read an arbitrary upstream URL from browser request data. Incoming browser `Authorization` is not forwarded as the model credential. If an existing authenticated proxy already preserves OpenAI request/response semantics and streaming cancellation, no Pageway-specific server package is required.

The built-in proxy defaults its upstream path to `chat/completions`; its optional `apiPath` changes that upstream path. This is separate from the frontend `apiPath`, which selects the path on the application's proxy. Mounting a proxy at a custom route does not change the provider's upstream API path automatically.

## Existing AG-UI service

Retain the existing server and use:

```tsx
<PagewayProvider endpoint="/api/agent">
  <CounterPage />
  <PagewayChat />
  <PagewayOverlay />
</PagewayProvider>
```

`endpoint` expects Pageway's AG-UI event protocol, so an ordinary Chat Completions URL belongs in `apiOrigin` configuration instead. Optional `storageKey` and `webmcp` settings work with either transport.

## WebMCP-only application

Reuse the same tools and context without configuring a model service:

```tsx
<PagewayProvider webmcp={{ prefix: 'counter_' }}>
  <CounterPage />
  <ActionTimeline />
  <PagewayOverlay />
</PagewayProvider>
```

No `PagewayChat`, API origin, endpoint, or provider key is needed. An external browser agent can discover the registered tools when the browser supports WebMCP. Check `usePageway().webmcp.status`; `unsupported` is an availability result, not a successful registration. A namespace avoids collisions between multiple Pageway providers. Do not replace the browser's native API with a mock outside tests.

## Test fixtures and account lifecycle

Use a local OpenAI-compatible fixture or an injected `fetch` implementation that returns the expected streaming completion chunks. Include at least one tool call and a subsequent assistant response after the fixture receives the tool result. For an existing AG-UI setup, return AG-UI events instead. Keep the two wire formats distinct.

Model fixtures should run without loading paid credentials. In the Pageway repository, use the established fixture-backed unit/E2E scripts and its React consumer compatibility checks; in another application, extend its existing runner. A mocked WebMCP API verifies registration lifecycle and shared execution behavior, while a real supported browser is needed to verify native discovery.

Mount the provider only in the authenticated area, scope the cache key to the active account/workspace, and invoke `reset()` before signing out. Reload should restore the conversation but not change host business state or trigger model traffic. Switch accounts while an operation is pending to verify that the old operation is cancelled and the new account receives its own conversation.
