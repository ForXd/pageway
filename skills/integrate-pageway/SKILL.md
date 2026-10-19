---
name: integrate-pageway
description: Integrate Pageway into an existing React 18 or 19 application with typed page tools, chat, an OpenAI-compatible API proxy, optional conversation caching, and browser WebMCP access. Use when adding or migrating a Pageway integration, including pages that expose tools to an external agent without their own chat backend.
---

# Integrate Pageway

Connect the application's existing state and actions to Pageway. Keep its React version, state manager, authentication, routing, and server framework. React and React DOM must use compatible versions; Pageway supports React 18 and 19. For React Server Components, place the provider and hooks inside a client component and import the stylesheet at the framework's supported global CSS boundary.

Read [integration examples](references/integration.md) for the provider, tools, proxy route, cache lifecycle, and WebMCP-only wiring. Check the installed Pageway package's exported types before editing: older releases may not expose `apiOrigin`, `storageKey`, or `webmcp`. Use a release containing these APIs, or workspace packages when contributing to Pageway itself.

## Choose the transport

| Application requirement                           | Provider configuration                      | Server requirement                                                      |
| ------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| Chat through a standard OpenAI-compatible service | `apiOrigin` and `model`; optional `apiPath` | An authenticated Chat Completions route that streams upstream responses |
| Existing Pageway AG-UI service                    | `endpoint`                                  | Keep the existing AG-UI endpoint                                        |
| External browser agent only                       | Omit `apiOrigin`, `model`, and `endpoint`   | No model or Pageway agent server needed                                 |

Configure either `endpoint` or `apiOrigin`, never both. `apiOrigin` is an API root: `/api/openai` defaults to POST `/api/openai/chat/completions`. `apiPath` changes the completion path appended to that root. The browser handles the tool loop and returns tool results to the model; an OpenAI proxy does not need to implement AG-UI.

For OpenAI-compatible transport, optional `timeoutMs` controls each completion request (default 180,000 ms; allowed range 1–300,000 ms). Match proxy and hosting timeouts to the intended model latency; increasing a frontend timeout does not override a shorter upstream timeout.

Keep provider API keys on the server. Do not put them in `VITE_*`, `NEXT_PUBLIC_*`, browser props, client headers, source control, or the session cache. Use the application's own authentication for access to the proxy. `createOpenAIProxyHandler` from `@zllling/pageway-agent` is optional: it forwards completions to a fixed upstream, attaches its server-side key, supports an allowed-model list, and carries request cancellation through streaming. An existing equivalent proxy is sufficient. Prefer same-origin routes; otherwise configure the host's CORS and authentication deliberately.

## Register application capabilities

- Mount `PagewayProvider` above components that call `usePageTool`, `usePageContext`, or `usePageway`. Import `@zllling/pageway-react/styles.css` once. Mount `PagewayOverlay` for animated targets, page locking, and the stop control; add `PagewayChat` only when chat is configured, and `ActionTimeline` when a visible history is useful.
- Register small business operations with JSON schemas, explicit descriptions, and stable names of 1–64 letters, digits, underscores, or hyphens. Use unique names per provider. For each operation, call the same application service or state action used by its manual UI; do not create a separate competing state store for the agent.
- Publish minimal current application state through `usePageContext`. Its hook reads fresh values on each render; do not register a stale initial snapshot or expose credentials and unrelated account data.
- Give tools a stable `target` selector or a resolver returning an existing element so the user can follow the operation. Return the actual JSON-serializable outcome, including identifiers or values needed for the next action.
- Honor the provided `AbortSignal`: pass it to asynchronous requests and check it before committing state after an await. Cancellation cannot undo an already committed server mutation; report its actual outcome instead of pretending it was rolled back.
- Keep existing authorization and domain validation in application services. A tool schema checks shape, not whether the user owns an object. Existing global keyboard handlers registered on `window` capture should also honor `usePageway().status === 'running'` while the overlay owns page interaction.

## Enable conversation caching deliberately

Caching is opt-in with `storageKey`. Scope it to opaque user and workspace identifiers, for example `pageway:${workspaceId}:${userId}`. Avoid a shared key for authenticated users and do not include tokens in the key. Call `usePageway().reset()` before logout or permanently discarding that conversation; changing `storageKey` selects a different conversation.

The local cache stores conversation messages, tool results, and action history, with a seven-day expiry and a size bound. It does **not** restore the application's business data. After reload, load domain data through the application's normal persistence, then publish the current context. Restoring a conversation must never re-run an old tool. Treat localStorage as readable by the same origin; leave caching disabled for sensitive pages or follow the application's retention policy.

## Expose WebMCP tools

WebMCP registration is enabled by default when the browser exposes the API. `webmcp={false}` disables it; `webmcp={{ prefix: 'inventory_' }}` namespaces tools when several providers share a document. The default prefix is `pageway_`. Each tool becomes `<prefix><name>`; `<prefix>get_context` returns explicitly registered page context. Reserve `get_context` rather than registering a conflicting business tool.

Read `usePageway().webmcp` for `status`, `registered`, and `error`. The bridge prefers the native `document.modelContext` API and supports the older `navigator.modelContext` surface when available. Unsupported browsers remain usable but cannot offer WebMCP discovery; do not claim that registration works everywhere or install a fake global API as a production fallback.

A WebMCP-only page still mounts the provider, application tools, and overlay, but no chat component or model configuration. External agents need a browser that supports WebMCP; this integration does not create a remotely reachable MCP server. Invocations use Pageway's argument validation, cancellation, animation, locking, and results. Verify registration and cleanup under Strict Mode and route changes.

## Verify the integration

Use deterministic local completion fixtures for routine tests. Never load a developer's paid model environment file during automated validation. If an explicitly authorized live smoke test is useful, use a confirmed free service, limit calls, and stop on the first complete tool-result round trip or provider failure. A mock proves the integration logic, not a real provider connection; report the distinction.

When working in the Pageway repository, `pnpm check:model:frontend` is the opt-in live smoke check for the browser-engine → thin HTTP proxy → free model → page tool → returned result chain. It uses a fixed free Kilo model, reads no `.env` or API keys, and caps requests at three. Provider availability can change; a failed free test is not permission to switch to a paid account. Use the host application's fixtures for routine CI.

Exercise these observable behaviors in the host's existing test setup:

1. A prompt produces a registered tool call, updates real host state, and sends the real result plus fresh context in the following model request.
2. Unknown tools and invalid arguments cannot mutate the application; an async operation can be stopped, releases the page lock, and does not apply a late state update.
3. The target highlight and action timeline are visible; pointer and keyboard input cannot change the page during execution; the stop control remains usable.
4. Reload restores the selected conversation without replaying operations; another account/workspace cannot see it; reset removes it. Denied, expired, or corrupt localStorage does not break chat.
5. WebMCP lists the expected names and fresh context, invokes the same operation without a chat endpoint, and unregisters tools when their route/provider unmounts. Test a real supported browser when available; label fixture-based compatibility tests accurately.
6. Typecheck and build with the host's actual React version. When changing Pageway itself, run its React 18/19 consumer compatibility checks as well.

Summarize the integration points, selected transport, cache behavior, WebMCP availability, and tests actually run. Do not deploy, publish, or switch paid model accounts merely because the integration is complete.
