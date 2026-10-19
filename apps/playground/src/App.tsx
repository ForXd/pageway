import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PagewayProvider,
  PagewayChat,
  PagewayOverlay,
  ActionTimeline,
  usePageContext,
  usePageTool,
  usePageway,
} from '@zllling/pageway-react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  ExternalLink,
  FileCode2,
  Flag,
  FolderOpen,
  Layers,
  LayoutDashboard,
  List,
  MessageSquare,
  Plus,
  Radio,
  RotateCcw,
  Route,
  Search,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Workflow,
  X,
} from 'lucide-react';

type Status = 'todo' | 'in_progress' | 'done';
type Priority = 'high' | 'medium' | 'low';
type Task = {
  id: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  assignee: string;
  tag: string;
  date: string;
};
const initialTasks: Task[] = [
  {
    id: 'PW-101',
    title: 'Design the new landing page',
    description: 'Bring the new visual direction to life.',
    status: 'todo',
    priority: 'high',
    assignee: 'Alex',
    tag: 'Design',
    date: 'Oct 21',
  },
  {
    id: 'PW-102',
    title: 'Write onboarding copy',
    description: 'A warm welcome, from the very first click.',
    status: 'todo',
    priority: 'medium',
    assignee: 'Sam',
    tag: 'Content',
    date: 'Oct 22',
  },
  {
    id: 'PW-103',
    title: 'Connect the agent API',
    description: 'Wire up streaming responses and page tools.',
    status: 'in_progress',
    priority: 'high',
    assignee: 'Jamie',
    tag: 'Engineering',
    date: 'Oct 19',
  },
  {
    id: 'PW-104',
    title: 'Build the component library',
    description: 'Small pieces. A consistent experience.',
    status: 'in_progress',
    priority: 'medium',
    assignee: 'Alex',
    tag: 'Design',
    date: 'Oct 23',
  },
  {
    id: 'PW-105',
    title: 'Review accessibility',
    description: 'Make every interaction work for everyone.',
    status: 'todo',
    priority: 'low',
    assignee: 'Jamie',
    tag: 'Engineering',
    date: 'Oct 24',
  },
  {
    id: 'PW-106',
    title: 'Set up the workspace',
    description: 'The foundation for something good.',
    status: 'done',
    priority: 'high',
    assignee: 'Sam',
    tag: 'Engineering',
    date: 'Oct 17',
  },
  {
    id: 'PW-107',
    title: 'Map the user journey',
    description: 'Connect the dots from discovery to delight.',
    status: 'done',
    priority: 'medium',
    assignee: 'Alex',
    tag: 'Research',
    date: 'Oct 17',
  },
  {
    id: 'PW-108',
    title: 'Add interaction animations',
    description: 'A little motion that makes things clearer.',
    status: 'in_progress',
    priority: 'low',
    assignee: 'Sam',
    tag: 'Design',
    date: 'Oct 25',
  },
];
const statuses: { id: Status; title: string; color: string }[] = [
  { id: 'todo', title: 'To do', color: '#8b91a1' },
  { id: 'in_progress', title: 'In progress', color: '#d89438' },
  { id: 'done', title: 'Done', color: '#348d73' },
];
const toolNames = [
  'filter_tasks',
  'update_task',
  'create_task',
  'inspect_page',
  'reset_filters',
  'navigate_view',
];
const descriptions: Record<string, string> = {
  filter_tasks: 'Filter tasks by priority, status, or a search query.',
  update_task: 'Update a task’s status or priority using its ID.',
  create_task: 'Create a new task in this workspace.',
  inspect_page: 'Read the current workspace, tasks, and filters.',
  reset_filters: 'Clear all filters and reveal every task.',
  navigate_view: 'Switch between the board and list views.',
};
const suggestions = ['Show high priority tasks', 'Mark PW-103 as done', 'Switch to list view'];
const statusSchema = { type: 'string', enum: ['todo', 'in_progress', 'done'] };
const prioritySchema = { type: 'string', enum: ['high', 'medium', 'low'] };
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

interface AppProps {
  endpoint?: string;
  apiOrigin?: string;
  apiPath?: string;
  model?: string;
  storageKey?: string;
  fetch?: typeof globalThis.fetch;
  browserDemo?: boolean;
  webmcpOnly?: boolean;
}

export default function App({
  endpoint,
  apiOrigin,
  apiPath,
  model,
  storageKey,
  fetch: fetcher,
  browserDemo = false,
  webmcpOnly = false,
}: AppProps) {
  const transport = apiOrigin
    ? { apiOrigin, apiPath, model }
    : webmcpOnly
      ? {}
      : { endpoint: endpoint ?? (import.meta.env.VITE_AGENT_ENDPOINT || '/api/agent') };
  return (
    <PagewayProvider {...transport} storageKey={storageKey} fetch={fetcher} animationDuration={900}>
      <Workspace
        browserDemo={browserDemo}
        webmcpOnly={webmcpOnly}
        apiOrigin={apiOrigin}
        model={model}
      />
      <PagewayOverlay />
    </PagewayProvider>
  );
}

function Workspace({
  browserDemo,
  webmcpOnly,
  apiOrigin,
  model,
}: {
  browserDemo: boolean;
  webmcpOnly: boolean;
  apiOrigin?: string;
  model?: string;
}) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [filters, setFilters] = useState({ status: 'all', priority: 'all', query: '' });
  const [view, setView] = useState<'board' | 'list'>('board');
  const [tab, setTab] = useState<'workspace' | 'tools' | 'events' | 'integration'>('workspace');
  const [showCreate, setShowCreate] = useState(false);
  const createDialog = useRef<HTMLDialogElement>(null);
  const eventIds = useRef(new WeakMap<object, string>());
  function eventKey(event: object) {
    let key = eventIds.current.get(event);
    if (!key) {
      key = crypto.randomUUID();
      eventIds.current.set(event, key);
    }
    return key;
  }
  useEffect(() => {
    const dialog = createDialog.current;
    if (!showCreate || !dialog) return;
    const previousFocus = document.activeElement;
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>('input[name="task-title"]')?.focus();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [showCreate]);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<Priority>('medium');
  const [newStatus, setNewStatus] = useState<Status>('todo');
  const [health, setHealth] = useState<{
    mode?: string;
    model?: string;
    status?: string;
    provider?: string;
  } | null>(
    browserDemo
      ? { mode: 'demo', provider: 'browser', status: 'ready' }
      : apiOrigin
        ? { mode: 'openai', provider: apiOrigin, model, status: 'ready' }
        : null,
  );
  const [copied, setCopied] = useState(false);
  const [chatVisible, setChatVisible] = useState(!webmcpOnly);
  const agent = usePageway();
  const visibleTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          (filters.status === 'all' || task.status === filters.status) &&
          (filters.priority === 'all' || task.priority === filters.priority) &&
          `${task.id} ${task.title}`.toLowerCase().includes(filters.query.toLowerCase()),
      ),
    [tasks, filters],
  );
  useEffect(() => {
    if (browserDemo || apiOrigin || webmcpOnly) return;
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setHealth)
      .catch(() => setHealth({ status: 'offline' }));
  }, [browserDemo, apiOrigin, webmcpOnly]);
  usePageContext({
    id: 'workspace',
    title: 'Website relaunch workspace',
    description:
      'A live task board. Task IDs are stable. Status values: todo, in_progress, done. Priority values: high, medium, low.',
    data: { tasks, filters, view, visibleTaskIds: visibleTasks.map((t) => t.id) },
  });
  usePageTool<{ status?: string; priority?: string; query?: string }>({
    name: 'filter_tasks',
    description: descriptions.filter_tasks,
    parameters: schema({
      status: { type: 'string', enum: ['all', 'todo', 'in_progress', 'done'] },
      priority: { type: 'string', enum: ['all', 'high', 'medium', 'low'] },
      query: { type: 'string', maxLength: 200 },
    }),
    target: '#task-filters',
    execute: (args) => {
      setTab('workspace');
      const next = { ...filters, ...args };
      setFilters(next);
      return {
        filters: next,
        matchingTasks: tasks.filter(
          (t) =>
            (next.status === 'all' || t.status === next.status) &&
            (next.priority === 'all' || t.priority === next.priority) &&
            `${t.id} ${t.title}`.toLowerCase().includes(next.query.toLowerCase()),
        ),
      };
    },
  });
  usePageTool<{ id: string; status?: Status; priority?: Priority }>({
    name: 'update_task',
    description: descriptions.update_task,
    parameters: schema({ id: { type: 'string' }, status: statusSchema, priority: prioritySchema }, [
      'id',
    ]),
    target: (args) => document.getElementById(`task-${args.id}`),
    execute: (args) => {
      const task = tasks.find((t) => t.id === args.id);
      if (!task) throw new Error(`Task ${args.id} does not exist.`);
      if (!args.status && !args.priority)
        throw new Error('Provide a status or priority to change.');
      const updated = { ...task, ...args };
      setTasks((current) => current.map((t) => (t.id === args.id ? updated : t)));
      setTab('workspace');
      return { task: updated };
    },
  });
  usePageTool<{ title: string; priority?: Priority }>({
    name: 'create_task',
    description: descriptions.create_task,
    parameters: schema(
      { title: { type: 'string', minLength: 1, maxLength: 120 }, priority: prioritySchema },
      ['title'],
    ),
    target: '#new-task-button',
    execute: (args) => {
      const task = addTask(args.title, args.priority || 'medium');
      setTab('workspace');
      return { task };
    },
  });
  usePageTool<Record<string, never>>({
    name: 'inspect_page',
    description: descriptions.inspect_page,
    parameters: schema({}),
    target: '#workspace-heading',
    execute: () => ({ tasks, filters, view, visibleTaskIds: visibleTasks.map((t) => t.id) }),
  });
  usePageTool<Record<string, never>>({
    name: 'reset_filters',
    description: descriptions.reset_filters,
    parameters: schema({}),
    target: '#task-filters',
    execute: () => {
      setFilters({ status: 'all', priority: 'all', query: '' });
      setTab('workspace');
      return { visibleTasks: tasks.length };
    },
  });
  usePageTool<{ view: 'board' | 'list' }>({
    name: 'navigate_view',
    description: descriptions.navigate_view,
    parameters: schema({ view: { type: 'string', enum: ['board', 'list'] } }, ['view']),
    target: '#view-switch',
    execute: (args) => {
      setView(args.view);
      setTab('workspace');
      return { view: args.view };
    },
  });
  function addTask(title: string, priority: Priority, status: Status = 'todo') {
    if (!title.trim()) throw new Error('Task title cannot be empty.');
    const max = Math.max(100, ...tasks.map((t) => Number(t.id.split('-')[1])));
    const task: Task = {
      id: `PW-${max + 1}`,
      title: title.trim(),
      description: 'Created in your Pageway workspace.',
      status,
      priority,
      assignee: 'You',
      tag: 'Planning',
      date: 'Just now',
    };
    setTasks((current) => [...current, task]);
    return task;
  }
  function resetDemo() {
    agent.reset();
    setTasks(initialTasks);
    setFilters({ status: 'all', priority: 'all', query: '' });
    setView('board');
    setTab('workspace');
  }
  const busy = agent.status === 'running';
  const online = webmcpOnly
    ? agent.webmcp.status === 'ready'
    : health && health.status !== 'offline';
  const isLive = health?.mode === 'openai';
  const providerEvent = [...agent.events]
    .reverse()
    .find(
      (event) =>
        event.type === 'CUSTOM' &&
        event.name === 'pageway.provider' &&
        event.value &&
        typeof event.value === 'object' &&
        typeof (event.value as { model?: unknown }).model === 'string',
    );
  const providerInfo = providerEvent?.value as
    { model?: string; requestedModel?: string; fallback?: boolean } | undefined;
  const displayModel = providerInfo?.model || health?.model;
  const gatewayName = health?.provider?.includes('kilo.ai')
    ? 'Kilo Gateway'
    : health?.provider?.includes('blockrun.ai')
      ? 'BlockRun'
      : 'Model API';
  const providerExample = webmcpOnly
    ? '<PagewayProvider webmcp>'
    : apiOrigin
      ? '<PagewayProvider apiOrigin="/api/openai" model="your-model"\n  storageKey="pageway:current-user:workspace">'
      : '<PagewayProvider endpoint="/api/agent">';
  const snippet = `import { PagewayProvider, PagewayChat,\n  PagewayOverlay, usePageTool } from '@zllling/pageway-react';\nimport '@zllling/pageway-react/styles.css';\n\n${providerExample}\n  <YourApp />${webmcpOnly ? '' : '\n  <PagewayChat />'}\n  <PagewayOverlay />\n</PagewayProvider>`;
  return (
    <div className={`app-shell ${chatVisible ? '' : 'chat-hidden'}`}>
      <aside className="sidebar">
        <button
          type="button"
          className="brand"
          aria-label="Pageway playground"
          onClick={() => setTab('workspace')}
        >
          <span className="brand-icon">
            <Route size={21} strokeWidth={2.4} />
          </span>
          pageway<span className="brand-period">.</span>
        </button>
        <button type="button" className="workspace-picker" onClick={() => setTab('workspace')}>
          <span className="workspace-avatar">P</span>
          <span>
            Personal workspace
            <small>
              {webmcpOnly
                ? 'WebMCP workspace'
                : browserDemo
                  ? 'Browser demo'
                  : 'Developer playground'}
            </small>
          </span>
          <ChevronDown size={14} />
        </button>
        <span className="nav-label">BUILD</span>
        <nav>
          <button
            type="button"
            className={tab === 'workspace' ? 'active' : ''}
            onClick={() => setTab('workspace')}
          >
            <LayoutDashboard size={17} />
            Playground
            <span className="nav-dot" />
          </button>
          <button
            type="button"
            className={tab === 'tools' ? 'active' : ''}
            onClick={() => setTab('tools')}
          >
            <Workflow size={17} />
            Tool registry<span className="nav-count">6</span>
          </button>
          <button
            type="button"
            className={tab === 'events' ? 'active' : ''}
            onClick={() => setTab('events')}
          >
            <Radio size={17} />
            Event stream
          </button>
          <button
            type="button"
            className={tab === 'integration' ? 'active' : ''}
            onClick={() => setTab('integration')}
          >
            <Code2 size={17} />
            Integration
          </button>
        </nav>
        <div className="sidebar-guide">
          <div className="guide-icon">
            <Sparkles size={18} />
          </div>
          <strong>A little less clicking.</strong>
          <p>
            {webmcpOnly
              ? 'External browser agents can use this page’s registered tools without an agent server.'
              : 'Let your agent take it from here. Your interface already knows how.'}
          </p>
          <button
            type="button"
            onClick={() => {
              if (webmcpOnly) {
                setTab('tools');
                return;
              }
              setChatVisible(true);
              void agent.sendMessage('Show high priority tasks');
            }}
          >
            {webmcpOnly ? 'Explore page tools' : 'Try your first action'} <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="sidebar-bottom">
          {browserDemo && (
            <a href="../" target="_top">
              <ArrowUpRight size={16} />
              Pageway documentation
            </a>
          )}
          <a href="https://docs.ag-ui.com" target="_blank" rel="noreferrer">
            <FileCode2 size={16} />
            AG-UI documentation
            <ExternalLink size={12} />
          </a>
          <button type="button" onClick={() => setTab('integration')}>
            <Terminal size={16} />
            Quickstart
            <ChevronRight size={14} />
          </button>
          <div className="profile">
            <span className="avatar avatar-you">Y</span>
            <span>
              Your workspace
              <small>{browserDemo ? 'Changes stay in this tab' : 'Local development'}</small>
            </span>
            <span className="version">v0.1</span>
          </div>
        </div>
      </aside>
      <header className="topbar">
        <div className="breadcrumb">
          <Layers size={17} />
          <span>Workspace</span>
          <ChevronRight size={13} />
          <strong>
            {tab === 'workspace'
              ? 'Playground'
              : tab === 'tools'
                ? 'Tool registry'
                : tab === 'events'
                  ? 'Event stream'
                  : 'Integration'}
          </strong>
        </div>
        <div className="topbar-right">
          <span className={`connection ${online ? '' : 'offline'}`}>
            <i />
            {webmcpOnly
              ? agent.webmcp.status === 'ready'
                ? 'WebMCP tools ready'
                : agent.webmcp.status === 'unsupported'
                  ? 'WebMCP unavailable'
                  : `WebMCP ${agent.webmcp.status}`
              : apiOrigin
                ? 'OpenAI endpoint configured'
                : browserDemo
                  ? 'Browser demo ready'
                  : online
                    ? 'Agent connected'
                    : health
                      ? 'Agent offline'
                      : 'Connecting'}
          </span>
          <span className="topbar-divider" />
          {!webmcpOnly && (
            <button
              type="button"
              className="icon-button"
              title={chatVisible ? 'Hide agent panel' : 'Show agent panel'}
              aria-label={chatVisible ? 'Hide agent panel' : 'Show agent panel'}
              onClick={() => setChatVisible(!chatVisible)}
            >
              <MessageSquare size={18} />
            </button>
          )}
          <span className="avatar avatar-you">Y</span>
        </div>
      </header>
      <main className="main-content">
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              <span /> THE AGENT-READY INTERFACE
            </div>
            <h1>
              {tab === 'workspace'
                ? 'Less clicking. More doing.'
                : tab === 'tools'
                  ? 'Small tools. Real capabilities.'
                  : tab === 'events'
                    ? 'Every action, in the open.'
                    : 'Your app. With an agent.'}
            </h1>
            <p>
              {tab === 'workspace'
                ? webmcpOnly
                  ? 'Registered tools, shared page animations, and external agents. No chat endpoint required.'
                  : 'A real workspace. A conversational copilot. Try what happens next.'
                : tab === 'tools'
                  ? 'Explicit, typed capabilities your agent can use on this page.'
                  : tab === 'events'
                    ? 'Follow the conversation from intent to a completed page action.'
                    : 'Add Pageway to an existing React app in a few small steps.'}
            </p>
          </div>
          <span className="playground-badge">
            <span />
            LIVE PLAYGROUND
          </span>
        </div>
        <div className="capability-strip">
          <span>
            <Bot size={16} />
            <b
              title={
                webmcpOnly
                  ? 'Browser WebMCP API availability'
                  : isLive
                    ? `${gatewayName} · ${displayModel}${providerInfo?.fallback ? ' (free pool fallback)' : ''}`
                    : 'Local deterministic planner'
              }
            >
              {webmcpOnly ? 'External browser agents' : isLive ? displayModel : 'Demo agent'}
            </b>
            <span className="strip-tag">
              {webmcpOnly ? 'NO BACKEND' : isLive ? 'LIVE API' : 'NO KEY NEEDED'}
            </span>
          </span>
          <span>
            <Workflow size={15} />6 page tools
          </span>
          <span>
            <Radio size={15} />
            {webmcpOnly
              ? `${agent.webmcp.registered.length} WebMCP tools`
              : apiOrigin
                ? 'OpenAI Chat Completions'
                : 'AG-UI protocol'}
          </span>
          <button type="button" disabled={busy} onClick={resetDemo}>
            <RotateCcw size={14} />
            Reset demo
          </button>
        </div>
        {webmcpOnly && agent.webmcp.status !== 'ready' && (
          <p role="status" className="registry-note">
            {agent.webmcp.status === 'unsupported'
              ? 'This browser does not expose WebMCP. Open this page in a compatible browser to let an external agent discover and invoke its tools.'
              : (agent.webmcp.error ?? 'Registering page tools with the browser…')}
          </p>
        )}
        {tab === 'workspace' && (
          <>
            <section className="project-section">
              <div className="project-title">
                <div className="project-icon">
                  <FolderOpen size={21} />
                </div>
                <div>
                  <h2 id="workspace-heading">
                    Website relaunch <span className="project-private">Workspace</span>
                  </h2>
                  <p>A fresh start for the next chapter.</p>
                </div>
                <div className="team">
                  <span className="avatar avatar-alex">A</span>
                  <span className="avatar avatar-sam">S</span>
                  <span className="avatar avatar-jamie">J</span>
                  <span className="team-count">3 members</span>
                </div>
              </div>
              <div className="workspace-tabs">
                <button type="button" className="selected">
                  <LayoutDashboard size={15} />
                  Tasks <span>{tasks.length}</span>
                </button>
                <div className="workspace-meta">
                  <span>
                    <i />
                    {tasks.filter((t) => t.status === 'done').length} completed
                  </span>
                  <div className="progress-track">
                    <div
                      style={{
                        width: `${(tasks.filter((t) => t.status === 'done').length / tasks.length) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="board-toolbar">
                <div id="task-filters" className="filters">
                  <label className="search-field">
                    <Search size={15} />
                    <input
                      aria-label="Search tasks"
                      value={filters.query}
                      onChange={(e) => setFilters({ ...filters, query: e.target.value })}
                      placeholder="Search tasks…"
                    />
                    <kbd>⌕</kbd>
                  </label>
                  <label className="filter-select">
                    <SlidersHorizontal size={14} />
                    <select
                      aria-label="Priority filter"
                      value={filters.priority}
                      onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
                    >
                      <option value="all">Priority</option>
                      <option value="high">High priority</option>
                      <option value="medium">Medium priority</option>
                      <option value="low">Low priority</option>
                    </select>
                    <ChevronDown size={12} />
                  </label>
                  <label className="filter-select status-filter">
                    <select
                      aria-label="Status filter"
                      value={filters.status}
                      onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                    >
                      <option value="all">Status</option>
                      <option value="todo">To do</option>
                      <option value="in_progress">In progress</option>
                      <option value="done">Done</option>
                    </select>
                    <ChevronDown size={12} />
                  </label>
                  {(filters.priority !== 'all' || filters.status !== 'all' || filters.query) && (
                    <button
                      type="button"
                      className="clear-filters"
                      title="Clear filters"
                      aria-label="Clear filters"
                      onClick={() => setFilters({ status: 'all', priority: 'all', query: '' })}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="board-controls">
                  <div className="view-switch" id="view-switch">
                    <button
                      type="button"
                      className={view === 'board' ? 'selected' : ''}
                      aria-label="Board view"
                      aria-pressed={view === 'board'}
                      onClick={() => setView('board')}
                    >
                      <LayoutDashboard size={15} />
                    </button>
                    <button
                      type="button"
                      className={view === 'list' ? 'selected' : ''}
                      aria-label="List view"
                      aria-pressed={view === 'list'}
                      onClick={() => setView('list')}
                    >
                      <List size={17} />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    id="new-task-button"
                    onClick={() => {
                      setNewStatus('todo');
                      setShowCreate(true);
                    }}
                  >
                    <Plus size={15} />
                    New task
                  </button>
                </div>
              </div>
              {view === 'board' ? (
                <div className="kanban">
                  {statuses.map((status) => (
                    <section className={`kanban-column column-${status.id}`} key={status.id}>
                      <header>
                        <span className="column-title">
                          <span className="status-marker" style={{ background: status.color }} />
                          {status.title}
                          <span>{visibleTasks.filter((t) => t.status === status.id).length}</span>
                        </span>
                        <button
                          type="button"
                          title={`Add ${status.title} task`}
                          aria-label={`Add ${status.title} task`}
                          onClick={() => {
                            setNewStatus(status.id);
                            setShowCreate(true);
                          }}
                        >
                          <Plus size={15} />
                        </button>
                      </header>
                      <div className="column-cards">
                        {visibleTasks
                          .filter((t) => t.status === status.id)
                          .map((task) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              onStatus={(status) =>
                                setTasks((current) =>
                                  current.map((t) => (t.id === task.id ? { ...t, status } : t)),
                                )
                              }
                            />
                          ))}
                      </div>
                      <button
                        type="button"
                        className="add-task"
                        onClick={() => {
                          setNewStatus(status.id);
                          setShowCreate(true);
                        }}
                      >
                        <Plus size={14} />
                        Add task
                      </button>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="task-list">
                  <div className="list-head">
                    <span>Task</span>
                    <span>Status</span>
                    <span>Priority</span>
                    <span>Assignee</span>
                  </div>
                  {visibleTasks.map((task) => (
                    <div className="task-row" id={`task-${task.id}`} key={task.id}>
                      <div>
                        <small>{task.id}</small>
                        <strong>{task.title}</strong>
                      </div>
                      <select
                        aria-label={`${task.id} status`}
                        value={task.status}
                        onChange={(e) =>
                          setTasks((current) =>
                            current.map((t) =>
                              t.id === task.id ? { ...t, status: e.target.value as Status } : t,
                            ),
                          )
                        }
                      >
                        {statuses.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title}
                          </option>
                        ))}
                      </select>
                      <span className={`priority priority-${task.priority}`}>
                        <Flag size={11} />
                        {task.priority}
                      </span>
                      <span className={`avatar avatar-${task.assignee.toLowerCase()}`}>
                        {task.assignee[0]}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {visibleTasks.length === 0 && (
                <div className="empty-state">
                  <Search size={25} />
                  <h3>No matching tasks</h3>
                  <p>Try a different filter or ask the agent to reset the view.</p>
                  <button
                    type="button"
                    onClick={() => setFilters({ status: 'all', priority: 'all', query: '' })}
                  >
                    Clear filters
                  </button>
                </div>
              )}
              <footer className="board-footer">
                <span>
                  Showing {visibleTasks.length} of {tasks.length} tasks
                </span>
                <span>
                  <span className="little-dot" />
                  Changes happen live in your browser
                </span>
              </footer>
            </section>
            <div className="try-banner">
              <span className="try-icon">
                <Sparkles size={18} />
              </span>
              <div>
                <strong>
                  {webmcpOnly
                    ? 'Your page is ready for an external agent.'
                    : 'See a request become an action.'}
                </strong>
                <p>
                  {webmcpOnly
                    ? 'Use a WebMCP-capable browser agent to discover pageway_get_context and the six workspace tools.'
                    : 'Ask the agent to “show high priority tasks” and watch the page respond.'}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (webmcpOnly) {
                    setTab('tools');
                    return;
                  }
                  setChatVisible(true);
                  void agent.sendMessage('Show high priority tasks');
                }}
              >
                {webmcpOnly ? 'View registered tools' : 'Try it now'} <ArrowRight size={15} />
              </button>
            </div>
            <section className="activity-section">
              <div className="section-label">
                <Route size={15} />
                <h3>Operation path</h3>
                <span>
                  {agent.actions.length
                    ? `${agent.actions.length} actions`
                    : 'Ready for your first action'}
                </span>
              </div>
              <ActionTimeline />
            </section>
          </>
        )}
        {tab === 'tools' && (
          <section className="tool-registry">
            <div className="registry-heading">
              <h2>Registered page tools</h2>
              <span className="small-chip">6 available</span>
            </div>
            {toolNames.map((name, index) => (
              <div className="tool-row" key={name}>
                <span className="tool-number">0{index + 1}</span>
                <span className="tool-code-icon">
                  <Workflow size={19} />
                </span>
                <div>
                  <code>{name}</code>
                  <p>{descriptions[name]}</p>
                </div>
                <span className="client-badge">
                  <span />
                  Browser
                </span>
              </div>
            ))}
            <p className="registry-note">
              Tools are explicitly registered by the app. The agent receives their JSON Schema and
              only calls these capabilities.
            </p>
          </section>
        )}
        {tab === 'events' && (
          <section className="events-panel">
            <div className="registry-heading">
              <h2>AG-UI event stream</h2>
              <span className="small-chip">{agent.events.length} events</span>
            </div>
            {agent.events.length ? (
              <div className="event-log">
                {agent.events.map((event, i) => (
                  <div key={eventKey(event)} className="event-row">
                    <span>{String(i + 1).padStart(3, '0')}</span>
                    <details>
                      <summary>
                        <span className="event-dot" />
                        {String((event as { type?: string }).type || 'EVENT')}
                        <ChevronDown size={13} />
                      </summary>
                      <pre>
                        {JSON.stringify(
                          event,
                          (key, value) =>
                            key === 'reasoning_content'
                              ? '[provider continuation metadata omitted]'
                              : value,
                          2,
                        )}
                      </pre>
                    </details>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <Radio size={28} />
                <h3>Listening for your first request</h3>
                <p>Send a message to see text, tool calls, and run events arrive.</p>
                {!webmcpOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      setChatVisible(true);
                      void agent.sendMessage('What is on this page?');
                    }}
                  >
                    Inspect this page <ArrowRight size={14} />
                  </button>
                )}
              </div>
            )}
          </section>
        )}
        {tab === 'integration' && (
          <section className="integration-panel">
            <div className="integration-intro">
              <span className="integration-icon">
                <Code2 size={25} />
              </span>
              <h2>One provider. Your existing app.</h2>
              <p>
                Register the capabilities you want to expose. Pageway connects the conversation, the
                agent, and the interface.
              </p>
            </div>
            <div className="install-line">
              <span>$</span>
              <code>pnpm add @zllling/pageway-react</code>
              <span className="small-chip">workspace package</span>
            </div>
            <div className="code-window">
              <header>
                <span>App.tsx</span>
                <button
                  type="button"
                  aria-label="Copy integration example"
                  onClick={() => {
                    void navigator.clipboard.writeText(snippet).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    });
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
                </button>
              </header>
              <pre>{snippet}</pre>
            </div>
            <div className="integration-steps">
              <div>
                <span>01</span>
                <strong>Register tools</strong>
                <p>
                  Use <code>usePageTool</code> with a JSON Schema, an execute callback, and a target
                  element.
                </p>
              </div>
              <div>
                <span>02</span>
                <strong>{webmcpOnly ? 'Expose WebMCP tools' : 'Connect the agent'}</strong>
                <p>
                  {webmcpOnly ? (
                    'Pageway registers the same typed tools with the browser. External agents execute them through WebMCP.'
                  ) : apiOrigin ? (
                    'Point apiOrigin at an OpenAI-compatible proxy. Keep model API keys in that server.'
                  ) : (
                    <>
                      Use <code>createAgentHandler</code> with a standard model API and expose an
                      HTTP endpoint.
                    </>
                  )}
                </p>
              </div>
              <div>
                <span>03</span>
                <strong>Watch it work</strong>
                <p>Stream responses, execute page actions, and show each step with AG-UI events.</p>
              </div>
            </div>
            <div className="integration-note">
              <FileCode2 size={16} />
              <span>
                {browserDemo
                  ? 'This demo runs a small rule-based planner in your browser. Connect your own server endpoint for real model conversations; API keys stay on your server.'
                  : 'Packages are local workspace packages. See the repository README for build, model setup, and publishing instructions.'}
              </span>
            </div>
          </section>
        )}
        <footer className="main-footer">
          <span>
            <Route size={13} />
            Built with Pageway
          </span>
          <span>Typed tools. Visible actions. Your interface.</span>
          <span>
            v0.2.0 <span className="little-dot" /> Developer preview
          </span>
        </footer>
      </main>
      {chatVisible && !webmcpOnly && (
        <aside className="agent-panel">
          <div className="agent-panel-top">
            <span className="agent-symbol">
              <Sparkles size={18} />
            </span>
            <div>
              <strong>Pageway agent</strong>
              <span>
                <i />
                {browserDemo
                  ? 'Local rules · no model or API key'
                  : isLive
                    ? `${gatewayName} · ${displayModel}`
                    : 'Your workspace copilot'}
              </span>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Clear conversation"
              title="Clear conversation"
              disabled={busy}
              onClick={() => agent.reset()}
            >
              <RotateCcw size={16} />
            </button>
          </div>
          <div className="agent-context">
            <span>
              <Layers size={13} />
              Website relaunch
            </span>
            <span>
              <span />6 tools connected
            </span>
          </div>
          <PagewayChat
            title="What can we do together?"
            suggestions={suggestions}
            className="playground-chat"
          />
          <div className="agent-footnote">
            <span className={`mode-dot ${isLive ? 'live' : ''}`} />
            {browserDemo
              ? 'Browser-only demo · No model API · Reload to reset'
              : isLive
                ? `${gatewayName} · ${providerInfo?.model ? 'Response model verified' : 'Ready for live requests'}`
                : 'Demo mode · Deterministic, no model API used'}
          </div>
        </aside>
      )}
      {showCreate && (
        <dialog
          ref={createDialog}
          className="create-dialog"
          aria-labelledby="create-title"
          onCancel={(e) => {
            e.preventDefault();
            setShowCreate(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setShowCreate(false);
            }
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreate(false);
          }}
        >
          <form
            className="create-modal"
            onSubmit={(e) => {
              e.preventDefault();
              addTask(newTitle, newPriority, newStatus);
              setNewTitle('');
              setShowCreate(false);
            }}
          >
            <header>
              <h2 id="create-title">Create a task</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Close dialog"
                onClick={() => setShowCreate(false)}
              >
                <X size={18} />
              </button>
            </header>
            <label>
              Task name
              <input
                name="task-title"
                required
                maxLength={120}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="What needs to get done?"
              />
            </label>
            <label>
              Priority
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value as Priority)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label>
              Status
              <select value={newStatus} onChange={(e) => setNewStatus(e.target.value as Status)}>
                {statuses.map((status) => (
                  <option value={status.id} key={status.id}>
                    {status.title}
                  </option>
                ))}
              </select>
            </label>
            <footer>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={!newTitle.trim()}>
                <Plus size={15} />
                Create task
              </button>
            </footer>
          </form>
        </dialog>
      )}
    </div>
  );
}
function TaskCard({ task, onStatus }: { task: Task; onStatus: (status: Status) => void }) {
  return (
    <article
      className={`task-card ${task.status === 'done' ? 'is-done' : ''}`}
      id={`task-${task.id}`}
    >
      <div className="task-card-top">
        <span className={`task-tag tag-${task.tag.toLowerCase()}`}>{task.tag}</span>
        <span className="task-id">{task.id}</span>
      </div>
      <h3>{task.title}</h3>
      <p>{task.description}</p>
      <div className="task-card-middle">
        <span className={`priority priority-${task.priority}`}>
          {task.priority === 'high' ? (
            <Flag size={10} />
          ) : task.priority === 'medium' ? (
            <span className="priority-bars">▥</span>
          ) : (
            <ArrowDown size={11} />
          )}{' '}
          {task.priority}
        </span>
        <span className="task-date">
          {task.status === 'done' && <CheckCircle2 size={11} />} {task.date}
        </span>
      </div>
      <footer>
        <label className="task-status-control">
          <span className="status-tiny" />
          {statuses.find((s) => s.id === task.status)?.title}
          <ChevronDown size={10} />
          <select
            aria-label={`${task.id} status`}
            value={task.status}
            onChange={(e) => onStatus(e.target.value as Status)}
          >
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <span className={`avatar avatar-${task.assignee.toLowerCase()}`} title={task.assignee}>
          {task.assignee[0]}
        </span>
      </footer>
    </article>
  );
}
