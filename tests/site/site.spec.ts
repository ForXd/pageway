import { test, expect, openDemo, send, lockSelector, expectNoOverflow } from './helpers';

test('production docs load under the Pages subpath and copy the React and Agent examples', async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const response = await page.goto('./');
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle(/Pageway/i);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('homepage.png') });
  const scripts = await page
    .locator('script[src]')
    .evaluateAll((elements) =>
      elements.map((element) => new URL((element as HTMLScriptElement).src).pathname),
    );
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.every((path) => path.startsWith('/pageway/assets/'))).toBe(true);

  await page.getByRole('link', { name: 'React 接入', exact: true }).first().click();
  await expect(page).toHaveURL(/\/pageway\/#react$/);
  await expect(page.locator('#react .section-heading')).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('react-guide.png') });
  await page.getByRole('button', { name: '复制 React 接入示例', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('PagewayProvider');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('usePageTool');

  await page.getByRole('link', { name: 'Agent 接入', exact: true }).first().click();
  await expect(page).toHaveURL(/\/pageway\/#agent$/);
  await page.getByRole('button', { name: '复制 Agent 接入示例', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('createOpenAIProxyHandler');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('process.env');
  await page.reload();
  await expect(page.locator('#agent')).toBeInViewport();
  await expectNoOverflow(page);
});

test('a delayed entry bundle restores direct documentation links and reloads after React mounts', async ({
  page,
}) => {
  let delayedEntries = 0;
  // A cold CDN load must not depend on React committing before the browser's
  // initial fragment lookup. Routing also disables the HTTP cache on reload.
  await page.route('**/assets/main-*.js', async (route) => {
    delayedEntries += 1;
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });
  await page.goto('./#agent');
  await expect(page.locator('#agent .section-heading')).toBeInViewport();
  await page.reload();
  await expect(page.locator('#agent .section-heading')).toBeInViewport();
  expect(delayedEntries).toBe(2);
});

test('a visitor can start the embedded demo and open its standalone page', async ({ page }) => {
  await page.goto('./#demo');
  const standalone = page.getByRole('link', { name: '独立打开演示', exact: true });
  await expect(standalone).toHaveAttribute('href', '/pageway/demo/');
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: '启动交互演示', exact: true }).click();
  const demo = page.frameLocator('iframe[title="Pageway 任务看板交互演示"]');
  await expect(demo.getByText('OpenAI endpoint configured', { exact: true })).toBeVisible();
  await expect(demo.getByText('无需登录或 API Key', { exact: false })).toBeVisible();
  await expect(demo.getByRole('textbox', { name: 'Message Pageway' })).toBeVisible();
  const [standalonePage] = await Promise.all([page.waitForEvent('popup'), standalone.click()]);
  await expect(standalonePage).toHaveURL(/\/pageway\/demo\/$/);
  await expect(
    standalonePage.getByText('OpenAI endpoint configured', { exact: true }),
  ).toBeVisible();
  await standalonePage.close();
  await expectNoOverflow(page);
});

test('the static demo executes a page tool and returns its result to the local Agent without a server', async ({
  page,
  baseURL,
}) => {
  const networkAgentRequests: string[] = [];
  const origin = new URL(baseURL ?? 'http://127.0.0.1:4190').origin;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' ||
      /\/(?:api|local-agent)(?:\/|$)/.test(request.url()) ||
      new URL(request.url()).origin !== origin
    )
      networkAgentRequests.push(request.url());
  });
  await openDemo(page);
  await send(page, '将 PW-103 标记为完成');
  await expect(page.locator(`${lockSelector}[data-pageway-phase="moving"]`)).toBeVisible();
  await expect(page.locator(`${lockSelector} [data-pageway-route="active"]`)).toBeVisible();
  await expect(page.locator('.pw-message-assistant').last()).toContainText('页面已确认 1 项操作');
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'done',
  );
  const action = page.locator('.pw-action.pw-is-success');
  await expect(action).toHaveCount(1);
  await action.locator('summary').click();
  await expect(action.locator('pre').last()).toContainText('"status": "done"');
  await expect(action.locator('pre').last()).toContainText('"id": "PW-103"');

  // A fresh inspection runs after the mutation and reports updated React state.
  await send(page, '总结当前页面');
  await expect(page.locator('.pw-message-assistant').last()).toContainText('3 个已完成');
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.locator('.pw-action.pw-is-success')).toHaveCount(2);
  expect(networkAgentRequests, 'GitHub Pages needs no backend, model API or key').toEqual([]);
  await expectNoOverflow(page);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'in_progress',
  );
  await expect(page.locator('.pw-action')).toHaveCount(0);
});

test('the static demo locks interaction during the task and cancellation restores control', async ({
  page,
}) => {
  // Hold the executor before mutation so the keyboard and pointer assertions do
  // not race a 900 ms demo action on a busy CI runner. Motion has its own tests.
  await page.clock.install({ time: new Date('2030-01-01T08:00:00Z') });
  await openDemo(page);
  await page.clock.pauseAt(new Date('2030-01-01T10:00:00Z'));
  await send(page, '将 PW-103 标记为完成');
  await expect(page.locator(lockSelector)).toHaveAttribute('data-pageway-phase', 'acting');
  await page.clock.runFor(100);
  const lock = page.locator(`${lockSelector}[data-pageway-phase="moving"]`);
  await expect(lock).toBeVisible();
  expect(await lock.evaluate((element) => element.matches(':modal'))).toBe(true);
  await page.locator('input[aria-label="Search tasks"]').evaluate((element) => {
    (element as HTMLInputElement).focus();
  });
  await page.keyboard.type('blocked');
  await expect(page.locator('input[aria-label="Search tasks"]')).toHaveValue('');
  await page.locator('[data-pageway-stop]').click();
  await page.clock.resume();
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.locator('.pw-action.pw-is-cancelled')).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'in_progress',
  );
  await expect(page.getByRole('textbox', { name: 'Message Pageway' })).toBeEditable();
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Create a task' })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expectNoOverflow(page);
});

test('the local demo previews an exact deletion and applies it only after keyboard approval', async ({
  page,
}) => {
  await openDemo(page);
  await send(page, '删除 PW-105');
  const review = page.locator(`${lockSelector}[data-pageway-phase="awaiting-approval"]`);
  await expect(review).toBeVisible();
  await expect(review).toContainText('Delete PW-105?');
  await expect(review).toContainText('Review accessibility');
  await expect(review).toContainText('disappear from the board and list');
  await expect(review).toContainText('"id": "PW-105"');
  await expect(page.locator('#task-PW-105')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Reject action', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Approve this action', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.locator('#task-PW-105')).toHaveCount(0);
  await expect(page.locator('.pw-message-assistant').last()).toContainText('页面已确认 1 项操作');
  await expect(page.locator('.pw-action.pw-is-success')).toHaveCount(1);
  await send(page, '总结当前页面');
  await expect(page.locator('.pw-message-assistant').last()).toContainText('共有 7 个任务');
  await expectNoOverflow(page);
});

test('rejecting or stopping a deletion leaves the task intact and a refresh does not resume review', async ({
  page,
}) => {
  await openDemo(page);
  await send(page, 'Delete PW-105');
  await page.getByRole('button', { name: 'Reject action', exact: true }).click();
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.locator('#task-PW-105')).toHaveCount(1);
  await expect(page.locator('.pw-action.pw-is-rejected')).toHaveCount(1);
  await expect(page.locator('.pw-message-assistant').last()).toContainText('no automatic retry');

  await send(page, 'Delete PW-105');
  await expect(
    page.locator(`${lockSelector}[data-pageway-phase="awaiting-approval"]`),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.locator('#task-PW-105')).toHaveCount(1);
  await expect(page.locator('.pw-action.pw-is-cancelled')).toHaveCount(1);

  await send(page, 'Delete PW-105');
  await expect(
    page.locator(`${lockSelector}[data-pageway-phase="awaiting-approval"]`),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('#task-PW-105')).toHaveCount(1);
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.locator('[data-pageway-approve]')).toHaveCount(0);
  await expectNoOverflow(page);
});

test('agent edit permissions block mutations while filters remain available and optional review gates updates', async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole('checkbox', { name: 'Allow agent edits', exact: true }).uncheck();
  await send(page, 'Mark PW-103 as done');
  await expect(page.locator('.pw-message-assistant').last()).toContainText(
    'not made the required tools available',
  );
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'in_progress',
  );
  await expect(page.locator('.pw-action')).toHaveCount(0);
  await send(page, 'Show high priority tasks');
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Priority filter', exact: true })).toHaveValue(
    'high',
  );

  await page.getByRole('checkbox', { name: 'Allow agent edits', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Review every edit', exact: true }).check();
  await send(page, 'Mark PW-103 as done');
  const review = page.locator(`${lockSelector}[data-pageway-phase="awaiting-approval"]`);
  await expect(review).toContainText('Update PW-103?');
  await expect(review).toContainText('Connect the agent API');
  await expect(page.locator('select[aria-label="PW-103 status"]')).toHaveValue('in_progress');
  await page.getByRole('button', { name: 'Approve this action', exact: true }).click();
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'done',
  );
  await expectNoOverflow(page);
});

test('the public WebMCP-only workspace loads without a model endpoint and keeps unsupported browsers usable', async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'modelContext', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'modelContext', { configurable: true, value: undefined });
  });
  const network: string[] = [];
  const origin = new URL(baseURL ?? 'http://127.0.0.1:4190').origin;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' ||
      /\/api\//.test(request.url()) ||
      new URL(request.url()).origin !== origin
    )
      network.push(request.url());
  });
  const response = await page.goto('./webmcp/');
  expect(response?.ok()).toBe(true);
  await expect(page.getByText('WebMCP unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message Pageway' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'PW-103 status', exact: true }).selectOption('done');
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'done',
  );
  expect(network).toEqual([]);
  await expectNoOverflow(page);
});
