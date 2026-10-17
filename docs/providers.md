# 模型 API 接入与验证

核验日期：**2026-10-17（Asia/Shanghai）**。

Pageway 的真实模型模式接入 **OpenAI Chat Completions 兼容 API**。模型需要支持 `tools`、结构化 `tool_calls` 和 `role: "tool"` 的结果回传。API Key 只配置在 agent 服务端；前端仅指定 Pageway agent 的 HTTP 地址。

## 首选：Kilo Gateway 免费模型

Kilo 官方允许外部应用通过 OpenAI 兼容接口调用模型，当前 API 根地址为 `https://ai-gateway.kilo.ai/api/v1`。Chat Completions 接口支持 SSE、函数调用及工具结果消息。[官方 API 文档](https://kilo.ai/docs/gateway/api-reference)

免费模型允许匿名调用，不需要 API Key；官方当前限制为 **每个 IP 每小时 200 次请求**。该限制按请求计数，一次包含工具调用的对话通常需要多次模型请求。[官方鉴权与匿名额度说明](https://kilo.ai/docs/gateway/authentication)

本次选择 `nvidia/nemotron-3.5-lightning:free`。当前标准地址的 `/models` 返回 HTTP 200，目录中该模型的 `isFree` 为 `true`，输入、输出价格均为 `0`，支持 `tools` 和 `tool_choice`。[实时模型列表](https://ai-gateway.kilo.ai/api/v1/models)

### 已完成的真实 API 核验

以下请求使用合成任务数据，没有配置 Authorization，也没有使用演示模式：

| 实测项目                                                  | 结果                                                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 标准地址 `https://ai-gateway.kilo.ai/api/v1/models`       | HTTP 200，确认模型、零价格及工具能力声明                                                                                        |
| 旧地址 `https://api.kilo.ai/api/gateway` 的非流式工具往返 | 模型返回 `set_status` 调用；回传工具结果后，模型正确复述结果中的独有凭据                                                        |
| 旧地址的完整 SSE 工具往返                                 | 首轮返回 `set_status({"id":"item-9","status":"done"})`；第二轮收到工具结果后回复任务状态与 `PAGEWAY-STREAM-9356`                |
| SSE 完整结束及实际模型                                    | 两轮均收到 `[DONE]`，分别以 `tool_calls`、`stop` 结束；响应模型均为 `nvidia/nemotron-3.5-lightning:free`，`usage.cost` 均为 `0` |

该 SSE 往返请求仅包含 `model`、`stream: true`、`messages`、`tools` 和 `tool_choice: "auto"`，没有添加 `max_tokens` 或供应商特有的推理参数。独有凭据只出现在工具结果中，模型成功复述它，验证了结果回传与续答。首轮耗时约 64 秒，续轮约 53 秒，因此本项目建议将请求超时配置为 180 秒。

随后在**标准地址**完成了两项复验：

- `pnpm check:model` 三项全部通过，包括现场生成的工具结果随机凭据；三次响应模型均为 `nvidia/nemotron-3.5-lightning:free`。
- 浏览器发送“把 PW-103 标记为完成。执行后请根据工具返回结果，告诉我任务标题和最新状态。”首轮模型实际调用 `update_task({"id":"PW-103","status":"done"})`；React 页面更新后，下一轮请求携带成功工具结果及最新上下文，模型回复“任务 **PW-103**：**Connect the agent API** 已更新，当前状态为 **done**。”两轮 AG-UI 均正常结束，耗时约 77 秒和 35 秒。

这次浏览器使用的是项目的真实 `/api/agent`、标准 SSE 适配器和 React 工具执行器。实际响应模型由 `pageway.provider` 事件核对，没有静默降级为 demo。详细证据见 [验证记录](verification.md)。

### 配置

项目根目录 `.env`：

```dotenv
AGENT_MODE=openai
MODEL_BASE_URL=https://ai-gateway.kilo.ai/api/v1
MODEL_API_KEY=
MODEL_NAME=nvidia/nemotron-3.5-lightning:free
AGENT_TIMEOUT_MS=180000
```

修改后重启 agent 服务。`MODEL_BASE_URL` 填 API 根地址，不包含 `/chat/completions`。Key 留空时不会发送 Authorization；接入其他需要 Key 的供应商时，只在服务端填写 `MODEL_API_KEY`，不要放入前端变量或提交真实 `.env`。

Kilo 会在流末提供 usage 数据。SSE 消费方还需处理终止帧、usage 尾帧和流内错误，不能在收到 HTTP 200 后直接视为成功。[官方流式说明](https://kilo.ai/docs/gateway/streaming)

## 可重复检查

在项目根目录执行：

```sh
pnpm check:model
```

脚本读取根 `.env`，已导出的环境变量优先；未指定供应商时默认使用上述 Kilo 标准地址与免费模型。超时读取 `AGENT_TIMEOUT_MS`，默认每次请求 180 秒，允许范围为 1–300000 毫秒。

检查依次发起三个**非流式**模型请求：

1. 普通文本 completion，确认收到预期测试文本。
2. 要求模型调用 `pageway_echo`，检查结构化函数名及 JSON 参数。
3. 将工具结果回传给模型，要求模型返回测试文本和执行凭据。脚本在工具调用后生成新的随机凭据，且只放入 `role: "tool"` 消息；续答必须准确包含它，并且不能继续发出工具调用。

成功输出三条 `PASS`：`text completion`、`structured function call and JSON arguments`、`tool-result continuation with a fresh tool-only receipt`。脚本也输出供应商响应中的实际模型名；任意步骤失败都会以非零退出码结束。

脚本只发送合成测试数据，不读取页面或仓库内容，不打印 API Key。它验证模型 API 的文本、工具与回传能力；浏览器中的 React 工具注册、实际页面更新和 AG-UI 流程仍需另外验证。完整通过一次检查需要三次服务商请求额度。

## 备用：BlockRun 免费接口

BlockRun 官方提供无需账户、API Key 或钱包的免费 Chat Completions 模型，支持 SSE 和工具调用；当前免费限制为每 IP 每分钟 30 次、每小时 300 次。[官方接入文档](https://blockrun.ai/docs/getting-started/sdk-developers) · [官方限流说明](https://blockrun.ai/docs/api-reference/rate-limits)

本次探测曾成功返回结构化工具调用，但也出现一次未能稳定返回期望工具调用的结果，因此保留为备选，未设为默认。免费模型清单会变化；旧模型 ID 即使返回 HTTP 200，也可能由其他免费模型实际提供结果。应检查响应 `model` 和 `X-Fallback-Model`，不能仅凭请求中的模型名宣称使用了某个模型。[官方回退说明](https://blockrun.ai/faq) · [官方 SDK 的模型退役说明](https://github.com/BlockRunAI/blockrun-llm/blob/main/README.md)

## OpenCode 免费层：当前外部调用受限

此前已确认 OpenCode 模型列表含 `deepseek-v4.1-flash-free`，但普通 HTTP 客户端的文本请求和工具请求均返回 **HTTP 403 / `FreeTierError`**，错误说明免费层仅允许从 OpenCode 内使用。因此未将它作为 Pageway 的外部 API，也没有通过伪装客户端绕过限制。[官方模型说明](https://opencode.ai/v2/docs/console/models/) · [官方推理接口说明](https://opencode.ai/v2/docs/console/api/inference/)

## 接入边界

- 免费额度、模型目录和匿名策略由供应商决定，部署或更换模型后应重新运行完整检查。共享出口 IP 的应用会共享匿名额度。
- 当前适配器使用 Chat Completions；使用 Responses、Anthropic Messages 或 Gemini 原生协议的模型，需要对应适配，不能只修改模型名。
- 验证时以供应商响应的实际模型及工具执行后的页面状态为准。`demo` 模式是确定性演示实现，不是大模型。
- 检查脚本在续答时保留供应商返回的 assistant 字段；推理模型可能要求额外字段，接入新模型时需验证完整往返。
