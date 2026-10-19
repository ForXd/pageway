import { test, expect, lockSelector } from './helpers';
import type { Page } from '@playwright/test';

type Result = { ok: boolean; result?: unknown; error?: string };
type FixtureTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<Result>;
};
declare global {
  interface Window {
    pagewayWebMCPFixture: {
      tools: Map<string, FixtureTool>;
      signals: AbortSignal[];
      controller?: AbortController;
      pending?: Promise<Result>;
    };
  }
}

/** Test fixture for the browser's document.modelContext contract, not a WebMCP polyfill. */
async function installWebMCPFixture(page: Page) {
  await page.addInitScript(() => {
    const fixture = { tools: new Map<string, FixtureTool>(), signals: [] as AbortSignal[] };
    window.pagewayWebMCPFixture = fixture;
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        registerTool(tool: FixtureTool, options: { signal: AbortSignal }) {
          if (fixture.tools.has(tool.name)) throw new Error(`Duplicate registration: ${tool.name}`);
          if (options.signal.aborted) return;
          fixture.tools.set(tool.name, tool);
          fixture.signals.push(options.signal);
          options.signal.addEventListener(
            'abort',
            () => {
              if (fixture.tools.get(tool.name) === tool) fixture.tools.delete(tool.name);
            },
            { once: true },
          );
        },
      },
    });
  });
}

async function startExternalAction(page: Page) {
  await page.evaluate(() => {
    const fixture = window.pagewayWebMCPFixture;
    fixture.controller = new AbortController();
    fixture.pending = fixture.tools
      .get('pageway_update_task')!
      .execute({ id: 'PW-103', status: 'done' }, { signal: fixture.controller.signal });
  });
}

test('an external WebMCP agent discovers context, updates the real page with animation and gets a result without any backend', async ({
  page,
}) => {
  await installWebMCPFixture(page);
  const apiCalls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url());
  });
  await page.goto('/webmcp.html');
  await expect(page.getByText('WebMCP tools ready', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message Pageway' })).toHaveCount(0);
  expect(await page.evaluate(() => [...window.pagewayWebMCPFixture.tools.keys()])).toEqual(
    expect.arrayContaining(['pageway_get_context', 'pageway_inspect_page', 'pageway_update_task']),
  );
  expect(await page.evaluate(() => window.pagewayWebMCPFixture.tools.size)).toBe(7);
  const context = await page.evaluate(() =>
    window.pagewayWebMCPFixture.tools.get('pageway_get_context')!.execute({}),
  );
  expect(context).toMatchObject({
    ok: true,
    result: { page: [{ id: 'workspace', data: { tasks: expect.any(Array) } }] },
  });
  const newTask = await page.getByRole('button', { name: 'New task', exact: true }).boundingBox();
  await startExternalAction(page);
  await expect(page.locator(`${lockSelector}[data-pageway-phase="moving"]`)).toBeVisible();
  await expect
    .poll(() => page.locator(lockSelector).evaluate((element) => element.matches(':modal')))
    .toBe(true);
  await page.mouse.click(newTask!.x + newTask!.width / 2, newTask!.y + newTask!.height / 2);
  await expect(page.getByRole('dialog', { name: 'Create a task' })).toHaveCount(0);
  await expect(page.locator('.pw-agent-cursor')).toBeVisible();
  const result = await page.evaluate(() => window.pagewayWebMCPFixture.pending);
  expect(result).toMatchObject({ ok: true, result: { task: { id: 'PW-103', status: 'done' } } });
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'done',
  );
  await expect(page.locator('.pw-action.pw-is-success')).toHaveCount(1);
  const fresh = await page.evaluate(() =>
    window.pagewayWebMCPFixture.tools.get('pageway_get_context')!.execute({}),
  );
  expect(fresh).toMatchObject({
    ok: true,
    result: {
      page: [
        {
          data: {
            tasks: expect.arrayContaining([
              expect.objectContaining({ id: 'PW-103', status: 'done' }),
            ]),
          },
        },
      ],
    },
  });
  expect(apiCalls).toEqual([]);
});

test('the user and an external agent can cancel WebMCP operations before mutation and recover the workspace', async ({
  page,
}) => {
  // Exercise cancellation while the executor is held before mutation; a slower
  // Linux WebKit renderer must not turn this into a race against a 900 ms timer.
  await page.clock.install({ time: new Date('2030-01-01T08:00:00Z') });
  await installWebMCPFixture(page);
  await page.goto('/webmcp.html');
  await expect(page.getByText('WebMCP tools ready', { exact: true })).toBeVisible();
  await page.clock.pauseAt(new Date('2030-01-01T10:00:00Z'));
  for (const source of ['user', 'agent']) {
    await startExternalAction(page);
    await expect(page.locator(lockSelector)).toHaveAttribute('data-pageway-phase', 'acting');
    await page.clock.runFor(100);
    await expect(page.locator(`${lockSelector}[data-pageway-phase="moving"]`)).toBeVisible();
    if (source === 'user') await page.locator('[data-pageway-stop]').click();
    else await page.evaluate(() => window.pagewayWebMCPFixture.controller!.abort());
    const result = await page.evaluate(() => window.pagewayWebMCPFixture.pending);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/cancel/i) });
    await expect(page.locator(lockSelector)).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
      'in_progress',
    );
  }
  await page.clock.resume();
  await expect(page.locator('.pw-action.pw-is-cancelled')).toHaveCount(2);
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Create a task' })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
});

test('a browser without WebMCP keeps the page usable and reports capability availability honestly', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'modelContext', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'modelContext', { configurable: true, value: undefined });
  });
  await page.goto('/webmcp.html');
  await expect(page.getByText('WebMCP unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('does not expose WebMCP');
  await expect(page.getByRole('textbox', { name: 'Message Pageway' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'PW-103 status', exact: true }).selectOption('done');
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'done',
  );
});
