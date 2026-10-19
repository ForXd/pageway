# 在线文档与演示站

线上地址：[Pageway 文档与演示](https://forxd.github.io/pageway/)。
直接体验：[任务看板演示](https://forxd.github.io/pageway/demo/)。
浏览器 Agent：[WebMCP-only 演示](https://forxd.github.io/pageway/webmcp/)。

站点位于 `apps/site`，使用 Vite 构建文档首页、`demo/` 免费模型与本地演示，以及 `webmcp/` 浏览器 Agent 页面。所有资源都以 `/pageway/` 为基路径，文档章节使用 hash 链接，因此在 GitHub Pages 的项目子路径中直接访问、刷新和分享章节都不需要服务端路由。

## 演示如何工作

演示复用 Playground 的 React 页面、注册工具、任务锁定、光标动画和操作路径。默认“免费模型”模式由浏览器直接请求 Pollinations Classic 的 OpenAI 兼容接口，以 `openai-fast` 调用匿名免费模型。模型返回工具调用，React 执行页面操作，然后将工具结果与最新上下文交回模型续答。无需登录、API Key 或 Pageway 后端；只有用户发送消息才会发起模型请求。

免费模型会接收输入内容和演示工作区数据，请勿输入敏感信息。官方匿名文本限制为每个 IP 同时一个请求、至少间隔 30 秒，流式请求可排队，因此一次工具往返可能需要等待。额度、模型与可用性由供应商决定，详见 [模型接入与来源](providers.md#github-pages-匿名免费模型直连)。

点击“本地演示”或打开 [`demo/?mode=local`](https://forxd.github.io/pageway/demo/?mode=local)，可使用真实 Agent 包的 `demo` 模式。确定性规划器在浏览器内经 AG-UI SSE 返回工具调用、接收工具结果并生成确认消息，不发出模型请求，只支持看板的有限指令。免费模型失败时不会自动切换成规则回复。

切换模式和刷新都会恢复初始工作区与空白聊天；公开演示不启用会话缓存。GitHub Pages 只托管静态文件，不能运行代理服务，但可以直连允许匿名和 CORS 的模型 API。生产应用接入有密钥的模型时，前端设置自己的兼容网关或凭证代理地址，将模型密钥留在服务端。

文档包含 React、普通模型代理、AG-UI 兼容服务及 WebMCP-only 的 TypeScript 源文件，展示内容由源码原文导入，参与项目类型检查。会话缓存和 WebMCP 章节分别说明 localStorage 的恢复边界与浏览器实验支持要求。默认启用 WebMCP 不代表当前访客浏览器一定具备该能力；以 `usePageway().webmcp.status` 为准。

`webmcp/` 不挂载聊天模块、不配置模型或 Agent HTTP 地址。它复用真实看板工具、上下文和 Overlay；支持 WebMCP 的外部 Agent 可通过浏览器调用它们，不支持时显示不可用状态且仍可手动操作页面。此静态入口不申请浏览器实验权限，也不模拟原生 API。

## 本地构建与验证

```sh
pnpm install --frozen-lockfile
pnpm build:site
pnpm preview:site --host 127.0.0.1 --port 4190 --strictPort
```

打开 `http://127.0.0.1:4190/pageway/`。构建产物位于 `apps/site/dist`。

浏览器测试会自行启动生产预览服务；先停止手动预览，再运行：

```sh
pnpm exec playwright install --with-deps --no-shell chromium
pnpm test:site
```

测试覆盖桌面与移动视口下的生产资源路径、文档深链接和刷新、接入示例复制、内嵌演示加载、页面工具执行与结果回传、状态更新后的页面理解，以及任务期间的锁定与取消。免费模式测试拦截外部模型请求，验证标准请求和工具结果续传、限流错误及模式切换；本地模式验证不发出模型请求。测试使用生产构建文件，不启动 Agent HTTP 服务，也不消耗外部模型额度。真实免费 API 的人工检查与自动化测试分开记录。失败时保留截图、视频和 trace，报告位于 `playwright-report/site`。

也可以对已部署的站点运行同一套测试，此时不会启动本地预览服务：

```sh
SITE_BASE_URL=https://forxd.github.io/pageway/ pnpm test:site
```

## GitHub Pages 发布

工作流是 [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)。首次配置仓库时，在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。

每个 Pull Request 都会构建并测试站点。推送到 `main` 或在 `main` 上手动运行 **Documentation and demo** 工作流时，测试通过后的同一份产物才会被上传和部署。其他分支的手动运行只做验证。后续文档、SDK 或演示变更随 `main` 更新自动发布，不需要手动维护 `gh-pages` 分支。

构建任务只有仓库读取权限；部署任务单独获得 `pages: write` 和 `id-token: write`，使用 `github-pages` 环境。无需额外部署密钥或 npm Token。工作流和 npm 发布相互独立，更新文档不会发布 npm 包。

若 Fork 到其他仓库名，需要同步修改 Vite 的 `base`、站点测试中的路径和公开站点链接。如果绑定自定义域名，也需按实际 URL 调整基路径。GitHub 的官方设置说明见 [Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
