# 验证记录

日期：2026-10-17（Asia/Shanghai）。本记录区分真实模型、协议 mock、浏览器交互和构建结果。

## 工程补全验证

同日完成的最终本地验证：

- `pnpm install --frozen-lockfile`、Biome（零警告）、Prettier、全部源码与测试类型检查、生产构建通过。
- Vitest：**140 项测试 / 7 个文件全部通过**。实现覆盖率：语句 **93.05%**、分支 **83.06%**、函数 **93.90%**、行 **94.06%**。格式化前后的行数不同，不用行覆盖率比较逻辑变化。
- Playwright：**20 项全部通过，40.0 秒，无重试**；Chromium 12、Firefox 2、WebKit 2、移动 Chromium 4。包括六种页面工具、完整结果续传、最新上下文、错误/取消/超时/重试、交互锁和真实动画帧。
- StrictMode 条件挂载 Overlay 的旧 `close` 事件误取消问题已通过红→绿回归修复，并额外在真实 Chromium 验证任务持续运行、显式 Stop 后才取消。
- `pnpm release:dry-run`：三个真实 tarball 的独立安装、开发条件下 dist 导出、SSR、CSS、Agent HTTP 与严格 TypeScript 消费测试通过；三个 npm publish dry-run 通过，未上传。
- 打包产物含 README、MIT LICENSE；内部依赖已替换为固定版本，未含 `.env`、测试或开发源码入口。

普通 CI 使用本地 HTTP 模型 fixture；下文的 Kilo 记录才是外部真实模型验证。最新远端结果见 [GitHub Actions](https://github.com/ForXd/pageway/actions)。

## GitHub 与 npm

- 公开仓库：[ForXd/pageway](https://github.com/ForXd/pageway)，MIT 协议。
- `bed81aa` 的 [远端 CI](https://github.com/ForXd/pageway/actions/runs/39012611554) 全绿：Node 24/26 与 Linux 多浏览器 E2E。
- 修复 Node 24 `EventTarget` 的 capture 清理兼容差异，并固定 GitHub runner 为 Ubuntu 24.04。
- 三个 `@zllling/pageway-*` 包的 `0.1.0` 已通过 npm 账户认证发布；首次手动发布不含 GitHub provenance。
- GitHub `npm` environment 仅允许 `v*` 标签部署。下一版通过 `.github/workflows/release.yml` 验证 OIDC 自动发布和来源证明。

## 初始实现验证

以下是工程补全前的基线记录；当前测试命令和最新门禁结果以 [GitHub Actions](https://github.com/ForXd/pageway/actions) 为准。

### 自动化与构建

- `pnpm install --frozen-lockfile`：通过。
- `pnpm check`：通过；全 workspace 类型检查、62 项测试（5 个测试文件）和生产构建完成。
- Vite 产物：约 503 KB JavaScript，gzip 约 149 KB；CSS gzip 约 10.4 KB（Vite 提示单 chunk 超过 500 KB）。
- 标准模型适配器以真实 localhost HTTP mock 验证 streaming Chat Completions、UTF-8 分块、工具调用与结果续接、DeepSeek metadata、异常结束、超时和取消向上游传播。这些本地 mock 检查用于边界与错误路径；真实外部模型证据见下文。

## 浏览器端到端

本地地址 `http://127.0.0.1:5174`（5173 被其他进程占用），通过 ego-browser 运行真实 React 页面。

| 操作                                                             | 实际结果                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| 英文请求显示高优先级任务                                         | 筛选值 high，仅 3 个任务可见                           |
| 中文请求“显示高优先级任务并切换到列表，然后将 PW-103 标记为完成” | 3 行列表、PW-103 为 done、3 条成功操作路径，无错误提示 |
| 创建任务“准备发布说明”，高优先级                                 | 出现 PW-109，状态 todo，优先级 high                    |
| 随后总结当前页面                                                 | 回复引用更新后的 9 个任务、4 个高优先级和 3 个已完成   |
| 修改 PW-101 时点击停止                                           | 路径标记 cancelled，PW-101 保持 todo                   |
| 取消后继续发送“清除筛选”                                         | 对话恢复，全部 9 个任务显示                            |
| Reset demo                                                       | 恢复 8 个初始任务和聊天欢迎状态                        |
| 390 × 844 viewport                                               | 文档宽度 390、无横向溢出、聊天面板宽 364，输入框存在   |

Ego 的截图导出与 CDP capture 超时，部分 CSS 动画时间轴停在 0；该环境仅用于 DOM/协议检查。随后通过当前 Codex 内置浏览器成功导出截图并检查运行期锁定与真实模型回复。浏览器报告可用更新，本次没有升级。

## 包分发

`pnpm pack` 生成了三个 tarball，位于忽略目录 `artifacts/`。packed manifest 使用 `dist` exports，移除工作区专用的 `development → src` 条件；`workspace:*` 改写为 `0.1.0`。

独立临时目录安装本地 tarball 后验证了：

- protocol/agent 在 `--conditions=development` 下正确导入，执行 demo 后产生有效 AG-UI 生命周期。
- React 包正确导入、CSS export 存在，Provider/Chat/Overlay/Timeline 服务端 renderToString 成功。
- 独立消费者严格 TypeScript 检查通过。

本节记录的是初次打包时的未发布状态；三个包现已完成 `0.1.0` 首次发布。外部项目试用未发布版本的 tarball 时，需要把未发布的 `@zllling/pageway-protocol` 依赖通过 `pnpm.overrides` 指向对应本地 tarball；发布后不再需要这一覆盖。

## 真实 Kilo 模型端到端

本地 `.env` 已切换至 `AGENT_MODE=openai`，使用标准地址 `https://ai-gateway.kilo.ai/api/v1`、模型 `nvidia/nemotron-3.5-lightning:free`，没有配置 API Key，单轮超时 180 秒。

- `pnpm check:model`：普通文本、结构化工具调用、携带随机工具回执的续答三项全部通过；实际响应模型与请求模型一致。
- 在真实浏览器输入“把 PW-103 标记为完成。执行后请根据工具返回结果，告诉我任务标题和最新状态。”
- 第一轮 HTTP 200，约 76.9 秒；模型产生 `update_task({"id":"PW-103","status":"done"})`。AG-UI 事件完整包含工具开始、参数、结束、`RUN_FINISHED`。
- 前端实际执行回调，PW-103 从 `in_progress` 移到 `done`，操作路径保存成功参数与返回的完整任务。
- 第二轮 HTTP 200，约 35.4 秒；请求中包含相同工具调用 ID 的 assistant toolCalls 和 `role: tool` 成功结果，以及已更新的页面上下文。
- 模型最终回复：任务 **PW-103**：**Connect the agent API** 已更新，当前状态为 **done**。以 `RUN_FINISHED` 正常结束。
- 两轮 `CUSTOM / pageway.provider` 的实际模型均为 `nvidia/nemotron-3.5-lightning:free`，来源 `response`、服务商 `ai-gateway.kilo.ai`。

匿名直接 SSE 探测也已通过，工具结果里加入的独有凭据被模型准确复述。OpenCode 免费层外部 403 的原有限制仍存在，已从默认配置移除。服务商文档与额度见 [模型配置](providers.md)。

观察文件保存在忽略目录 `artifacts/kilo-browser-e2e.json`，包含两轮请求的消息/上下文、脱敏事件、动画帧和最终页面状态；不保存推理内容或鉴权头。该浏览器验证没有修改、拦截或替换模型响应。

## 运行期交互锁

真实模型等待与两轮执行期间，原生 modal dialog 保持打开，应用根节点保持 inert。点击原页面“New task”、尝试给搜索框输入文字、按 Tab 均没有修改页面或打开表单；唯一可操作控件为 Stop task。正常完成后 dialog 消失、inert 与 overflow 恢复，PW-103 保留真实执行后的 done 状态。

为检查取消和失败的 UI 路径，另外使用明确标为 demo 的本地端点及显式 HTTP 404 故障响应：

- 在 `moving` 阶段按 Esc，PW-101 保持 todo，路径显示 Cancelled，dialog/inert/overflow 均恢复。
- 已提前注册的 document capture 键盘监听器在锁定期间调用次数为 0；解锁后搜索框可重新输入。
- HTTP 404 后聊天显示错误，页面锁随之释放。
- 证据：`artifacts/interaction-lock-check.json`。这些故障/取消检查与上面的真实模型验证分开记录。

当前内置浏览器也独立完成了一次真实 Kilo 请求，最终显示 “PW-103 ("Connect the agent API") is now marked as done.”，并显示 `Response model verified`。截图：`artifacts/live-task-lock.png`、`artifacts/live-task-completed.png`。

## 动画视觉复验

在当前 Codex 内置浏览器的 **576×764** 视口中，临时切换为明确标注的 demo 模式，单独检查不受模型等待影响的动画；结束后已恢复 Kilo 配置。

- `moving` 阶段记录到 **41 个不同的光标位置**；到达前 PW-103 仍是 in_progress，随后进入 acting、success 并变为 done。
- 目标换列后再次定位；成功反馈的光标稳定在约 (288,382)，高亮区域位于约 (32,287)，保持在视口中。
- 聊天现在只滚动自身消息容器，不再通过 scrollIntoView 抢走宿主页面滚动。
- 截图 `artifacts/operation-animation.png` 显示移动光标、目标高亮、路径连线以及顶部 Stop task 控件。
- 逐帧数据：`artifacts/native-animation-check.json`。这份动画检查使用 demo；真实 Kilo 的独立完整链路证据见上文。
