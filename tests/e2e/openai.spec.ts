import { test, expect, send, requests, contextData, lockSelector, expectUnlocked } from './helpers';

const storageKey = 'pageway:playground:local-demo:v1';

test('standard OpenAI proxy completes a page tool round trip and cached history reloads without replaying actions', async ({
  page,
  request,
}) => {
  const apiRequests: { path: string; body: Record<string, unknown> }[] = [];
  page.on('request', (current) => {
    if (new URL(current.url()).pathname.startsWith('/api/') && current.method() === 'POST')
      apiRequests.push({ path: new URL(current.url()).pathname, body: current.postDataJSON() });
  });
  await page.goto('/openai.html');
  await expect(page.getByText('OpenAI endpoint configured', { exact: true })).toBeVisible();
  const { session, message } = await send(page);
  await expect(page.locator(lockSelector)).toBeVisible();
  await expect(page.locator('.pw-message-assistant').last()).toContainText('已完成 PW-103 → done');
  await expectUnlocked(page);
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'done',
  );
  expect(apiRequests).toHaveLength(2);
  expect(apiRequests.every((item) => item.path === '/api/openai/chat/completions')).toBe(true);
  expect(apiRequests[0]!.body).toMatchObject({ model: 'pageway-e2e-model', stream: true });
  expect(apiRequests[0]!.body).not.toHaveProperty('threadId');
  const upstream = await requests(request, session);
  expect(upstream).toHaveLength(2);
  expect(contextData(upstream[1]!).tasks.find((task) => task.id === 'PW-103')!.status).toBe('done');
  const toolResult = upstream[1]!.body.messages.find((entry) => entry.role === 'tool')!;
  expect(JSON.parse(toolResult.content)).toMatchObject({
    ok: true,
    result: { task: { id: 'PW-103', status: 'done' } },
  });
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
  expect(
    saved.state.messages.some((entry: { content?: string }) => entry.content === message),
  ).toBe(true);

  await page.reload();
  await expect(page.locator('.pw-message-user')).toContainText(message);
  await expect(page.locator('.pw-message-assistant').last()).toContainText('已完成 PW-103 → done');
  await expect(page.locator('.pw-action.pw-is-success')).toHaveCount(1);
  await expect(page.locator(lockSelector)).toHaveCount(0);
  // Conversation history persists; the application's task state remains application-owned.
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'in_progress',
  );
  expect(apiRequests).toHaveLength(2);
  expect(await requests(request, session)).toHaveLength(2);
  const inspection = await send(page, 'inspect');
  await expect(page.locator('.pw-message-assistant').last()).toContainText(
    'Current PW-103 status: in_progress.',
  );
  const inspected = await requests(request, inspection.session);
  expect(inspected[0]!.body.messages.some((entry) => entry.content === message)).toBe(true);
  expect(contextData(inspected[0]!).tasks.find((task) => task.id === 'PW-103')!.status).toBe(
    'in_progress',
  );
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear conversation', exact: true }).click();
  await expect(page.locator('.pw-message')).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Message Pageway' })).toBeVisible();
  await expect(page.locator('.pw-message')).toHaveCount(0);
  await expect(page.locator('.pw-action')).toHaveCount(0);
  expect(apiRequests).toHaveLength(4);
});

test('stopping a direct OpenAI request cancels the upstream proxy and does not resume after reload', async ({
  page,
  request,
}) => {
  await page.goto('/openai.html');
  const { session, message } = await send(page, 'planning-cancel');
  await expect.poll(async () => (await requests(request, session)).length).toBe(1);
  await expect(page.locator(lockSelector)).toBeVisible();
  await page.locator('[data-pageway-stop]').click();
  await expectUnlocked(page);
  await expect.poll(async () => (await requests(request, session))[0]?.aborted).toBe(true);
  await page.reload();
  await expect(page.locator('.pw-message-user')).toContainText(message);
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'in_progress',
  );
  expect(await requests(request, session)).toHaveLength(1);
});

test('reloading an active conversation checkpoints its latest message and cancels without replaying the task', async ({
  page,
  request,
}) => {
  await page.goto('/openai.html');
  const { session, message } = await send(page, 'planning-cancel');
  await expect.poll(async () => (await requests(request, session)).length).toBe(1);
  await expect(page.locator(lockSelector)).toBeVisible();
  // Closing/reloading the page must save the active turn without requiring Stop.
  await page.reload();
  await expect(page.locator('.pw-message-user')).toContainText(message);
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message Pageway' })).toBeEditable();
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'in_progress',
  );
  await expect.poll(async () => (await requests(request, session))[0]?.aborted).toBe(true);
  expect(await requests(request, session)).toHaveLength(1);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
  expect(
    saved.state.messages.some((entry: { content?: string }) => entry.content === message),
  ).toBe(true);
  await expect(page.locator('.pw-action')).toHaveCount(0);
});

test('denied localStorage writes do not prevent a standard model conversation or page action', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage disabled for this test', 'QuotaExceededError');
    };
  });
  await page.goto('/openai.html');
  await send(page);
  await expect(page.locator('.pw-message-assistant').last()).toContainText('已完成 PW-103 → done');
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'done',
  );
  await expectUnlocked(page);
});
