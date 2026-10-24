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
  const controls = () =>
    [
      ...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [data-pageway-scroll]'),
    ].filter((element) => element.tabIndex >= 0 && !element.hidden);
  const scrollRegion = (target: EventTarget | null) => {
    const region = (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-pageway-scroll]');
    return region && dialog.contains(region) ? region : null;
  };
  const keyboard = (event: KeyboardEvent) => {
    // Block host shortcuts while explicitly supporting the dialog's controls.
    // Dispatching click ourselves keeps document/window shortcuts from seeing
    // Enter or Space without preventing approval buttons from being activated.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      stop();
      return;
    }
    const available = controls();
    if (event.key === 'Tab') {
      const index = available.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? index <= 0
          ? available.length - 1
          : index - 1
        : (index + 1) % available.length;
      (available[next] ?? stopControl).focus({ preventScroll: true });
      return;
    }
    const target = event.target as HTMLElement | null;
    if (
      (event.key === 'Enter' || event.key === ' ') &&
      target?.tagName === 'BUTTON' &&
      available.includes(target)
    ) {
      if (target === stopControl) stop();
      else target.click();
      return;
    }
    const region = scrollRegion(event.target);
    if (!region) return;
    const distance = Math.max(40, region.clientHeight * 0.8);
    if (event.key === 'ArrowDown') region.scrollTop += 40;
    else if (event.key === 'ArrowUp') region.scrollTop -= 40;
    else if (event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey))
      region.scrollTop += distance;
    else if (event.key === 'PageUp' || (event.key === ' ' && event.shiftKey))
      region.scrollTop -= distance;
    else if (event.key === 'Home') region.scrollTop = 0;
    else if (event.key === 'End') region.scrollTop = region.scrollHeight;
  };
  const editing = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const wheel = (event: Event) => {
    // Arguments can be long; allow scrolling inside the approval card while
    // the host page remains inert and its root scroll containers stay locked.
    if (!scrollRegion(event.target)) event.preventDefault();
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
