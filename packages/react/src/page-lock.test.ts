import { describe, expect, it, vi } from 'vitest';
import { acquirePageLock } from './page-lock.js';

class ElementStub extends EventTarget {
  inert = false;
  isConnected = true;
  open = false;
  style = { overflow: '' };
  children: ElementStub[] = [];
  ownerDocument!: DocumentStub;
  contains = (element: ElementStub): boolean => this.children.includes(element);
  focus = vi.fn(() => {
    this.ownerDocument.activeElement = this;
  });
  showModal: (() => void) | undefined = vi.fn(() => {
    this.open = true;
  });
  close: (() => void) | undefined = vi.fn(() => {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  });
  setAttribute = vi.fn((name: string) => {
    if (name === 'open') this.open = true;
  });
  removeAttribute = vi.fn((name: string) => {
    if (name === 'open') this.open = false;
  });
}
class DocumentStub extends EventTarget {
  body = new ElementStub();
  documentElement = new ElementStub();
  activeElement = new ElementStub();
  defaultView: EventTarget | undefined = undefined;
}
function setup(
  fallback = false,
  view?: EventTarget,
  beforeLock?: (document: DocumentStub) => void,
) {
  const document = new DocumentStub();
  document.defaultView = view;
  const page = new ElementStub();
  const alreadyInert = new ElementStub();
  alreadyInert.inert = true;
  const dialog = new ElementStub();
  const stopButton = new ElementStub();
  const priorFocus = document.activeElement;
  for (const element of [page, alreadyInert, dialog, stopButton, priorFocus])
    element.ownerDocument = document;
  document.body.children = [page, alreadyInert, dialog];
  document.body.style.overflow = 'auto';
  document.documentElement.style.overflow = 'scroll';
  if (fallback) {
    dialog.showModal = undefined;
    dialog.close = undefined;
  }
  beforeLock?.(document);
  const stop = vi.fn();
  const release = acquirePageLock(
    dialog as unknown as HTMLDialogElement,
    stopButton as unknown as HTMLButtonElement,
    stop,
  );
  return { document, page, alreadyInert, dialog, stopButton, priorFocus, stop, release };
}
function key(value: string) {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperty(event, 'key', { value });
  return event;
}

describe('page interaction lock', () => {
  it('makes host content inert, locks user scrolling, and leaves Stop focused in a modal', () => {
    const context = setup();
    expect(context.dialog.showModal).toHaveBeenCalledOnce();
    expect(context.dialog.open).toBe(true);
    expect(context.page.inert).toBe(true);
    expect(context.dialog.inert).toBe(false);
    expect(context.document.body.style.overflow).toBe('hidden');
    expect(context.document.documentElement.style.overflow).toBe('hidden');
    expect(context.document.activeElement).toBe(context.stopButton);
    context.release();
  });

  it('blocks editing and host shortcuts, traps Tab, and cancels with Escape', () => {
    const context = setup();
    const hostShortcut = vi.fn();
    context.document.addEventListener('keydown', hostShortcut);
    const typing = key('a');
    context.document.dispatchEvent(typing);
    expect(typing.defaultPrevented).toBe(true);
    expect(hostShortcut).not.toHaveBeenCalled();
    const input = new Event('beforeinput', { cancelable: true });
    context.document.dispatchEvent(input);
    expect(input.defaultPrevented).toBe(true);
    context.document.dispatchEvent(key('Tab'));
    expect(context.stopButton.focus).toHaveBeenCalledTimes(2);
    context.document.dispatchEvent(key('Escape'));
    expect(context.stop).toHaveBeenCalledOnce();
    context.release();
  });

  it('restores original inert state, scrolling, and focus and removes listeners on completion/unmount', () => {
    const context = setup();
    context.release();
    context.release();
    expect(context.dialog.open).toBe(false);
    expect(context.page.inert).toBe(false);
    expect(context.alreadyInert.inert).toBe(true);
    expect(context.document.body.style.overflow).toBe('auto');
    expect(context.document.documentElement.style.overflow).toBe('scroll');
    expect(context.priorFocus.focus).toHaveBeenCalledOnce();
    const afterRelease = key('Escape');
    context.document.dispatchEvent(afterRelease);
    expect(afterRelease.defaultPrevented).toBe(false);
    expect(context.stop).not.toHaveBeenCalled();
  });

  it('preserves external overflow changes while a task runs', () => {
    const context = setup();
    context.document.body.style.overflow = 'clip';
    context.release();
    expect(context.document.body.style.overflow).toBe('clip');
  });

  it('provides inert/focus/keyboard protection when native showModal is unavailable', () => {
    const context = setup(true);
    expect(context.dialog.open).toBe(true);
    expect(context.page.inert).toBe(true);
    const cancellation = new Event('cancel', { cancelable: true });
    context.dialog.dispatchEvent(cancellation);
    expect(cancellation.defaultPrevented).toBe(true);
    expect(context.stop).toHaveBeenCalledOnce();
    context.release();
    expect(context.dialog.open).toBe(false);
    expect(context.page.inert).toBe(false);
  });

  it('captures at window before pre-existing document capture shortcuts and editing listeners', () => {
    const view = new EventTarget();
    const windowRegistration = vi.spyOn(view, 'addEventListener');
    const shortcut = vi.fn();
    const edit = vi.fn();
    const context = setup(false, view, (document) => {
      document.addEventListener('keydown', shortcut, true);
      document.addEventListener('beforeinput', edit, true);
    });
    // Model the browser's capture route: window precedes document regardless of
    // registration time. A stopped event must never reach the document target.
    const dispatchFromPage = (event: Event) => {
      let stopped = false;
      const originalStop = event.stopImmediatePropagation.bind(event);
      event.stopImmediatePropagation = () => {
        stopped = true;
        originalStop();
      };
      view.dispatchEvent(event);
      if (!stopped) context.document.dispatchEvent(event);
    };
    expect(windowRegistration).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(windowRegistration).toHaveBeenCalledWith('beforeinput', expect.any(Function), true);
    const typing = key('n');
    dispatchFromPage(typing);
    dispatchFromPage(new Event('beforeinput', { cancelable: true }));
    expect(typing.defaultPrevented).toBe(true);
    expect(shortcut).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
    dispatchFromPage(key('Escape'));
    expect(context.stop).toHaveBeenCalledOnce();
    context.release();
    dispatchFromPage(key('n'));
    dispatchFromPage(new Event('beforeinput', { cancelable: true }));
    expect(shortcut).toHaveBeenCalledOnce();
    expect(edit).toHaveBeenCalledOnce();
  });
});
