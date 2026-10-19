// Next.js App Router: app/api/agent/route.ts
// 其他 Fetch API 服务端框架可将同一个 handler 挂载到 POST /api/agent。
import { createAgentHandler } from '@zllling/pageway-agent';

export const runtime = 'nodejs';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

export const POST = createAgentHandler({
  mode: 'openai',
  baseURL: requiredEnv('MODEL_BASE_URL'), // Chat Completions API 的基础地址
  model: requiredEnv('MODEL_NAME'),
  apiKey: process.env.MODEL_API_KEY, // 仅保留在服务端
  timeoutMs: 180_000,
  systemPrompt: '根据注册的工具操作页面，并依据工具的实际结果回复用户。',
});
