import {
  test,
  expect,
  openWorkspace,
  send,
  requests,
  lockSelector,
  expectUnlocked,
  contextData,
} from './helpers';

test('locks pointer, keyboard and scrolling during model planning; Stop aborts upstream and restores interaction', async ({
  page,
  request,
}) => {
  await openWorkspace(page);
  const newTask = await page.getByRole('button', { name: 'New task', exact: true }).boundingBox();
  const previousOverflow = await page.evaluate(() => ({
    body: document.body.style.overflow,
    root: document.documentElement.style.overflow,
  }));
  const { session } = await send(page, 'planning-cancel');
  await expect.poll(async () => (await requests(request, session)).length).toBe(1);
  await expect(page.locator(`${lockSelector}[data-pageway-phase="planning"]`)).toBeVisible();
  await expect(page.locator('[data-pageway-stop]')).toBeFocused();
  await page.mouse.click(newTask!.x + newTask!.width / 2, newTask!.y + newTask!.height / 2);
  await expect(page.getByRole('dialog', { name: 'Create a task' })).toHaveCount(0);
  await page
    .getByRole('textbox', { name: 'Search tasks', includeHidden: true })
    .evaluate((element) => (element as HTMLInputElement).focus());
  await page.keyboard.type('blocked editing');
  await expect(page.locator('input[aria-label="Search tasks"]')).toHaveValue('');
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-pageway-stop]')).toBeFocused();
  const scrollBefore = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(scrollBefore);
  await page.locator('[data-pageway-stop]').click();
  await expectUnlocked(page);
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'in_progress',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(async () => (await requests(request, session))[0]?.aborted).toBe(true);
  expect(
    await page.evaluate(() => ({
      body: document.body.style.overflow,
      root: document.documentElement.style.overflow,
    })),
  ).toEqual(previousOverflow);
});

test('Escape cancels while travelling before mutation; the next request retains valid cancelled tool history', async ({
  page,
  request,
}) => {
  await openWorkspace(page);
  const { session } = await send(page, 'moving-cancel');
  await expect(page.locator(`${lockSelector}[data-pageway-phase="moving"]`)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.locator('.pw-action.pw-is-cancelled')).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'in_progress',
  );
  await send(page, 'roundtrip', session);
  await expect(page.locator('.pw-message-assistant').last()).toContainText('已完成 PW-103 → done');
  const upstream = await requests(request, session);
  const cancelled = upstream[1]!.body.messages.find((message) => message.role === 'tool');
  expect(JSON.parse(cancelled!.content)).toMatchObject({ ok: false, error: 'Cancelled by user.' });
  await expectUnlocked(page);
});

test('an upstream HTTP error unlocks the page and Edit and try again completes successfully', async ({
  page,
  request,
}) => {
  await openWorkspace(page);
  const { session, message } = await send(page, 'provider-error');
  await expect(page.getByRole('alert')).toContainText('HTTP 503');
  await expectUnlocked(page);
  await page.getByRole('button', { name: 'Edit and try again' }).click();
  await expect(page.getByRole('textbox', { name: 'Message Pageway' })).toHaveValue(message);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.pw-message-assistant').last()).toContainText('已完成 PW-103 → done');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await requests(request, session)).toHaveLength(3);
});

test('a truncated provider stream cannot execute the proposed mutation and releases the lock', async ({
  page,
  request,
}) => {
  await openWorkspace(page);
  const { session } = await send(page, 'truncated');
  await expect(page.getByRole('alert')).toContainText('before its completion marker');
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'in_progress',
  );
  await expect(page.locator('.pw-action.pw-is-success')).toHaveCount(0);
  expect(await requests(request, session)).toHaveLength(1);
  await expectUnlocked(page);
});

test('browser tool errors are returned to the model and shown in the action trail without claiming success', async ({
  page,
  request,
}) => {
  await openWorkspace(page);
  const { session } = await send(page, 'tool-error');
  await expect(page.locator('.pw-message-assistant').last()).toContainText(
    'Page tool reported: Task PW-404 does not exist.',
  );
  await expect(page.locator('.pw-action.pw-is-error')).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'in_progress',
  );
  const upstream = await requests(request, session);
  expect(upstream).toHaveLength(2);
  expect(
    JSON.parse(upstream[1]!.body.messages.find((message) => message.role === 'tool')!.content),
  ).toEqual({ ok: false, error: 'Task PW-404 does not exist.' });
  await expectUnlocked(page);
});

test('a timed-out provider stream aborts upstream and restores the page', async ({
  page,
  request,
}) => {
  await openWorkspace(page);
  const { session } = await send(page, 'timeout');
  await expect(page.locator(lockSelector)).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('timed out', { timeout: 12_000 });
  await expect.poll(async () => (await requests(request, session))[0]?.aborted).toBe(true);
  await expectUnlocked(page);
});

test('clearing a conversation starts a new thread while preserving the current workspace state', async ({
  page,
  request,
}) => {
  const agentRequests: { threadId: string; messages: { role: string }[] }[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/agent') && request.method() === 'POST')
      agentRequests.push(request.postDataJSON());
  });
  await openWorkspace(page);
  await send(page);
  await expect(page.locator('.pw-message-assistant').last()).toContainText('已完成 PW-103 → done');
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear conversation', exact: true }).click();
  await expect(page.locator('.pw-message')).toHaveCount(0);
  await expect(page.locator('.pw-action')).toHaveCount(0);
  const { session } = await send(page, 'inspect');
  await expect(page.locator('.pw-message-assistant').last()).toContainText(
    'Current PW-103 status: done.',
  );
  const upstream = await requests(request, session);
  expect(upstream[0]!.body.messages.map((message) => message.role)).toEqual(['system', 'user']);
  expect(contextData(upstream[0]!).tasks.find((task) => task.id === 'PW-103')!.status).toBe('done');
  expect(agentRequests[0]!.threadId).not.toBe(agentRequests[2]!.threadId);
});
