// 兼容已有 AG-UI 服务：挂载到 POST /api/agent。
// 前端对应 <PagewayProvider endpoint="/api/agent">。
import { createAgentHandler } from '@zllling/pageway-agent';

export const POST = createAgentHandler({
  mode: 'openai',
  baseURL: process.env.MODEL_BASE_URL,
  model: process.env.MODEL_NAME,
  apiKey: process.env.MODEL_API_KEY,
  timeoutMs: 180_000,
  systemPrompt: '根据注册的工具操作页面，并依据实际执行结果回复用户。',
});
