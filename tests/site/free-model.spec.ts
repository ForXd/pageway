import type { Route } from '@playwright/test';
import { FREE_MODEL, FREE_MODEL_ENDPOINT } from '../../apps/site/demo/free-model';
import { test, expect, send, lockSelector, expectNoOverflow } from './helpers';

type CompletionRequest = {
  model: string;
  stream: boolean;
  tool_choice: string;
  tools: { type: string; function: { name: string; parameters: unknown } }[];
  messages: {
    role: string;
    content: string | null;
    tool_call_id?: string;
    tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  }[];
};

function completionStream(delta: Record<string, unknown>, finishReason: string) {
  return [
    { choices: [{ index: 0, delta, finish_reason: null }], model: FREE_MODEL },
    { choices: [{ index: 0, delta: {}, finish_reason: finishReason }], model: FREE_MODEL },
  ]
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join('')
    .concat('data: [DONE]\n\n');
}

const toolReply = completionStream(
  {
    role: 'assistant',
    tool_calls: [
      {
        index: 0,
        id: 'site-free-update-103',
        type: 'function',
        function: {
          name: 'update_task',
          arguments: JSON.stringify({ id: 'PW-103', status: 'done' }),
        },
      },
    ],
  },
  'tool_calls',
);

test('the free-model demo sends standard anonymous requests and returns a real page-tool result', async ({
  page,
}) => {
  const requests: CompletionRequest[] = [];
  const requestHeaders: Record<string, string>[] = [];
  await page.route(FREE_MODEL_ENDPOINT, async (route) => {
    requests.push(route.request().postDataJSON() as CompletionRequest);
    requestHeaders.push(await route.request().allHeaders());
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body:
        requests.length === 1
          ? toolReply
          : completionStream(
              { role: 'assistant', content: 'PW-103 已完成，已收到页面回传结果。' },
              'stop',
            ),
    });
  });

  await page.goto('demo/');
  const modes = page.getByRole('region', { name: 'Demo mode' });
  await expect(page.getByText('OpenAI endpoint configured', { exact: true })).toBeVisible();
  await expect(modes.getByRole('button', { name: '免费模型', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(modes).toContainText('无需登录或 API Key');
  await expect(page.getByRole('textbox', { name: 'Message Pageway' })).toBeVisible();
  expect(requests, 'Loading the demo must not consume model quota').toHaveLength(0);

  await send(page, '将 PW-103 标记为完成');
  await expect(page.locator(lockSelector)).toBeVisible();
  await expect(
    page.getByRole('button', { name: '本地演示', exact: true, includeHidden: true }),
  ).toBeDisabled();
  await expect(page.locator('.pw-message-assistant').last()).toContainText(
    'PW-103 已完成，已收到页面回传结果。',
  );
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'done',
  );
  await expect(page.locator('.pw-action.pw-is-success')).toHaveCount(1);
  expect(requests).toHaveLength(2);
  expect(requestHeaders.every((headers) => !headers.authorization && !headers.cookie)).toBe(true);
  expect(requests[0]).toMatchObject({ model: FREE_MODEL, stream: true, tool_choice: 'auto' });
  expect(requests[0]).not.toHaveProperty('threadId');
  expect(requests[0]).not.toHaveProperty('runId');
  expect(requests[0]?.tools).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'function',
        function: expect.objectContaining({ name: 'update_task' }),
      }),
    ]),
  );
  const result = requests[1]?.messages.find((message) => message.role === 'tool');
  expect(result?.tool_call_id).toBe('site-free-update-103');
  if (typeof result?.content !== 'string') throw new Error('The tool result is missing.');
  expect(JSON.parse(result.content)).toMatchObject({
    ok: true,
    result: { task: { id: 'PW-103', status: 'done' } },
  });
  const system = requests[1]?.messages.find((message) => message.role === 'system')?.content;
  const context = system?.split('Current application data (JSON):\n')[1];
  if (!context) throw new Error('The updated page context is missing.');
  const state = JSON.parse(context) as {
    state: { page: { data: { tasks: { id: string; status: string }[] } }[] };
  };
  expect(state.state.page[0]?.data.tasks.find((task) => task.id === 'PW-103')?.status).toBe('done');

  // Switching is an explicit reset, so local actions cannot masquerade as a
  // successful response from the external model or reuse its conversation.
  await modes.getByRole('button', { name: '本地演示', exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/\?mode=local$/);
  await expect(page.getByText('Browser demo ready', { exact: true })).toBeVisible();
  await expect(page.locator('.pw-message')).toHaveCount(0);
  await expect(page.locator('.pw-action')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'in_progress',
  );
  await send(page, '将 PW-103 标记为完成');
  await expect(page.locator('.pw-message-assistant').last()).toContainText('页面已确认 1 项操作');
  await expect(page.locator(lockSelector)).toHaveCount(0);
  expect(requests).toHaveLength(2);
  await modes.getByRole('button', { name: '免费模型', exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/$/);
  await expect(page.locator('.pw-message')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'in_progress',
  );
  expect(requests).toHaveLength(2);
  await expectNoOverflow(page);
});

test('free-provider rate limits are visible and local fallback requires a visitor choice', async ({
  page,
}) => {
  let requests = 0;
  await page.route(FREE_MODEL_ENDPOINT, async (route) => {
    requests += 1;
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: { message: 'Anonymous free-model quota exhausted' } }),
    });
  });
  await page.goto('demo/');
  await send(page, '将 PW-103 标记为完成');
  await expect(page.getByText(/免费服务暂时不可用/)).toBeVisible();
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '免费模型', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page).toHaveURL(/\/demo\/$/);
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'in_progress',
  );
  await expect(page.locator('.pw-action.pw-is-success')).toHaveCount(0);
  await expect(page.locator('.pw-message-assistant')).toHaveCount(0);
  expect(requests).toBe(1);

  await page.getByRole('button', { name: '本地演示', exact: true }).click();
  await expect(page.getByText(/免费服务暂时不可用/)).toHaveCount(0);
  await expect(page.getByText('Browser demo ready', { exact: true })).toBeVisible();
  await send(page, '将 PW-103 标记为完成');
  await expect(page.locator('.pw-message-assistant').last()).toContainText('页面已确认 1 项操作');
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'done',
  );
  expect(requests).toBe(1);
  await expectNoOverflow(page);
});

test('stopping a pending free-model request aborts it and restores the page and mode controls', async ({
  page,
}) => {
  let pending: Route | undefined;
  let requests = 0;
  await page.route(FREE_MODEL_ENDPOINT, (route) => {
    requests += 1;
    pending = route;
  });
  await page.goto('demo/');
  await send(page, '将 PW-103 标记为完成');
  await expect.poll(() => requests).toBe(1);
  await expect(page.locator(lockSelector)).toBeVisible();
  await expect(
    page.getByRole('button', { name: '免费模型', exact: true, includeHidden: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '本地演示', exact: true, includeHidden: true }),
  ).toBeDisabled();
  const aborted = page.waitForEvent('requestfailed', {
    predicate: (request) => request.url() === FREE_MODEL_ENDPOINT,
  });
  await page.locator('[data-pageway-stop]').click();
  expect((await aborted).failure()?.errorText).toContain('ERR_ABORTED');
  await pending?.abort();
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message Pageway' })).toBeEditable();
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'in_progress',
  );
  await expect(page.locator('.pw-action')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '本地演示', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '本地演示', exact: true }).click();
  await expect(page.getByText('Browser demo ready', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});
