# @zllling/pageway-react

React tools, page context, conversation UI, and visible agent actions for Pageway.

Import `@zllling/pageway-react/styles.css` and render `PagewayOverlay` inside `PagewayProvider`
to show the agent cursor, action path, and task controls.

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
