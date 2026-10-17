import { test, expect, openWorkspace, send, requests, contextData, lockSelector } from './helpers';

test('filter, navigate, inspect and reset tools publish the visible workspace and keep a complete event trail', async ({
  page,
  request,
}) => {
  await openWorkspace(page);
  const { session } = await send(page, 'workspace-tools');
  await expect(page.locator('.pw-message-assistant').last()).toContainText(
    'Filtered to 3 high-priority tasks, inspected the list, and restored all 8 tasks on the board.',
    { timeout: 25_000 },
  );
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Priority filter' })).toHaveValue('all');
  await expect(page.getByRole('button', { name: 'Board view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.task-card')).toHaveCount(8);
  await expect(page.locator('.pw-action.pw-is-success')).toHaveCount(5);
  const upstream = await requests(request, session);
  expect(upstream).toHaveLength(3);
  expect(contextData(upstream[1]!)).toMatchObject({ filters: { priority: 'high' }, view: 'list' });
  const inspection = JSON.parse(
    upstream[1]!.body.messages.filter((message) => message.role === 'tool').at(-1)!.content,
  );
  expect(inspection).toMatchObject({
    ok: true,
    result: {
      filters: { priority: 'high' },
      view: 'list',
      visibleTaskIds: ['PW-101', 'PW-103', 'PW-106'],
    },
  });
  expect(contextData(upstream[2]!)).toMatchObject({ filters: { priority: 'all' }, view: 'board' });
  await page.getByRole('button', { name: 'Event stream', exact: true }).click();
  await expect(page.locator('.event-row summary').filter({ hasText: 'RUN_STARTED' })).toHaveCount(
    3,
  );
  await expect(page.locator('.event-row summary').filter({ hasText: 'RUN_FINISHED' })).toHaveCount(
    3,
  );
  await expect(page.locator('.event-row summary').filter({ hasText: 'TOOL_CALL_END' })).toHaveCount(
    5,
  );
});
