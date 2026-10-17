import { createServer } from 'node:http';

const records = [];
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const json = (response, body, status = 200) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
};

function applicationData(body) {
  const system = body.messages.find((message) => message.role === 'system')?.content ?? '';
  return JSON.parse(system.split('Current application data (JSON):\n')[1]).state.page[0].data;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:4182');
  if (request.method === 'GET' && url.pathname === '/health') return json(response, { ok: true });
  if (request.method === 'GET' && url.pathname.startsWith('/requests/'))
    return json(
      response,
      records.filter((record) => record.session === url.pathname.slice('/requests/'.length)),
    );
  if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions')
    return json(response, { error: 'Not found' }, 404);
  try {
    let raw = '';
    for await (const part of request) {
      raw += part.toString();
      if (raw.length > 1_048_576) return json(response, { error: 'Request too large' }, 413);
    }
    const body = JSON.parse(raw);
    const lastUser = body.messages.findLastIndex((message) => message.role === 'user');
    const match = body.messages[lastUser]?.content?.match(/\[e2e:([\w-]+):([\w-]+)\]/);
    if (
      !match ||
      body.model !== 'pageway-e2e-model' ||
      body.stream !== true ||
      request.headers.authorization
    )
      return json(response, { error: 'Expected an isolated streaming E2E request' }, 400);
    const [, session, scenario] = match;
    const record = { session, scenario, body, completed: false, aborted: false };
    records.push(record);
    if (records.length > 500) records.shift();
    const requestNumber = records.filter((item) => item.session === session).length;
    response.on('close', () => {
      if (!record.completed) record.aborted = true;
    });
    const currentTools = body.messages
      .slice(lastUser + 1)
      .filter((message) => message.role === 'tool');
    const results = currentTools.map((message) => JSON.parse(message.content));
    const state = applicationData(body);
    if (scenario === 'provider-error' && requestNumber === 1) {
      record.completed = true;
      return json(response, { error: 'Intentional upstream outage' }, 503);
    }

    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    response.flushHeaders();
    const chunk = (delta, finish_reason = null) => {
      if (!response.destroyed)
        response.write(
          `data: ${JSON.stringify({ id: `completion-${session}`, object: 'chat.completion.chunk', model: 'pageway-e2e-model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
    };
    const finish = (reason, truncated = false) => {
      chunk({}, reason);
      if (!truncated) response.write('data: [DONE]\n\n');
      record.completed = true;
      response.end();
    };
    const text = async (value) => {
      chunk({ role: 'assistant' });
      // Stream multiple text deltas, including a reply with multibyte characters.
      for (const part of [value.slice(0, 7), value.slice(7)]) {
        chunk({ content: part });
        await sleep(35);
      }
      finish('stop');
    };
    const call = async (name, args, index = 0) => {
      const encoded = JSON.stringify(args);
      const split = Math.max(1, Math.floor(encoded.length / 2));
      chunk({
        tool_calls: [
          {
            index,
            id: `${session}-${requestNumber}-${name}-${index}`,
            type: 'function',
            function: { name, arguments: encoded.slice(0, split) },
          },
        ],
      });
      await sleep(35);
      chunk({ tool_calls: [{ index, function: { arguments: encoded.slice(split) } }] });
    };

    if (scenario === 'planning-cancel' || scenario === 'timeout') {
      chunk({ role: 'assistant' });
      const timer = setTimeout(() => {
        if (!response.destroyed) void text('This delayed response must not execute a page action.');
      }, 15_000);
      response.once('close', () => clearTimeout(timer));
      return;
    }

    await sleep(300);
    if (response.destroyed) return;
    if (scenario === 'workspace-tools') {
      if (!currentTools.length) {
        await call('filter_tasks', { priority: 'high' }, 0);
        await call('navigate_view', { view: 'list' }, 1);
        await call('inspect_page', {}, 2);
        return finish('tool_calls');
      }
      if (currentTools.length === 3) {
        const inspection = results[2]?.result;
        if (
          inspection?.filters.priority !== 'high' ||
          inspection?.view !== 'list' ||
          inspection?.visibleTaskIds.length !== 3
        )
          return text('ERROR: filtering or navigation did not reach current context.');
        await call('reset_filters', {}, 0);
        await call('navigate_view', { view: 'board' }, 1);
        return finish('tool_calls');
      }
      if (
        results.every((result) => result.ok) &&
        state.filters.priority === 'all' &&
        state.view === 'board' &&
        state.visibleTaskIds.length === 8
      )
        return text(
          'Filtered to 3 high-priority tasks, inspected the list, and restored all 8 tasks on the board.',
        );
      return text('ERROR: workspace restoration failed.');
    }
    if (scenario === 'multi') {
      if (!currentTools.length) {
        await call('create_task', { title: `First task ${session}`, priority: 'high' }, 0);
        await call('create_task', { title: `Second task ${session}`, priority: 'low' }, 1);
        return finish('tool_calls');
      }
      if (currentTools.length === 2) {
        await call('inspect_page', {});
        return finish('tool_calls');
      }
      const tasks = results[2]?.result?.tasks;
      const created = results.slice(0, 2).map((result) => result.result?.task?.id);
      if (
        !results.every((result) => result.ok) ||
        !tasks?.some((task) => task.id === created[0]) ||
        !tasks?.some((task) => task.id === created[1]) ||
        state.tasks.length !== 10
      )
        return text('ERROR: stale application context or tool results.');
      return text(`已确认 ${created.join(' and ')}；当前页面有 ${tasks.length} 个任务。`);
    }
    if (scenario === 'inspect') {
      if (!currentTools.length) {
        await call('inspect_page', {});
        return finish('tool_calls');
      }
      return text(
        `Current PW-103 status: ${results[0]?.result?.tasks?.find((task) => task.id === 'PW-103')?.status}.`,
      );
    }
    if (!currentTools.length) {
      await call('update_task', {
        id: scenario === 'tool-error' ? 'PW-404' : 'PW-103',
        status: 'done',
      });
      return finish('tool_calls', scenario === 'truncated');
    }
    const result = results.at(-1);
    if (scenario === 'tool-error') return text(`Page tool reported: ${result.error}`);
    const task = result?.result?.task;
    const actual = state.tasks.find((item) => item.id === 'PW-103');
    if (result.ok && task?.status === 'done' && actual?.status === 'done')
      return text(`已完成 ${task.id} → ${task.status}；页面执行结果与最新上下文一致。`);
    return text('ERROR: missing successful tool result or stale application context.');
  } catch (error) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    json(response, { error: error.message }, 500);
  }
});
server.listen(4182, '127.0.0.1', () => console.log('Pageway E2E model fixture listening on 4182'));
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => server.close(() => process.exit(0)));
