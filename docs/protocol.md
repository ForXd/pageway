# Pageway 的 AG-UI 通信约定

本文描述当前实现。`@zllling/pageway-protocol` 直接导出 `@ag-ui/core@1.0.3` 类型与官方 schema，并提供 SSE 编解码；Pageway 使用其中的文本、工具调用和 run 生命周期事件。[AG-UI 官方事件说明](https://docs.ag-ui.com/concepts/events)

## 一次用户请求如何完成

```mermaid
sequenceDiagram
    participant UI as React 页面
    participant Agent as Pageway HTTP agent
    participant Model as Chat Completions API
    UI->>Agent: POST RunAgentInput（消息、工具、最新页面上下文）
    Agent->>Model: messages + tools，stream=true
    Model-->>Agent: 文本增量与 function tool_calls
    Agent-->>UI: RUN_STARTED / TEXT_MESSAGE_* / TOOL_CALL_*
    Agent-->>UI: RUN_FINISHED
    UI->>UI: 校验参数 → 高亮目标 → 顺序执行注册回调
    UI->>Agent: 新 run，附 role=tool 结果与最新页面上下文
    Agent->>Model: assistant.tool_calls + tool 结果
    Model-->>Agent: 结果说明或下一批工具调用
    Agent-->>UI: SSE 事件
```

一个 HTTP 请求对应一个 run。同一段对话沿用 `threadId`，每轮 POST 生成新的 `runId`。前端最多自动进行 12 轮；同一 provider 的工具调用列表按接收顺序执行。后端无会话存储，前端每轮提交完整历史。

## HTTP 输入

`POST /api/agent`，`Content-Type: application/json`，响应为 `text/event-stream`。请求体采用官方 `RunAgentInput`：

| 字段                 | 当前 Pageway 用法                                                                       |
| -------------------- | --------------------------------------------------------------------------------------- |
| `threadId` / `runId` | 对话与本轮请求标识，前端检查响应标识是否匹配                                            |
| `messages`           | `user`、`assistant`、`tool` 文本历史；工具调用保存在 `assistant.toolCalls`              |
| `tools`              | 已注册能力的 `name`、`description`、JSON Schema `parameters`；不发送执行函数或 DOM 引用 |
| `context`            | 每个页面上下文转换为 `{ description, value }`，`value` 是 `{ id, data }` 的 JSON 字符串 |
| `state`              | `{ page: PageContext[] }`，每次请求重新读取                                             |
| `forwardedProps`     | 当前仅标识来源 `@zllling/pageway-react`                                                 |

模型适配器将 `toolCalls` 映射为 OpenAI 的 `tool_calls`，将 `toolCallId` 映射为 `tool_call_id`。模型收到的是应用显式注册的数据；不会自动抓取 DOM、截图、浏览器 Cookie 或未注册控件。

## SSE 输出与执行时机

每帧格式为 `data: <JSON>\n\n`。协议包会处理 UTF-8 分块、CR/LF、注释与多行 data，并使用官方 `EventSchema` 校验事件。

| 事件                             | 页面端行为                                                         |
| -------------------------------- | ------------------------------------------------------------------ |
| `RUN_STARTED`                    | 校验当前对话与 run 标识                                            |
| `TEXT_MESSAGE_START/CONTENT/END` | 建立并增量更新 assistant 文本                                      |
| `TOOL_CALL_START`                | 记录调用 ID、工具名、关联的 assistant 消息，操作路径显示 planning  |
| `TOOL_CALL_ARGS`                 | 按调用 ID 拼接 JSON 字符串；完整前不会执行                         |
| `TOOL_CALL_END`                  | 标识参数流完整                                                     |
| `RUN_FINISHED`                   | 仅当本轮所有工具参数流完整后，开始前端执行                         |
| `CUSTOM` / `pageway.provider`    | 记录请求模型、实际响应模型、服务商及免费池回退信息；仅作为诊断信息 |
| `RUN_ERROR`                      | 停止本轮，将待处理调用记录为失败                                   |

工具执行由浏览器中注册的 `execute(args, { signal })` 完成。结果存为 `role: "tool"` 消息，`content` 为 `{ ok: true, result }` 或 `{ ok: false, error }` 的 JSON。随后发起新 run，由模型根据实际结果续答。当前后端不发送 `TOOL_CALL_RESULT`；本地操作路径由引擎执行状态驱动，不是服务端推测的成功状态。

后端和前端都会校验 JSON Schema。模型仅提出调用；未注册工具或非法参数不会执行。运行时 `target` 只用于滚动、高亮与连线，不决定业务操作。目标 DOM 不存在时，注册工具仍可执行。

## 错误、取消与边界

- 停止会中断 HTTP 流、动画和待执行工具，并向正在运行的工具传递 `AbortSignal`。应用的异步工具必须检查或转交这个 signal；已完成的业务操作不会自动回滚。
- 流中断时不会把半截参数作为成功调用。残缺历史参数被规范化为有效对象，并配对明确的失败结果，让下一轮对话可以恢复；原始事件仍可检查。
- 后端请求体上限 1 MiB、消息最多 256 条、工具最多 64 个；单模型请求默认 45 秒，可配置。客户端单工具参数上限 200 KB，事件日志保留最近 250 个事件。当前没有历史摘要或持久化，长会话应重新开始。
- OpenAI 模式要求 provider 返回 SSE、标准结束原因与 `[DONE]`。网络错误、未知工具、非法参数、截断输出都会产生 `RUN_ERROR`，不会产生可执行的成功完成信号。
- 对部分兼容推理模型，`reasoning_content` 通过 `metadata.pageway.reasoning_content` 原样带回后续请求，不作为聊天正文。该字段是明文续传数据，不是加密存储；调试事件中可能包含它。

Pageway 当前未实现完整 AG-UI 功能面：不会应用 `STATE_DELTA`、`STATE_SNAPSHOT`、消息快照或快捷 chunk 事件，也不包含人审中断、子 agent 编排、二进制内容与断线重放。外部 agent 对接应发送上表中的完整生命周期事件；页面动作的显式注册与结果回传方式与 AG-UI 的前端工具模型一致。[AG-UI 工具概念](https://docs.ag-ui.com/concepts/tools)

## 模型来源事件

真实模型模式在上游连接后发送标准 AG-UI `CUSTOM` 事件，`name` 为 `pageway.provider`。`value` 包含 `requestedModel`、`model`（尚未知时为 null）、`provider`（URL host）和 `modelSource`（`unknown`、`header`、`response`）。若上游提供相关响应头，还可能包含 `fallback`、`freeModel`、`originalModel`、`fallbackModel`。收到 SSE 的实际 `model` 字段后会更新事件；UI 使用最近的实际模型名称。只透传经过长度/控制字符/已知密钥过滤的模型标识，不透传任意响应头。

免费网关有时在结束后追加相同 `finish_reason` 的空 delta 帧。适配器允许这种无内容尾帧，仍拒绝结束后的新增文本或工具参数。
