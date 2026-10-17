# Testing and quality gates

The suite is organized around the public protocol, HTTP handler, React registration/lifecycle API, and browser workflow. Tests use actual serialization, requests, streams, and registered callbacks. A local OpenAI-compatible HTTP fixture replaces only the external model provider; routine tests do not depend on a free provider's availability or spend API quota.

## Commands

| Command                              | Purpose                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `pnpm lint`                          | Biome static and accessibility checks                                                   |
| `pnpm format:check`                  | Prettier formatting gate                                                                |
| `pnpm typecheck`                     | Build declarations and check SDKs, apps, test code, and E2E configuration               |
| `pnpm test:unit` / `pnpm test:watch` | Run or watch Vitest tests                                                               |
| `pnpm test:coverage`                 | Enforce coverage thresholds and write HTML, LCOV, and JSON reports                      |
| `pnpm build`                         | Build all three packages and both example apps                                          |
| `pnpm test:e2e`                      | Run Playwright browser workflows                                                        |
| `pnpm check:pack`                    | Install actual tarballs in an isolated consumer and verify runtime/SSR/CSS/strict types |
| `pnpm check:all`                     | Run all local quality gates                                                             |
| `pnpm release:dry-run`               | Preflight, consumer checks, and npm publish dry-run without uploading                   |
| `pnpm check:model`                   | Optional real-model conversation, function call, and unique result-receipt check        |

Install matching Playwright browsers before the first E2E run. Exact commands, ports, failure traces, and test isolation are documented in [browser integration tests](testing-e2e.md).

## What is covered

- Protocol: arbitrary UTF-8 chunk boundaries, LF/CRLF/CR, multiline events, event IDs, malformed JSON/schema, truncated and oversized frames, reader cleanup, and aborting stalled async iterables.
- Agent HTTP: method/body/content-type limits, input/history/tool schema validation, real HTTP streaming provider calls, secret redaction, provider metadata, continuation with tool results, cancellation, timeout, and deterministic demo behavior.
- React: public hooks and Provider registration/cleanup, latest props and closures, synchronous and asynchronous state updates, multiple tools, error result continuation, task reset/stop/unmount, StrictMode, keyboard/IME composition, retry, and lock cleanup.
- Browser: full conversation and result loop, all six demo tools, latest context after multiple mutations, errors, cancellation, native modal and focus/scroll lock, real cursor motion, reduced motion, and mobile layout.
- Distribution: package names and version alignment, published exports, dependency rewrites, tarball contents/integrity, standalone consumer imports/types, and release rerun behavior.

Vitest covers source implementation, including the Agent entry point, React components, and HTTP application. Type-only files, barrel-only exports, and test code are excluded. Minimum global thresholds are 85% lines/statements/functions and 75% branches; a failed threshold fails CI. Browser motion is verified in Playwright because jsdom cannot establish real layout or native modal behavior.

## CI and evidence

Every push to `main` and pull request runs the reusable validation workflow. Quality checks run on Node 24 and 26; browser tests run in Chromium, Firefox, WebKit, and mobile Chromium. CI uploads coverage, HTML/JUnit browser reports, failure traces/videos, and the three verified npm tarballs. Tagged releases use the same validation before publishing those exact artifacts.

Run unit suites sequentially within the same checkout: concurrent Vitest processes can contend for their shared transform cache. E2E servers use dedicated ports and are not reused across runs. Avoid editing source while a browser matrix runs; Vite hot reload correctly resets application state and would invalidate the in-flight scenario.

The optional external-model check is intentionally separate from deterministic CI. [Verification history](verification.md) records live-provider evidence independently of mocked provider checks.
