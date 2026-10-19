# Changelog

## Unreleased

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
