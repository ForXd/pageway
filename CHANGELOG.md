# Changelog

## 0.3.0 — 2026-10-24

- Add per-tool enablement and chat/WebMCP source restrictions, enforced both during discovery and immediately before execution.
- Add application-defined, parameter-dependent approval prompts. High-risk calls wait for an explicit, single-use user decision; rejection, cancellation and changed approval details prevent execution.
- Keep the page locked during review while making approval details and decision controls accessible by keyboard. Expose pending approvals and decision methods for custom interfaces, and retain decisions in the action trail and opt-in history without replaying operations.
- Add agent permission controls and an approval-protected delete operation to the playground and public demo, with updated integration documentation.
- Validate policy and approval lifecycles, browser keyboard/focus behavior, and React 18/19 packed consumers before publishing.

## 0.2.1 — 2026-10-19

- Make the WebMCP cancellation contract deterministic on Linux WebKit by holding the executor before mutation while testing the real stop control. Real-time motion remains covered separately.
- Publish the 0.2 feature set after the 0.2.0 candidate was correctly blocked by its browser test gate; no 0.2.0 npm packages were published.

## 0.2.0 — 2026-10-19

- Accept an OpenAI-compatible `apiOrigin`, model and optional completion path directly in the React provider. The browser owns planning, tool execution and result continuation; existing AG-UI endpoints remain supported.
- Add an optional streaming OpenAI credential proxy with a fixed upstream, model allowlist, request limits, timeout and cancellation. Application backends no longer need to implement Pageway's agent protocol.
- Add opt-in localStorage conversation and action history with version validation, expiry, identity isolation and explicit reset. Restoring history never replays tools or restores application business data.
- Expose registered tools and current page context through WebMCP when supported, including pages with no chat backend. External agents share validation, animations, locking and cancellation with chat tasks.
- Add a repository skill for integrating React 18/19 applications, OpenAI and WebMCP-only examples, browser contracts, and a credential-free real-model smoke check.

## 0.1.3 — 2026-10-19

- Support React 18 and 19, starting with React 18.0.0, without requiring consumers to upgrade React.
- Keep exported component declarations compatible with the original React 18 type packages as well as current React 18/19 types.
- Avoid server-side layout Effect warnings on React 18 while preserving synchronous browser registration and page locking.
- Gate publication on isolated React 18.0, 18.2, 18.3, and 19 consumers: strict peer installation and types, SSR, StrictMode tool results and fresh page state, cancellation, and lock cleanup.

- Add the public documentation and interactive demo site at https://forxd.github.io/pageway/, with typechecked React and Agent integration examples.
- Run the actual Agent handler in the browser for a keyless rules demo, including SSE, tool results, visible motion, page locking, and cancellation.
- Allow an optional custom `fetch` transport on `PagewayProvider` without changing the default HTTP behavior.
- Test production site paths, navigation, and demo interactions before deploying to GitHub Pages through Actions.

## 0.1.2 — 2026-10-17

- Wait for npm registry propagation after a successful publication instead of reporting failure after 20 seconds.
- Keep strict artifact integrity checks and safe continuation of interrupted releases.

## 0.1.1 — 2026-10-17

- Release all three packages through GitHub Actions with npm trusted publishing and provenance.
- Document public installation, CI evidence, and the npm trust bootstrap procedure.

## 0.1.0 — 2026-10-17

- Introduce Pageway protocol, Agent, and React SDK packages under `@zllling` with AG-UI streaming and OpenAI-compatible model APIs.
- Register typed page tools and live context, execute browser callbacks, and return results for continued conversation.
- Add curved cursor travel, progressively drawn paths, target focus, step markers, and completion feedback, including reduced motion.
- Lock user interaction during a task with Stop/Escape cancellation and reliable cleanup in StrictMode.
- Add 140 unit/integration/release tests, 20 cross-browser E2E scenarios, coverage gates, and isolated tarball consumer validation.
- Fix stalled async iterable cancellation and Node 24 event-listener cleanup compatibility.
