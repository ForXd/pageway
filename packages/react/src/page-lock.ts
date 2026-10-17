/** Keep the browser's focus/inert semantics, with a fallback for embedded browsers. */
export function acquirePageLock(
  dialog: HTMLDialogElement,
  stopControl: HTMLButtonElement,
  stop: () => void,
): () => void {
  const document = dialog.ownerDocument;
  // Window capture runs before every document/element listener, including
  // document shortcuts that were registered before Pageway mounted. Existing
  // window-capture shortcuts must still opt out while the agent is running.
  const inputBoundary = document.defaultView ?? document;
  const previousFocus = document.activeElement as HTMLElement | null;
  const previousOverflow = document.body.style.overflow;
  const previousRootOverflow = document.documentElement.style.overflow;
  const previousInert = new Map<HTMLElement, boolean>();
  const makeSiblingsInert = () => {
    for (const child of [...document.body.children]) {
      if (child === dialog || child.contains(dialog)) continue;
      const element = child as HTMLElement;
      if (!previousInert.has(element)) previousInert.set(element, element.inert);
      element.inert = true;
    }
  };
  makeSiblingsInert();
  const Observer = document.defaultView?.MutationObserver;
  const observer = Observer ? new Observer(makeSiblingsInert) : null;
  observer?.observe(document.body, { childList: true });
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';

  const cancel = (event: Event) => {
    event.preventDefault();
    stop();
  };
  // Native close events are queued. A Strict Mode cleanup can close and then
  // reopen this dialog before the earlier event reaches its new listener.
  const close = () => {
    if (!dialog.open) stop();
  };
  const keyboard = (event: KeyboardEvent) => {
    // Prevent host-page shortcuts and edits as well as focus escaping the task.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (
      event.key === 'Escape' ||
      ((event.key === 'Enter' || event.key === ' ') && event.target === stopControl)
    )
      stop();
    else if (event.key === 'Tab') stopControl.focus({ preventScroll: true });
  };
  const editing = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const wheel = (event: Event) => {
    event.preventDefault();
  };
  dialog.addEventListener('cancel', cancel);
  dialog.addEventListener('close', close);
  inputBoundary.addEventListener('keydown', keyboard as EventListener, true);
  inputBoundary.addEventListener('beforeinput', editing, true);
  dialog.addEventListener('wheel', wheel, { passive: false });
  dialog.addEventListener('touchmove', wheel, { passive: false });
  if (!dialog.open) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  stopControl.focus({ preventScroll: true });

  let released = false;
  return () => {
    if (released) return;
    released = true;
    observer?.disconnect();
    dialog.removeEventListener('cancel', cancel);
    dialog.removeEventListener('close', close);
    // An explicit capture option also works with older EventTarget implementations
    // that do not normalize the boolean form during listener removal.
    inputBoundary.removeEventListener('keydown', keyboard as EventListener, { capture: true });
    inputBoundary.removeEventListener('beforeinput', editing, { capture: true });
    dialog.removeEventListener('wheel', wheel);
    dialog.removeEventListener('touchmove', wheel);
    for (const [element, wasInert] of previousInert)
      if (element.inert === true) element.inert = wasInert;
    if (document.body.style.overflow === 'hidden') document.body.style.overflow = previousOverflow;
    if (document.documentElement.style.overflow === 'hidden')
      document.documentElement.style.overflow = previousRootOverflow;
    if (dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
}
