// Next.js App Router: app/api/openai/chat/completions/route.ts
// 已有 OpenAI 兼容代理可直接复用，不必安装这个可选服务端包。
import { createOpenAIProxyHandler } from '@zllling/pageway-agent';

export const runtime = 'nodejs';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

export const POST = createOpenAIProxyHandler({
  baseURL: requiredEnv('MODEL_BASE_URL'), // Chat Completions API 的基础地址
  allowedModels: [requiredEnv('MODEL_NAME')], // 与前端 model 一致
  apiKey: process.env.MODEL_API_KEY, // 仅保留在服务端
  timeoutMs: 180_000,
});
