import { usePageTool } from '@zllling/pageway-react';

export function useCompleteTask() {
  usePageTool<{ taskId: string }>({
    name: 'complete_task',
    description: '将指定任务标记为完成',
    parameters: {
      type: 'object',
      properties: { taskId: { type: 'string', minLength: 1 } },
      required: ['taskId'],
      additionalProperties: false,
    },
    target: ({ taskId }) => document.getElementById(`task-${taskId}`),
    execute: async ({ taskId }, { signal }) => {
      signal.throwIfAborted();
      // 由应用的业务 API 执行授权校验，并将取消信号传给请求。
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
        signal,
      });
      if (!response.ok) throw new Error('任务更新失败');
      const result: unknown = await response.json();
      // 在你的应用中同时更新 React 状态或查询缓存，让页面展示最新结果。
      return result;
    },
  });
}
