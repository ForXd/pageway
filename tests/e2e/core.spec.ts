import {
  test,
  expect,
  openWorkspace,
  send,
  requests,
  contextData,
  lockSelector,
  expectUnlocked,
} from './helpers';

test('streams through the real HTTP agent, executes a browser tool, and returns its result with fresh context', async ({
  page,
  request,
}) => {
  const agentRequests: Record<string, unknown>[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/agent') && request.method() === 'POST')
      agentRequests.push(request.postDataJSON());
  });
  await openWorkspace(page);
  const { session } = await send(page);
  await expect(page.locator(lockSelector)).toBeVisible();
  await expect
    .poll(() => page.locator(lockSelector).evaluate((element) => element.matches(':modal')))
    .toBe(true);
  await expect(page.locator('.pw-message-assistant').last()).toContainText('已完成 PW-103 → done');
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'done',
  );
  await expect(page.locator('.pw-action.pw-is-success')).toHaveCount(1);
  await expectUnlocked(page);

  const upstream = await requests(request, session);
  expect(upstream).toHaveLength(2);
  expect(
    upstream.every((item) => item.body.model === 'pageway-e2e-model' && item.body.stream),
  ).toBe(true);
  expect(upstream[0]!.body.tools.map((tool) => tool.function.name)).toEqual(
    expect.arrayContaining(['inspect_page', 'update_task', 'create_task']),
  );
  expect(contextData(upstream[0]!).tasks.find((task) => task.id === 'PW-103')!.status).toBe(
    'in_progress',
  );
  const continuation = upstream[1]!;
  const assistant = continuation.body.messages.find((message) => message.tool_calls?.length);
  const result = continuation.body.messages.find((message) => message.role === 'tool');
  expect(result!.tool_call_id).toBe(assistant!.tool_calls![0]!.id);
  expect(JSON.parse(result!.content)).toMatchObject({
    ok: true,
    result: { task: { id: 'PW-103', status: 'done' } },
  });
  expect(contextData(continuation).tasks.find((task) => task.id === 'PW-103')!.status).toBe('done');
  expect(agentRequests).toHaveLength(2);
  expect(agentRequests[0]!.threadId).toBe(agentRequests[1]!.threadId);
  expect(agentRequests[0]!.runId).not.toBe(agentRequests[1]!.runId);
});

test('sequential page tools use fresh React state and a subsequent model round can inspect both new tasks', async ({
  page,
  request,
}) => {
  await openWorkspace(page);
  const { session } = await send(page, 'multi');
  await expect(page.locator('.pw-message-assistant').last()).toContainText(
    '已确认 PW-109 and PW-110；当前页面有 10 个任务。',
  );
  await expect(page.locator('#task-PW-109')).toContainText(`First task ${session}`);
  await expect(page.locator('#task-PW-110')).toContainText(`Second task ${session}`);
  await expect(page.locator('.pw-action.pw-is-success')).toHaveCount(3);
  await expect(page.locator(lockSelector)).toHaveCount(0);
  const upstream = await requests(request, session);
  expect(upstream).toHaveLength(3);
  const returned = upstream[1]!.body.messages
    .filter((message) => message.role === 'tool')
    .map((message) => JSON.parse(message.content));
  expect(returned.map((item) => item.result.task.id)).toEqual(['PW-109', 'PW-110']);
  expect(contextData(upstream[1]!).tasks).toHaveLength(10);
  const inspection = JSON.parse(
    upstream[2]!.body.messages.filter((message) => message.role === 'tool').at(-1)!.content,
  );
  expect(inspection.result.tasks.map((task: { id: string }) => task.id)).toEqual(
    expect.arrayContaining(['PW-109', 'PW-110']),
  );
  await page.getByRole('combobox', { name: 'PW-109 status', exact: true }).selectOption('done');
  await expect(page.getByRole('combobox', { name: 'PW-109 status', exact: true })).toHaveValue(
    'done',
  );
});
