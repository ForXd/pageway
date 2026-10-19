# Browser integration tests

The Playwright suite runs the actual playground and HTTP agent. Its only test double is a separate OpenAI-compatible HTTP model provider. It does not mock React hooks, the engine, tool callbacks, AG-UI events, or application state.

```text
Playwright browser → Vite playground :4180
                  → /api/agent proxy → real Node agent :4181
                                    → OpenAI SSE fixture :4182
                  ← AG-UI stream ← standard model adapter
                  → registered page tool → React update
                  → next HTTP run with role:tool + current page context
                  ← model acknowledgment derived from those results
```

## Run locally

Use the repository's pinned pnpm version and a supported Node version, then install the browser binaries that match `@playwright/test`:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps --no-shell chromium firefox webkit
pnpm test:e2e
```

The Chromium projects use Playwright's full Chromium channel in its current headless mode. A separate headless-shell download is unnecessary. `--with-deps` installs required operating-system libraries on Linux; browser installation is needed once per Playwright version.

Useful focused commands:

```sh
pnpm exec playwright test --project=chromium
pnpm exec playwright test tests/e2e/lifecycle.spec.ts --project=chromium
pnpm test:e2e:ui
pnpm test:e2e:report
pnpm exec tsc -p tests/e2e/tsconfig.json
```

Ports 4180, 4181, and 4182 must be free. The runner never reuses existing servers and shuts down the child processes it starts. It leaves a normal development server on 5173/5174 and 3001 alone. The fixture and agent bind only to `127.0.0.1`.

The server environment explicitly sets the local model URL, model name, blank key, frontend endpoint, origins, and an eight-second model timeout. These values take precedence over the root `.env`. Browser requests to external hosts are blocked; the optional Google Fonts import uses system fallbacks. Tests require no model key, external model connection, or paid quota. Installing packages and browser binaries still requires network access.

## Coverage and assertions

| Boundary                      | Behaviors checked                                                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full browser/model round trip | Chunked standard tool arguments; actual browser mutation; matching tool-call/result IDs; `role:tool` continuation; updated page state in the next model request; streamed multilingual reply |
| Multi-step lifecycle          | Two creations in one model response receive distinct IDs through fresh React state; a later `inspect_page` call sees both; three completed actions appear in the trail                       |
| All playground capabilities   | Filter, navigate, inspect and reset in a five-action workflow; current visible IDs and view reach the provider; the event panel retains every run and completed tool event                   |
| Entire-run lock               | Native modal semantics, pointer interception, keyboard editing prevention, focus confinement, scroll lock, stop control, and restored page interaction                                       |
| Cancellation                  | Stop while the model is pending aborts the upstream HTTP stream; Escape during cursor travel prevents mutation; a following request carries a valid cancellation result                      |
| Failure recovery              | HTTP 503 and edit/retry; truncated SSE cannot execute the pending tool; browser tool errors are sent to the model; timeout aborts the provider and unlocks the page                          |
| Conversation reset            | A new thread removes old conversation/actions while retaining workspace changes and publishing the current page context                                                                      |
| Motion                        | Real cursor position changes across frames on a Bézier route; target highlighting and successful feedback; lock remains active through every phase; no horizontal overflow on mobile         |
| Reduced motion                | No running cursor animations or travel phase; static completion feedback remains visible; the identical tool/result lifecycle still completes                                                |

Chromium runs all scenarios. Firefox and WebKit run the full round-trip and multi-step contracts. Mobile Chromium runs those contracts plus normal and reduced-motion behavior using a touch-enabled Pixel viewport. Each test gets a fresh browser context and unique fixture session, so parallel workers do not share application state or model history.

The model fixture chooses scripted scenarios from the test prompt, but its final acknowledgment is built from the received tool results and current context. A stale context or missing result produces an error response, not a canned successful acknowledgment. The test inspects the actual model HTTP requests as an independent assertion. These tests establish integration correctness, not real-model reasoning quality or the availability of a free provider; `pnpm check:model` is the separate opt-in live-provider check.

## Frontend API, cache, and WebMCP boundaries

The frontend OpenAI entry uses `apiOrigin` with the same local model fixture
through the ordinary proxy. Assertions inspect standard completion requests and
tool-result continuation rather than relying on an AG-UI HTTP endpoint. Session
scenarios exercise localStorage restoration without replaying page operations,
and clear/reset behavior. A restored chat is not restored business data.

WebMCP-only scenarios omit chat and model endpoints, register the actual page
tools, and drive them through a test implementation of the browser API. This
checks discovery metadata, fresh context, shared execution, lock/cancellation,
and removal; it does not prove native availability in a user's browser. Public
site checks verify the static WebMCP entry without making model HTTP requests.
Actual browser support is reported separately in [verification](verification.md).

Use `pnpm check:model:frontend` for the separate real anonymous model round trip;
it runs the frontend engine in Node over real HTTP and never reads a paid key.

## Reports and debugging

`playwright-report/` contains the HTML report. `test-results/e2e-junit.xml` is the CI-friendly JUnit report. Failed tests retain a trace, screenshot, video, and error context under `test-results/e2e/`; motion tests also attach sampled positions and phases and save moving/success screenshots. These generated directories are ignored by Git and uploaded by CI for diagnosis.

```sh
pnpm exec playwright show-trace test-results/e2e/<failed-test>/trace.zip
```

Assertions wait for observable UI/network conditions rather than sleeping for an assumed rendering duration. A test has a 45-second limit, an assertion a 15-second limit, an action an eight-second limit, and navigation a 15-second limit. CI retries a failure once and still identifies flaky results in its report; local runs do not retry. Do not repair regressions by deleting assertions or enabling server reuse against a developer's live model.
