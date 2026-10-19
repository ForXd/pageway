import { useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Braces,
  Check,
  CheckCircle2,
  ChevronRight,
  Code2,
  Copy,
  ExternalLink,
  GitBranch,
  Layers,
  MousePointer2,
  Play,
  RotateCcw,
  Terminal,
} from 'lucide-react';
import reactExample from './examples/react.tsx?raw';
import agentExample from './examples/agent.ts?raw';
import asyncToolExample from './examples/async-tool.tsx?raw';

const repository = 'https://github.com/ForXd/pageway';
const demoUrl = `${import.meta.env.BASE_URL}demo/`;
const sections = [
  ['quickstart', '快速开始'],
  ['react', 'React 接入'],
  ['agent', 'Agent 接入'],
  ['tools', '工具与上下文'],
  ['protocol', 'AG-UI 协议'],
  ['lifecycle', '动画与取消'],
  ['boundaries', '能力边界'],
];

function Brand() {
  return (
    <a className="brand" href="#overview" aria-label="Pageway 首页">
      <span className="brand-mark" aria-hidden="true">
        <GitBranch size={23} strokeWidth={2} />
      </span>
      <span>
        Pageway<span className="brand-cn">页径</span>
      </span>
    </a>
  );
}

function CodeBlock({ code, label, file }: { code: string; label: string; file: string }) {
  const [copyStatus, setCopyStatus] = useState('');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.trim());
      setCopyStatus('已复制');
    } catch {
      setCopyStatus('复制失败，请选中代码复制');
    }
  };

  return (
    <div className="code-block">
      <div className="code-header">
        <span>
          <Code2 size={14} aria-hidden="true" />
          {file}
        </span>
        <button type="button" onClick={copy} aria-label={`复制 ${label}`}>
          {copyStatus === '已复制' ? <Check size={14} /> : <Copy size={14} />}
          {copyStatus === '已复制' ? '已复制' : '复制'}
        </button>
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable code must be reachable by keyboard. */}
      <section className="code-scroll" tabIndex={0} aria-label={label}>
        <pre>
          <code>{code.trim()}</code>
        </pre>
      </section>
      <span className="sr-only" role="status">
        {copyStatus}
      </span>
    </div>
  );
}

function SectionHeading({ number, title, lead }: { number: string; title: string; lead: string }) {
  return (
    <div className="section-heading">
      <span className="section-number">{number}</span>
      <h2>{title}</h2>
      <p>{lead}</p>
    </div>
  );
}

function Demo() {
  const [started, setStarted] = useState(false);
  const [generation, setGeneration] = useState(0);

  return (
    <section id="demo" className="demo-section section-anchor" aria-labelledby="demo-title">
      <div className="demo-intro">
        <div>
          <p className="eyebrow">
            <span /> THE PLAYGROUND
          </p>
          <h2 id="demo-title">说一句，看它走完每一步。</h2>
          <p>一个真正可操作的任务看板。试试筛选、切换视图、完成任务，再查看执行回执。</p>
        </div>
        <a className="text-link" href={demoUrl} target="_blank" rel="noreferrer">
          独立打开演示 <ArrowUpRight size={17} aria-hidden="true" />
        </a>
      </div>
      <div className="demo-window">
        <div className="demo-toolbar">
          <div className="window-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <span className="demo-address">pageway / playground</span>
          <span className="local-badge">
            <span />
            本地规则演示
          </span>
          {started && (
            <button
              type="button"
              className="reload-demo"
              onClick={() => setGeneration((value) => value + 1)}
              aria-label="重新载入演示"
            >
              <RotateCcw size={15} aria-hidden="true" />
            </button>
          )}
        </div>
        {started ? (
          <iframe
            key={generation}
            src={demoUrl}
            title="Pageway 任务看板交互演示"
            className="demo-frame"
          />
        ) : (
          <div className="demo-placeholder">
            <div className="preview-board" aria-hidden="true">
              <div className="preview-board-head">
                <span>Workspace</span>
                <span>8 tasks</span>
              </div>
              <div className="preview-columns">
                <div>
                  <span>
                    TO DO <i>3</i>
                  </span>
                  <div className="preview-task">
                    <b>准备发布说明</b>
                    <small>
                      PW-101 <em>High</em>
                    </small>
                  </div>
                  <div className="preview-task">
                    <b>检查接入文档</b>
                    <small>
                      PW-102 <em>Medium</em>
                    </small>
                  </div>
                </div>
                <div>
                  <span>
                    IN PROGRESS <i>3</i>
                  </span>
                  <div className="preview-task highlighted">
                    <b>完成 React 接入</b>
                    <small>
                      PW-103 <em>High</em>
                    </small>
                    <span className="preview-cursor">
                      <MousePointer2 size={18} fill="currentColor" /> Pageway
                    </span>
                  </div>
                </div>
                <div>
                  <span>
                    DONE <i>2</i>
                  </span>
                  <div className="preview-task">
                    <b>设计页面工具</b>
                    <small>
                      PW-104 <CheckCircle2 size={12} />
                    </small>
                  </div>
                </div>
              </div>
            </div>
            <div className="demo-start">
              <span className="demo-play-icon">
                <MousePointer2 size={27} aria-hidden="true" />
              </span>
              <h3>把下一步，交给 Pageway。</h3>
              <p>无需登录，无需 API Key。直接体验工具调用、动画与结果回传。</p>
              <button
                className="button button-primary"
                type="button"
                onClick={() => setStarted(true)}
              >
                <Play size={16} aria-hidden="true" />
                启动交互演示
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="demo-footnote">
        <p>
          <span className="small-dot" />
          演示在浏览器内使用确定性规划器，不连接大模型，也不发送模型请求。
        </p>
        <p>操作会锁定演示画布；使用 Stop task 或 Esc 结束。刷新后数据重置。</p>
      </div>
      <div className="try-prompts">
        <span>在演示聊天框试试</span>
        <code>显示高优先级任务并切换到列表</code>
        <code>完成 PW-103</code>
        <code>总结当前页面</code>
      </div>
    </section>
  );
}

export function App() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav className="header-nav" aria-label="主导航">
            <a href="#demo">在线体验</a>
            <a href="#quickstart">接入指南</a>
            <a
              href={`${repository}/releases`}
              className="version-link"
              target="_blank"
              rel="noreferrer"
            >
              v0.1.2
            </a>
          </nav>
          <a className="github-link" href={repository} target="_blank" rel="noreferrer">
            <Code2 size={18} aria-hidden="true" />
            <span>GitHub</span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      </header>

      <main id="main-content">
        <section id="overview" className="hero section-anchor">
          <div className="hero-copy">
            <p className="eyebrow">
              <span /> OPEN SOURCE · REACT + AG-UI
            </p>
            <h1>
              让页面
              <br />
              听懂<span className="hero-emphasis">下一步。</span>
            </h1>
            <p className="hero-description">
              为已有 React 应用，接入一个会操作的 Agent。
              <br className="desktop-break" />
              对话、页面工具、执行轨迹，从一句话开始连起来。
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="#demo">
                在线体验
                <ArrowRight size={17} aria-hidden="true" />
              </a>
              <a className="button button-secondary" href="#react">
                接入你的应用
                <Code2 size={17} aria-hidden="true" />
              </a>
            </div>
            <div className="hero-meta">
              <span>
                <Check size={14} />
                MIT 开源
              </span>
              <span>
                <Check size={14} />
                支持标准模型 API
              </span>
              <span>
                <Check size={14} />
                无需改造整站
              </span>
            </div>
          </div>
          <section className="journey-card" aria-label="Pageway 操作流程示意">
            <div className="journey-card-top">
              <span>
                <span className="small-dot" /> PAGEWAY IN ACTION
              </span>
              <span>01 — 03</span>
            </div>
            <div className="journey-prompt">
              <span className="avatar">你</span>
              <p>把高优先级任务切换为列表。</p>
            </div>
            <div className="journey-steps">
              <div className="journey-step">
                <span className="step-symbol">
                  <Braces size={17} />
                </span>
                <div>
                  <span className="step-caption">01 / 理解</span>
                  <h3>读取页面上下文</h3>
                  <p>任务状态、当前视图、可用工具</p>
                </div>
                <Check size={16} className="step-check" />
              </div>
              <div className="journey-step">
                <span className="step-symbol active">
                  <MousePointer2 size={17} />
                </span>
                <div>
                  <span className="step-caption">02 / 操作</span>
                  <h3>执行注册的页面工具</h3>
                  <p>
                    <code>filter_tasks</code>
                    <ChevronRight size={12} />
                    <code>navigate_view</code>
                  </p>
                </div>
                <Check size={16} className="step-check" />
              </div>
              <div className="journey-step">
                <span className="step-symbol">
                  <CheckCircle2 size={17} />
                </span>
                <div>
                  <span className="step-caption">03 / 回传</span>
                  <h3>根据实际结果继续对话</h3>
                  <p>每一步都有参数、结果和操作轨迹</p>
                </div>
                <Check size={16} className="step-check" />
              </div>
            </div>
            <div className="journey-receipt">
              <CheckCircle2 size={16} />
              <span>已显示高优先级任务，并切换到列表视图。</span>
            </div>
            <p className="journey-caption">流程示意 · 下方演示可执行真实页面操作</p>
          </section>
          <a className="hero-scroll" href="#demo">
            <ArrowDown size={15} /> 看见每一步的发生
          </a>
        </section>

        <section className="principles" aria-label="核心能力">
          <div>
            <Braces size={20} />
            <h2>页面主动告诉 AI</h2>
            <p>用业务上下文和 JSON Schema 描述能力。</p>
          </div>
          <div>
            <MousePointer2 size={20} />
            <h2>操作有迹可循</h2>
            <p>光标、路径、目标聚焦，让每一步可见。</p>
          </div>
          <div>
            <GitBranch size={20} />
            <h2>结果真正回到模型</h2>
            <p>通过 AG-UI 流连接对话、执行与续答。</p>
          </div>
        </section>

        <div className="site-container">
          <Demo />
        </div>

        <div className="docs-divider">
          <div>
            <BookOpen size={19} />
            <span>从第一次体验，到自己的应用。</span>
            <a href="#quickstart">
              开始接入 <ArrowDown size={15} />
            </a>
          </div>
        </div>

        <div className="docs-layout site-container">
          <aside className="docs-sidebar">
            <p className="sidebar-label">开发者文档</p>
            <nav aria-label="文档导航">
              {sections.map(([id, label]) => (
                <a key={id} href={`#${id}`}>
                  {label}
                  <ChevronRight size={13} aria-hidden="true" />
                </a>
              ))}
            </nav>
            <div className="sidebar-resource">
              <span className="sidebar-label">仓库中的完整指南</span>
              <a href={`${repository}/blob/main/docs/testing.md`} target="_blank" rel="noreferrer">
                测试流程 <ArrowUpRight size={13} />
              </a>
              <a
                href={`${repository}/blob/main/docs/providers.md`}
                target="_blank"
                rel="noreferrer"
              >
                模型服务配置 <ArrowUpRight size={13} />
              </a>
              <a href={`${repository}/blob/main/CONTRIBUTING.md`} target="_blank" rel="noreferrer">
                参与贡献 <ArrowUpRight size={13} />
              </a>
            </div>
            <span className="sidebar-note">
              开发者预览 · v0.1.2
              <br />
              React 19 · ES modules
            </span>
          </aside>

          <div className="docs-content">
            <section id="quickstart" className="doc-section section-anchor">
              <SectionHeading
                number="01 / GET STARTED"
                title="从两个包开始。"
                lead="前端注册能力，后端连接模型。你继续使用已有的页面、状态管理与业务 API。"
              />
              <div className="requirements">
                <span>Node.js 22.14+</span>
                <span>React 19</span>
                <span>支持流式工具调用的模型 API</span>
              </div>
              <CodeBlock
                label="安装命令"
                file="terminal"
                code={
                  '# React 应用\npnpm add @zllling/pageway-react@0.1.2\n\n# Agent 服务\npnpm add @zllling/pageway-agent@0.1.2'
                }
              />
              <div className="package-list">
                <a
                  href="https://www.npmjs.com/package/@zllling/pageway-react"
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>
                    <Layers size={17} />
                    <b>pageway-react</b>
                  </span>
                  <p>工具 hooks、对话、动画与操作轨迹</p>
                  <ArrowUpRight size={17} />
                </a>
                <a
                  href="https://www.npmjs.com/package/@zllling/pageway-agent"
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>
                    <Terminal size={17} />
                    <b>pageway-agent</b>
                  </span>
                  <p>Fetch HTTP handler 与模型流适配</p>
                  <ArrowUpRight size={17} />
                </a>
                <a
                  href="https://www.npmjs.com/package/@zllling/pageway-protocol"
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>
                    <GitBranch size={17} />
                    <b>pageway-protocol</b>
                  </span>
                  <p>AG-UI 类型、运行时 schema 与 SSE 编解码</p>
                  <ArrowUpRight size={17} />
                </a>
              </div>
              <p className="note-text">
                协议包由 React 和 Agent SDK 自动引入；只有自定义协议适配时，才需要直接安装。
              </p>
            </section>

            <section id="react" className="doc-section section-anchor">
              <SectionHeading
                number="02 / REACT"
                title="给页面注册一种能力。"
                lead="这个完整示例把一个已有的排序控件接入 Agent。工具回调修改 React 状态，target 则告诉动画应该落在哪里。"
              />
              <div className="steps-inline">
                <span>
                  <i>1</i>包裹 Provider
                </span>
                <span>
                  <i>2</i>注册上下文与工具
                </span>
                <span>
                  <i>3</i>显示聊天与轨迹
                </span>
              </div>
              <CodeBlock label="React 接入示例" file="src/App.tsx" code={reactExample} />
              <div className="callout">
                <Code2 size={19} />
                <div>
                  <strong>示例也是项目中的 TypeScript 源文件。</strong>
                  <p>
                    它会参与类型检查，展示的代码和被检查的代码来自同一个文件。将 Agent 服务挂载到{' '}
                    <code>/api/agent</code> 后即可连通；Vite 开发环境可代理该路径到你的服务端。
                  </p>
                </div>
              </div>
              <p>
                <code>usePageway()</code> 提供 <code>messages</code>、<code>sendMessage</code>、
                <code>stop</code>、<code>reset</code>、<code>status</code>、<code>actions</code> 与{' '}
                <code>events</code>，方便接入自定义 UI。Provider 的 <code>headers</code>{' '}
                可携带应用自己的鉴权信息，<code>animationDuration</code> 控制光标移动时长。
              </p>
            </section>

            <section id="agent" className="doc-section section-anchor">
              <SectionHeading
                number="03 / AGENT"
                title="把标准模型 API 接到后端。"
                lead="Agent 接收标准 Request，返回流式 Response。下面以 Next.js App Router 为例，也可以接入支持 Fetch API 的服务端框架。"
              />
              <CodeBlock label="Agent 接入示例" file="app/api/agent/route.ts" code={agentExample} />
              <CodeBlock
                label="服务端环境变量示例"
                file="server .env"
                code={
                  '# 替换为你的模型服务配置，仅放在服务端\nMODEL_BASE_URL=https://your-provider.example/v1\nMODEL_NAME=your-tool-capable-model\nMODEL_API_KEY=your-server-only-key'
                }
              />
              <p>
                模型接口需要兼容 Chat Completions 的 <code>stream: true</code>
                、函数工具调用，以及带工具结果的后续请求。接口不直接适配 Responses、Anthropic
                Messages 或 Gemini 原生协议。
              </p>
              <div className="callout">
                <Terminal size={19} />
                <div>
                  <strong>Vite + 独立 Node 服务？</strong>
                  <p>
                    使用仓库中的{' '}
                    <a
                      href={`${repository}/tree/main/apps/server`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      完整 Node HTTP 适配示例
                    </a>
                    。它包含请求转换、SSE 输出、环境配置与
                    CORS。生产服务需连接应用已有的登录、业务授权与限流逻辑；反向代理应及时转发 SSE
                    数据。
                  </p>
                </div>
              </div>
              <p>
                模型凭证始终保留在后端。GitHub Pages
                仅托管静态文件，本站演示使用浏览器内的规则规划器；部署真实模型时，将 Provider 的{' '}
                <code>endpoint</code> 指向你自己的 Agent HTTP 服务。
              </p>
              <a
                className="text-link"
                href={`${repository}/blob/main/docs/providers.md`}
                target="_blank"
                rel="noreferrer"
              >
                查看模型配置与免费 API 验证方式 <ArrowUpRight size={16} />
              </a>
            </section>

            <section id="tools" className="doc-section section-anchor">
              <SectionHeading
                number="04 / TOOLS & CONTEXT"
                title="能力边界，由你的应用定义。"
                lead="模型获得工具描述和必要的业务状态。实际操作始终由浏览器中注册的 execute 回调完成。"
              />
              <div className="definition-list">
                <div>
                  <code>usePageContext</code>
                  <p>
                    提供稳定的 <code>id</code>、可读描述和 <code>data</code>
                    。每轮请求会重新读取最新状态，只提交模型需要理解的数据。
                  </p>
                </div>
                <div>
                  <code>usePageTool</code>
                  <p>
                    用 <code>name</code>、<code>description</code> 和 JSON Schema
                    描述参数。前后端都会校验参数，未注册的工具不会执行。
                  </p>
                </div>
                <div>
                  <code>target</code>
                  <p>
                    可以是 selector
                    或根据参数返回元素的函数。它负责滚动、聚焦和路径定位；业务权限在应用中校验。目标元素缺失不会阻止工具回调执行。
                  </p>
                </div>
                <div>
                  <code>execute</code>
                  <p>
                    返回可序列化结果或 Promise。结果被回传给
                    Agent；抛出的错误会作为工具失败记录。异步请求应接收 <code>signal</code>。
                  </p>
                </div>
              </div>
              <details className="code-details">
                <summary>
                  异步工具：传递取消信号 <ChevronRight size={16} />
                </summary>
                <p>
                  下面的 hook 接入应用已有的任务 API。请在页面组件中调用它，并在业务 API
                  内校验用户权限。
                </p>
                <CodeBlock
                  label="异步工具示例"
                  file="src/useCompleteTask.tsx"
                  code={asyncToolExample}
                />
              </details>
            </section>

            <section id="protocol" className="doc-section section-anchor">
              <SectionHeading
                number="05 / THE ROUND TRIP"
                title="从调用，到实际结果。"
                lead="前后端沿用 AG-UI 标准。一次用户任务可以经过多轮 HTTP 请求，直到模型有足够的执行结果来回答。"
              />
              <ol className="protocol-flow">
                <li>
                  <span>01</span>
                  <div>
                    <strong>页面 → Agent</strong>
                    <p>POST 消息、工具 schema 与最新页面上下文。</p>
                    <code>RunAgentInput</code>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <strong>Agent → 模型 → 页面</strong>
                    <p>模型增量被转换为 AG-UI SSE 文本和工具事件。</p>
                    <code>TOOL_CALL_* → RUN_FINISHED</code>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <strong>页面执行工具</strong>
                    <p>完整成功的 run 结束后，校验参数、定位目标、顺序执行回调。</p>
                    <code>execute(args, {'{ signal }'})</code>
                  </div>
                </li>
                <li>
                  <span>04</span>
                  <div>
                    <strong>结果 → 下一轮 Agent</strong>
                    <p>提交真实回执和更新后的上下文，模型继续回复或调用工具。</p>
                    <code>role: 'tool'</code>
                  </div>
                </li>
              </ol>
              <p>
                每个请求对应一个 run：<code>RUN_STARTED</code> → 文本或工具事件 →{' '}
                <code>RUN_FINISHED</code> / <code>RUN_ERROR</code>。同一对话沿用{' '}
                <code>threadId</code>，每轮生成新 <code>runId</code>。前端最多自动续接 12 轮。
              </p>
              <p>
                工具结果在下一次 <code>RunAgentInput.messages</code>{' '}
                中回传，无需增加独立的结果上报端点。未完整接收或失败的工具参数流不会被执行。
              </p>
              <a
                className="text-link"
                href={`${repository}/blob/main/docs/protocol.md`}
                target="_blank"
                rel="noreferrer"
              >
                查看事件、字段与协议边界 <ArrowUpRight size={16} />
              </a>
            </section>

            <section id="lifecycle" className="doc-section section-anchor">
              <SectionHeading
                number="06 / VISIBLE & INTERRUPTIBLE"
                title="每一步看得见，也停得下来。"
                lead="PagewayOverlay 将执行过程映射为光标移动、目标聚焦、点击脉冲与完成反馈，操作路径保留参数和实际结果。"
              />
              <div className="motion-phases">
                <span>
                  <i />
                  规划
                </span>
                <ArrowRight size={14} />
                <span>
                  <i />
                  移动
                </span>
                <ArrowRight size={14} />
                <span>
                  <i />
                  执行
                </span>
                <ArrowRight size={14} />
                <span>
                  <CheckCircle2 size={14} />
                  完成
                </span>
              </div>
              <div className="lifecycle-notes">
                <div>
                  <h3>从任务开始锁定交互</h3>
                  <p>
                    原生 modal dialog 与 inert
                    阻止手动点击、输入和滚动。锁定覆盖模型规划和网络等待，工具仍可更新应用状态。
                  </p>
                </div>
                <div>
                  <h3>随时停止</h3>
                  <p>
                    点击 Stop task 或按 Esc，中断 HTTP 流、动画和待执行工具，并把 AbortSignal
                    传给正在运行的回调。已完成的业务修改不会自动撤销。
                  </p>
                </div>
                <div>
                  <h3>尊重减少动态效果偏好</h3>
                  <p>
                    系统启用 reduced motion
                    时，跳过移动和装饰动画，保留静态目标与结果反馈。正常完成、失败、取消或卸载后恢复交互和焦点。
                  </p>
                </div>
              </div>
              <p>
                已有无障碍交互锁的应用可设置 <code>{'<PagewayOverlay lockPage={false} />'}</code>
                。宿主在 window capture 阶段注册的快捷键可能先于锁执行，应主动检查{' '}
                <code>usePageway().status === 'running'</code> 并跳过操作。
              </p>
            </section>

            <section id="boundaries" className="doc-section section-anchor">
              <SectionHeading
                number="07 / BEFORE YOU SHIP"
                title="接入之前，了解这些边界。"
                lead="Pageway 是一个可组合的页面 Agent SDK，目前处于开发者预览阶段。"
              />
              <div className="boundary-grid">
                <div>
                  <h3>显式注册的页面能力</h3>
                  <p>
                    不自动扫描整个 DOM，不读取浏览器
                    Cookie，不执行模型生成的任意代码。跨页面能力需要在对应页面注册工具和上下文。
                  </p>
                </div>
                <div>
                  <h3>你的会话与业务权限</h3>
                  <p>
                    当前不包含会话数据库、多用户身份系统、持久审计或人审策略。客户端上下文和工具结果不是后端授权依据。
                  </p>
                </div>
                <div>
                  <h3>AG-UI 的标准子集</h3>
                  <p>
                    支持文本、工具调用与 run 生命周期；暂不支持 state
                    delta、interrupt/resume、二进制内容或断线重放。
                  </p>
                </div>
                <div>
                  <h3>演示与真实模型</h3>
                  <p>
                    本站规则演示只识别任务看板的有限指令。自己的工具需要配置真实模型；免费服务的可用性、额度与时延由服务商决定。
                  </p>
                </div>
              </div>
              <div className="end-cta">
                <span className="end-icon">
                  <Code2 size={24} />
                </span>
                <div>
                  <h3>让你的页面，拥有下一步。</h3>
                  <p>从一个工具开始，逐步开放应用的能力。</p>
                </div>
                <a
                  className="button button-primary"
                  href={repository}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看源码 <ArrowUpRight size={16} />
                </a>
              </div>
            </section>
          </div>
        </div>
      </main>

      <footer className="site-footer">
        <div>
          <Brand />
          <p>对话有回应，操作有来路。</p>
          <nav aria-label="页脚导航">
            <a href={`${repository}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
              MIT License
            </a>
            <a href={`${repository}/issues`} target="_blank" rel="noreferrer">
              反馈问题 <ExternalLink size={12} />
            </a>
            <a href="#overview">
              回到顶部 <ArrowUpRight size={13} />
            </a>
          </nav>
        </div>
      </footer>
    </>
  );
}
