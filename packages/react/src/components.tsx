import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { usePageway } from './provider.js';
import type { ActionStep } from './types.js';
import { acquirePageLock } from './page-lock.js';

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 15V5m-4 4 4-4 4 4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusIcon({ status }: { status: ActionStep['status'] }) {
  if (status === 'success')
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="m4 8 2.5 2.5L12 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  if (status === 'error' || status === 'cancelled') return <span aria-hidden="true">×</span>;
  return (
    <span
      className={status === 'running' ? 'pw-status-spinner' : 'pw-status-dot'}
      aria-hidden="true"
    />
  );
}

function json(value: unknown) {
  try {
    return JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    return String(value);
  }
}

export interface PagewayChatProps {
  title?: string;
  suggestions?: string[];
  className?: string;
}

export function PagewayChat({
  title = 'Pageway assistant',
  suggestions = [],
  className = '',
}: PagewayChatProps) {
  const { messages, sendMessage, stop, reset, status, error, tools, actions } = usePageway();
  const [input, setInput] = useState('');
  const conversation = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const busy = status === 'running';
  const visibleMessages = messages.filter(
    (message) => message.role !== 'tool' && (message.content || message.toolCalls?.length),
  );
  const lastAction = actions.at(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Streamed message/status updates change the log height and must scroll its own container.
  useEffect(() => {
    // Keep streamed replies visible without scrolling the host page away from
    // the tool target while the agent is highlighting or updating it.
    const container = conversation.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, status]);
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    void sendMessage(text);
  };
  return (
    <section className={`pw-chat ${className}`} aria-label={title}>
      <header className="pw-chat-header">
        <div className="pw-chat-heading">
          <span className="pw-brand-symbol" aria-hidden="true">
            ↗
          </span>
          <div>
            <h2>{title}</h2>
            <span className="pw-chat-presence">
              <i />
              Connected to your page
            </span>
          </div>
        </div>
        <button
          className="pw-icon-button"
          type="button"
          aria-label="Start a new conversation"
          title="New conversation"
          onClick={() => {
            reset();
            setInput('');
            textarea.current?.focus();
          }}
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M15.5 7A6 6 0 1 0 16 11M15.5 3.5V7H12"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </header>
      <div
        ref={conversation}
        className="pw-chat-messages"
        role="log"
        aria-label="Conversation"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {!visibleMessages.length && (
          <div className="pw-chat-welcome">
            <span className="pw-welcome-mark" aria-hidden="true">
              ✳
            </span>
            <h3>
              A little help.
              <br />A lot less clicking.
            </h3>
            <p>Ask me to explore, organize, or update this page. You stay in the flow.</p>
          </div>
        )}
        {visibleMessages.map((message) => (
          <article key={message.id} className={`pw-message pw-message-${message.role}`}>
            <span className="pw-message-author">{message.role === 'user' ? 'You' : 'Pageway'}</span>
            {message.content && <div className="pw-message-content">{message.content}</div>}
            {!!message.toolCalls?.length && (
              <div className="pw-message-tools">
                {message.toolCalls.map((call) => {
                  const action = actions.find((item) => item.id === call.id);
                  return (
                    <span
                      key={call.id}
                      className={`pw-message-tool pw-is-${action?.status ?? 'planning'}`}
                    >
                      <StatusIcon status={action?.status ?? 'planning'} />
                      {call.function.name.replaceAll('_', ' ')}
                    </span>
                  );
                })}
              </div>
            )}
          </article>
        ))}
        {busy && (
          <div className="pw-thinking" role="status">
            <span className="pw-typing">
              <i />
              <i />
              <i />
            </span>
            {lastAction?.status === 'running'
              ? `Running ${lastAction.name.replaceAll('_', ' ')}…`
              : 'Working with your page…'}
          </div>
        )}
        {error && (
          <div className="pw-chat-error" role="alert">
            <strong>Something interrupted this run.</strong>
            <span>{error}</span>
            <button
              type="button"
              onClick={() => {
                const last = messages.findLast((message) => message.role === 'user');
                if (last?.content) setInput(last.content);
                textarea.current?.focus();
              }}
            >
              Edit and try again ↗
            </button>
          </div>
        )}
      </div>
      {!!suggestions.length && !visibleMessages.length && (
        <fieldset className="pw-suggestions" aria-label="Suggested requests">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={busy}
              onClick={() => {
                void sendMessage(suggestion);
              }}
            >
              <span>{suggestion}</span>
              <span aria-hidden="true">↗</span>
            </button>
          ))}
        </fieldset>
      )}
      <div className="pw-composer-wrap">
        <form className="pw-composer" data-pageway-origin onSubmit={submit}>
          <textarea
            ref={textarea}
            aria-label="Message Pageway"
            placeholder="What would you like to do?"
            value={input}
            rows={2}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="pw-composer-footer">
            <span>
              <i className="pw-capability-dot" />
              {tools.length} page tools available
            </span>
            {busy ? (
              <button
                className="pw-send-button pw-stop-button"
                type="button"
                aria-label="Stop agent"
                title="Stop agent"
                onClick={stop}
              >
                <span />
              </button>
            ) : (
              <button
                className="pw-send-button"
                type="submit"
                aria-label="Send message"
                disabled={!input.trim()}
              >
                <ArrowIcon />
              </button>
            )}
          </div>
        </form>
        <p className="pw-chat-disclaimer">Your intent. Your page. You’re in control.</p>
      </div>
    </section>
  );
}

export function ActionTimeline({ className = '' }: { className?: string }) {
  const { actions, status } = usePageway();
  const completed = actions.filter((action) => action.status === 'success').length;
  return (
    <section className={`pw-timeline ${className}`} aria-label="Agent action timeline">
      <header className="pw-timeline-header">
        <h3>Action trail</h3>
        <span>{status === 'running' ? 'Live' : `${completed} completed`}</span>
      </header>
      {!actions.length ? (
        <div className="pw-timeline-empty">
          <span aria-hidden="true">⌁</span>
          <p>Every step, out in the open.</p>
          <small>Actions will appear here as the agent works.</small>
        </div>
      ) : (
        <ol className="pw-action-list">
          {actions.map((action, index) => (
            <li key={action.id} className={`pw-action pw-is-${action.status}`}>
              <div className="pw-action-marker">
                <StatusIcon status={action.status} />
              </div>
              <details>
                <summary>
                  <span className="pw-action-title">{action.name.replaceAll('_', ' ')}</span>
                  <span className="pw-action-status">
                    {action.status === 'success'
                      ? 'Done'
                      : action.status.charAt(0).toUpperCase() + action.status.slice(1)}
                  </span>
                  <span className="pw-action-chevron" aria-hidden="true">
                    ⌄
                  </span>
                </summary>
                <div className="pw-action-detail">
                  <p>{action.label}</p>
                  <span className="pw-detail-label">Arguments</span>
                  <pre>{json(action.args)}</pre>
                  {action.result !== undefined && (
                    <>
                      <span className="pw-detail-label">Result</span>
                      <pre>{json(action.result)}</pre>
                    </>
                  )}
                  {action.error && <p className="pw-action-error">{action.error}</p>}
                  <small>
                    Step {index + 1}
                    {action.endedAt &&
                      ` · ${((action.endedAt - action.startedAt) / 1000).toFixed(1)}s`}
                  </small>
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function routeBetween(from: { x: number; y: number }, to: { x: number; y: number }, index: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const bend = Math.min(76, length * 0.16) * (index % 2 ? -1 : 1);
  const clamp = (value: number, limit: number) =>
    Math.max(12, Math.min(value, Math.max(12, limit - 12)));
  const width = globalThis.innerWidth || 1200;
  const height = globalThis.innerHeight || 800;
  const control = (progress: number) =>
    `${clamp(from.x + dx * progress - (dy / length) * bend, width)} ${clamp(from.y + dy * progress + (dx / length) * bend, height)}`;
  return `M ${from.x} ${from.y} C ${control(0.32)} ${control(0.68)} ${to.x} ${to.y}`;
}

export interface PagewayOverlayProps {
  /** Disable only when the host application provides its own accessible lock. */
  lockPage?: boolean;
}

export function PagewayOverlay({ lockPage = true }: PagewayOverlayProps = {}) {
  const { spotlight, path, cursor, activity, animationDuration, status, stop, actions } =
    usePageway();
  const dialog = useRef<HTMLDialogElement>(null);
  const stopControl = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  const busy = status === 'running';
  useLayoutEffect(() => {
    if (!busy || !lockPage || !dialog.current || !stopControl.current) return;
    return acquirePageLock(dialog.current, stopControl.current, stop);
  }, [busy, lockPage, stop]);
  if (!busy || typeof document === 'undefined') return null;
  const phase = activity?.phase ?? 'planning';
  const routes = path.slice(1).map((point, index) => ({
    id: `${index}:${path[index].x},${path[index].y}:${point.x},${point.y}`,
    d: routeBetween(path[index], point, index),
  }));
  const activeRoute = routes.at(-1);
  const step = Math.max(1, actions.findIndex((action) => action.id === spotlight?.id) + 1);
  const previousPoint = path.at(-2);
  const tilt = cursor && previousPoint && cursor.x < previousPoint.x ? -1 : 1;
  const cursorStyle = cursor
    ? ({
        left: activeRoute ? 0 : cursor.x,
        top: activeRoute ? 0 : cursor.y,
        ...(activeRoute
          ? {
              offsetPath: `path('${activeRoute.d}')`,
              offsetDistance: '100%',
              offsetRotate: '0deg',
              offsetAnchor: '0px 0px',
            }
          : {}),
        '--pw-cursor-lean': `${tilt * 12}deg`,
        '--pw-cursor-counter-lean': `${tilt * -5}deg`,
      } as CSSProperties)
    : undefined;
  const rect = spotlight?.rect;
  const highlightStyle: CSSProperties | undefined = rect
    ? ({
        left: rect.left - 7,
        top: rect.top - 7,
        width: rect.width + 14,
        height: rect.height + 14,
        '--pw-label-max-width': `${Math.max(100, (globalThis.innerWidth || 1200) - Math.max(0, rect.left) - 20)}px`,
      } as CSSProperties)
    : undefined;
  const phaseTitle =
    phase === 'planning'
      ? 'Pageway is planning'
      : phase === 'moving'
        ? 'Moving to the next action'
        : phase === 'acting'
          ? 'Updating your page'
          : phase === 'success'
            ? 'Step completed'
            : 'Step needs attention';
  const completed = actions.filter((action) => action.status === 'success').length;
  const overlay = (
    <>
      <div className="pw-run-status" role="status" aria-live="polite">
        <span className={`pw-run-indicator pw-run-indicator-${phase}`} aria-hidden="true">
          {phase === 'success' ? '✓' : phase === 'error' ? '!' : <span />}
        </span>
        <div className="pw-run-copy">
          <strong>{phaseTitle}</strong>
          <span id={descriptionId}>
            {activity?.toolName
              ? activity.toolName.replaceAll('_', ' ')
              : 'The page is locked while the agent works.'}
            {completed > 0 ? ` · ${completed} completed` : ''}
          </span>
        </div>
        <button
          ref={stopControl}
          data-pageway-stop
          className="pw-run-stop"
          type="button"
          onClick={stop}
        >
          <span aria-hidden="true">■</span>Stop task<kbd>Esc</kbd>
        </button>
      </div>
      <div className="pw-operation-visuals" aria-hidden="true">
        <svg className="pw-path-svg" aria-hidden="true">
          {routes.slice(0, -1).map((route) => (
            <path
              key={route.id}
              data-pageway-route="history"
              className="pw-route-history"
              d={route.d}
            />
          ))}
          {activeRoute && (
            <g key={activeRoute.id}>
              <path className="pw-route-guide" d={activeRoute.d} />
              <path
                data-pageway-route="active"
                className="pw-route-active"
                d={activeRoute.d}
                pathLength="1"
              />
            </g>
          )}
          {path.slice(0, -1).map(({ x, y }, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Stateless waypoint history retains order; the index disambiguates visits to identical coordinates.
            <g key={`${index}-${x}-${y}`} className="pw-route-waypoint">
              <circle cx={x} cy={y} r="5" />
              <circle cx={x} cy={y} r="1.5" />
            </g>
          ))}
        </svg>
        {spotlight && (
          <div
            key={spotlight.id}
            className="pw-target-highlight"
            style={highlightStyle}
            data-label-placement={rect && rect.top < 55 ? 'inside' : 'above'}
          >
            <span className="pw-focus-corner pw-focus-corner-tl" />
            <span className="pw-focus-corner pw-focus-corner-tr" />
            <span className="pw-focus-corner pw-focus-corner-bl" />
            <span className="pw-focus-corner pw-focus-corner-br" />
            <span className="pw-target-sweep" />
            <span className="pw-target-label">
              <span className="pw-step-marker">{step}</span>
              <span className="pw-target-name">{spotlight.label.replaceAll('_', ' ')}</span>
            </span>
            {phase === 'acting' && <span className="pw-target-click" />}
            {(phase === 'success' || phase === 'error') && (
              <span className={`pw-step-feedback pw-step-feedback-${phase}`}>
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d={phase === 'success' ? 'm5 10 3.5 3.5L15 7' : 'm6 6 8 8m0-8-8 8'} />
                </svg>
                {phase === 'success' ? 'Applied' : 'Needs attention'}
              </span>
            )}
            {phase === 'success' && <span className="pw-success-ring" />}
          </div>
        )}
        {cursor && (
          <div
            key={activeRoute?.id ?? 'origin'}
            className={`pw-agent-cursor${activeRoute ? ' pw-cursor-travel' : ''}`}
            style={cursorStyle}
            data-cursor-side={cursor.x > (globalThis.innerWidth || 1200) - 140 ? 'left' : 'right'}
          >
            <span className="pw-cursor-halo" />
            <span className="pw-cursor-pointer">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path
                  d="m4 3 15 10-7 1-3 6Z"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="pw-cursor-spark">✦</span>
            </span>
            <span className="pw-cursor-name">
              {phase === 'success' ? '✓ Done' : phase === 'acting' ? 'Applying…' : 'Pageway'}
            </span>
          </div>
        )}
      </div>
    </>
  );
  const style = {
    '--pw-travel-duration': `${animationDuration}ms`,
    '--pw-motion-duration': `${phase === 'success' ? Math.min(animationDuration, 360) : animationDuration}ms`,
  } as CSSProperties;
  return createPortal(
    lockPage ? (
      <dialog
        ref={dialog}
        className="pw-overlay pw-operation-dialog"
        style={style}
        data-pageway-lock="true"
        data-pageway-phase={phase}
        aria-label="Pageway is operating the page"
        aria-describedby={descriptionId}
      >
        {overlay}
      </dialog>
    ) : (
      <div
        className="pw-overlay pw-overlay-unlocked"
        style={style}
        data-pageway-lock="false"
        data-pageway-phase={phase}
      >
        {overlay}
      </div>
    ),
    document.body,
  );
}
