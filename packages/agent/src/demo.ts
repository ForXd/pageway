import { EventType, type AGUIEvent, type RunAgentInput } from '@zllling/pageway-protocol';
import type { ValidateFunction } from 'ajv';
import { isRecord, validateToolCall } from './validation.js';

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
}
interface Action {
  name: string;
  args: Record<string, unknown>;
  label: string;
}
type Emit = (event: AGUIEvent) => void;

function textMessage(content: string, emit: Emit): string {
  const messageId = `message_${crypto.randomUUID()}`;
  emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' });
  // Same event flow as a real model; the UI can use one renderer for both modes.
  for (const delta of content.match(/.{1,24}/gs) ?? [])
    emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta });
  emit({ type: EventType.TEXT_MESSAGE_END, messageId });
  return messageId;
}

function pageData(input: RunAgentInput): Record<string, unknown> {
  const state: unknown = input.state;
  if (isRecord(state)) {
    const pages: unknown[] = Array.isArray(state.page) ? state.page : [state.page];
    const page =
      pages.find((item) => isRecord(item) && item.id === 'workspace') ?? pages.find(isRecord);
    if (isRecord(page) && isRecord(page.data)) return page.data;
  }
  for (const context of input.context) {
    try {
      const page: unknown = JSON.parse(context.value);
      if (isRecord(page) && isRecord(page.data) && Array.isArray(page.data.tasks)) return page.data;
    } catch {
      /* Non-JSON context is valid AG-UI, but not this demo's workspace. */
    }
  }
  return {};
}

function readTasks(data: Record<string, unknown>): Task[] {
  if (!Array.isArray(data.tasks)) return [];
  return data.tasks.filter(
    (task: unknown): task is Task =>
      isRecord(task) &&
      typeof task.id === 'string' &&
      typeof task.title === 'string' &&
      typeof task.status === 'string' &&
      typeof task.priority === 'string',
  );
}

/** A deliberately small, deterministic demo planner. No model is involved. */
export function runDemo(
  input: RunAgentInput,
  validators: Map<string, ValidateFunction>,
  emit: Emit,
): void {
  const latestUser = input.messages.findLast((message) => message.role === 'user');
  const prompt =
    latestUser && typeof latestUser.content === 'string' ? latestUser.content.trim() : '';
  const chinese = /[\u3400-\u9fff]/.test(prompt);
  const data = pageData(input);
  const tasks = readTasks(data);

  if (input.messages.at(-1)?.role === 'tool') {
    const results = [];
    for (let index = input.messages.length - 1; index >= 0; index--) {
      const message = input.messages[index];
      if (message?.role !== 'tool') break;
      let value: unknown;
      try {
        value = JSON.parse(typeof message.content === 'string' ? message.content : '{}');
      } catch {
        value = message.content;
      }
      results.unshift(value);
    }
    const failed = results.some(
      (result) =>
        isRecord(result) &&
        (result.success === false || result.ok === false || Boolean(result.error)),
    );
    if (failed) {
      textMessage(
        chinese
          ? '演示规划器：页面返回了操作错误，请查看操作路径中的详情。已停止自动重试。'
          : 'Demo planner: the page reported an action error. Check the operation path for details; no automatic retry was made.',
        emit,
      );
      return;
    }
    const recentAssistant = input.messages.findLast(
      (message) => message.role === 'assistant' && message.toolCalls?.length,
    );
    const inspected =
      recentAssistant?.role === 'assistant' &&
      recentAssistant.toolCalls?.some((call) => call.function.name === 'inspect_page');
    if (inspected) {
      const high = tasks.filter((task) => task.priority === 'high').length;
      const done = tasks.filter((task) => task.status === 'done').length;
      textMessage(
        chinese
          ? `演示规划器：页面已返回数据。工作区共有 ${tasks.length} 个任务，${high} 个高优先级、${done} 个已完成。${tasks
              .slice(0, 3)
              .map((task) => `${task.id} · ${task.title}`)
              .join('；')}。`
          : `Demo planner: the page reports ${tasks.length} tasks, ${high} high priority and ${done} completed. ${tasks
              .slice(0, 3)
              .map((task) => `${task.id} · ${task.title}`)
              .join('; ')}.`,
        emit,
      );
    } else {
      textMessage(
        chinese
          ? `演示规划器：页面已确认 ${results.length} 项操作，结果已显示在工作区和操作路径中。`
          : `Demo planner: the page confirmed ${results.length} action${results.length === 1 ? '' : 's'}. The workspace and operation path now show the results.`,
        emit,
      );
    }
    return;
  }

  const lower = prompt.toLowerCase();
  const clauses = lower.split(/\s*(?:,|，|;|；|\band then\b|\band\b|然后|并且|并)\s*/i);
  const actions: Action[] = [];
  const add = (name: string, args: Record<string, unknown>, label: string) =>
    actions.push({ name, args, label });
  const create = /\b(create|add|new)\b.{0,30}\btask\b|(?:创建|新建|新增|添加).{0,6}任务/.test(
    lower,
  );
  const deleting = !create && /\b(delete|remove)\b|删除|移除/.test(lower);
  const update =
    !create &&
    !deleting &&
    /\b(complete|finish|mark|move|update|set|change)\b|完成|标记|更新|设为|改为|移到|移至/.test(
      lower,
    ) &&
    !/^\s*(?:show|filter|显示|筛选)/.test(lower.replace(/(?:and then|and|然后|并且|并).*/s, ''));
  // Multi-action requests can start with a filter and end with an update.
  const hasExplicitTaskUpdate =
    !create &&
    /\b(complete|finish|mark|update)\b|(?:将|把).{0,60}(?:完成|标记|改为)|(?:完成|标记)\s*[a-z]+-\d+/i.test(
      prompt,
    );
  const updating = update || hasExplicitTaskUpdate;
  const getPriority = (text: string) =>
    /high|高优先级|紧急/.test(text)
      ? 'high'
      : /medium|中优先级|中等/.test(text)
        ? 'medium'
        : /low|低优先级/.test(text)
          ? 'low'
          : 'all';
  const priority = getPriority(lower);
  const filterClause =
    clauses.find((clause) =>
      /\b(show|filter|find|search|display)\b|筛选|只看|显示|查找|搜索/.test(clause),
    ) ?? lower;
  const filterPriority = getPriority(filterClause);
  const filterStatus = /in[ _-]?progress|进行中/.test(filterClause)
    ? 'in_progress'
    : /\btodo\b|to[ -]?do|待办|未开始/.test(filterClause)
      ? 'todo'
      : /\bdone\b|completed|已完成/.test(filterClause)
        ? 'done'
        : 'all';

  if (/reset|clear.{0,15}filter|重置|清除筛选|取消筛选/.test(lower)) {
    add('reset_filters', {}, chinese ? '重置筛选' : 'reset the filters');
  } else if (
    !create &&
    !deleting &&
    (/\b(show|filter|find|search|display)\b|筛选|只看|显示|查找|搜索/.test(lower) ||
      (!updating && priority !== 'all'))
  ) {
    const queryMatch = prompt.match(/(?:search(?:\s+for)?|find|搜索|查找)\s*["“']([^"”']+)["”']/i);
    add(
      'filter_tasks',
      {
        status: filterStatus,
        priority: filterPriority,
        ...(queryMatch?.[1] ? { query: queryMatch[1] } : {}),
      },
      chinese ? '筛选工作区任务' : 'filter the workspace tasks',
    );
  }

  if (/\blist\b|列表/.test(lower))
    add('navigate_view', { view: 'list' }, chinese ? '切换到列表视图' : 'switch to list view');
  else if (/\bboard\b|看板/.test(lower) && /switch|view|show|切换|视图|显示|打开/.test(lower))
    add('navigate_view', { view: 'board' }, chinese ? '切换到看板视图' : 'switch to board view');

  if (create) {
    const quoted = prompt.match(/["“'「]([^"”'」]+)["”'」]/)?.[1];
    const plain = prompt
      .replace(
        /^.*?(?:\b(?:create|add|new)\b\s+(?:a\s+)?task\s*|(?:创建|新建|新增|添加)\s*(?:一个)?任务\s*)/i,
        '',
      )
      .replace(
        /(?:\s+(?:with|at)\s+(?:high|medium|low)\s+priority|，?\s*(?:优先级为|优先级设为|高优先级|中优先级|低优先级).*)$/i,
        '',
      )
      .replace(/^[:：\s]+/, '')
      .trim();
    const title = (quoted ?? plain).trim();
    if (!title || title === prompt || title.length > 160) {
      textMessage(
        chinese
          ? '演示规划器：请提供任务标题，例如：创建任务“准备发布说明”，高优先级。'
          : 'Demo planner: provide a task title, for example: Create task "Prepare release notes" with high priority.',
        emit,
      );
      return;
    }
    add(
      'create_task',
      { title, ...(priority !== 'all' ? { priority } : {}) },
      chinese ? `创建任务「${title}」` : `create “${title}”`,
    );
  } else if (deleting) {
    const ids = [...new Set(prompt.match(/\bPW-\d+\b/gi)?.map((id) => id.toUpperCase()) ?? [])];
    const target = ids.length === 1 ? tasks.find((task) => task.id === ids[0]) : undefined;
    if (!target) {
      textMessage(
        chinese
          ? '演示规划器：删除操作需要当前页面上一个明确的任务编号，例如“删除 PW-105”。请一次选择一个任务，我不会猜测或批量删除。'
          : 'Demo planner: deletion needs exactly one task ID from this page, for example “Delete PW-105”. Choose one task; I will not guess or delete a batch.',
        emit,
      );
      return;
    }
    add(
      'delete_task',
      { id: target.id },
      chinese ? `请求你审批删除任务 ${target.id}` : `ask you to approve deleting ${target.id}`,
    );
  } else if (updating) {
    const target =
      tasks.find((task) =>
        new RegExp(
          `(?:^|[^a-z0-9])${task.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`,
          'i',
        ).test(prompt),
      ) ?? tasks.find((task) => task.title.length > 3 && lower.includes(task.title.toLowerCase()));
    if (!target) {
      textMessage(
        chinese
          ? '演示规划器：请提供当前页面上的任务编号或完整标题，例如“完成 PW-103”。我不会猜测要修改的任务。'
          : 'Demo planner: include a task ID or exact title from this page, for example “Complete PW-103”. I need a matching task before making changes.',
        emit,
      );
      return;
    }
    const updateClause =
      clauses.find(
        (clause) =>
          clause.includes(target.id.toLowerCase()) || clause.includes(target.title.toLowerCase()),
      ) ?? lower;
    const updatePriority = getPriority(updateClause);
    const status = /\b(complete|finish|done|completed)\b|完成/.test(updateClause)
      ? 'done'
      : /in[ _-]?progress|进行中|开始/.test(updateClause)
        ? 'in_progress'
        : /\btodo\b|to[ -]?do|待办|未开始|reopen/.test(updateClause)
          ? 'todo'
          : undefined;
    const changingPriority =
      /priority\s+(?:to|as)|(?:set|change|update).{0,25}priority|优先级/.test(updateClause) &&
      updatePriority !== 'all';
    if (!status && !changingPriority) {
      textMessage(
        chinese
          ? '演示规划器：请说明新的状态或优先级，例如“将 PW-103 标记为完成”。'
          : 'Demo planner: specify the new status or priority, for example “Mark PW-103 as done”.',
        emit,
      );
      return;
    }
    add(
      'update_task',
      {
        id: target.id,
        ...(status ? { status } : {}),
        ...(changingPriority ? { priority: updatePriority } : {}),
      },
      chinese ? `更新任务 ${target.id}` : `update ${target.id}`,
    );
  }

  if (
    !actions.length &&
    /understand|inspect|summari[sz]e|overview|what|page|workspace|理解|总结|页面|概况|工作区/.test(
      lower,
    )
  ) {
    add(
      'inspect_page',
      {},
      chinese ? '读取已注册的页面上下文' : 'inspect the registered page context',
    );
  }
  if (!actions.length) {
    textMessage(
      chinese
        ? '这是无需密钥的演示规划器，可验证完整操作链路。可以试试“显示高优先级任务并切换到列表”“完成 PW-103”或“总结当前页面”。接入标准模型 API 后可使用开放式对话。'
        : 'This is the key-free demo planner for validating the action loop. Try “Show high priority tasks and switch to list”, “Complete PW-103”, or “Summarize this page”. Connect a compatible model API for open-ended conversations.',
      emit,
    );
    return;
  }
  if (actions.some((action) => !validators.has(action.name))) {
    textMessage(
      chinese
        ? '演示规划器：当前页面未开放完成该请求所需的工具。请检查 Agent permissions 或注册相应的演示工作区工具。'
        : 'Demo planner: this page has not made the required tools available. Check Agent permissions or register the corresponding workspace demo tools.',
      emit,
    );
    return;
  }
  for (const action of actions)
    validateToolCall(action.name, JSON.stringify(action.args), validators);
  const parentMessageId = textMessage(
    chinese
      ? `演示规划器：我将${actions.map((action) => action.label).join('，然后')}。`
      : `Demo plan: I’ll ${actions.map((action) => action.label).join(', then ')}.`,
    emit,
  );
  for (const action of actions) {
    const toolCallId = `call_${crypto.randomUUID()}`;
    emit({
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName: action.name,
      parentMessageId,
    });
    emit({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify(action.args) });
    emit({ type: EventType.TOOL_CALL_END, toolCallId });
  }
}
