import { randomUUID } from 'node:crypto';
import { expect, test as base, type Page, type APIRequestContext } from '@playwright/test';

export type ModelRequest = {
  session: string;
  scenario: string;
  completed: boolean;
  aborted: boolean;
  body: {
    model: string;
    stream: boolean;
    tool_choice: string;
    tools: { function: { name: string } }[];
    messages: {
      role: string;
      content: string;
      tool_calls?: { id: string; function: { name: string; arguments: string } }[];
      tool_call_id?: string;
    }[];
  };
};
export const lockSelector = 'dialog[data-pageway-lock="true"][open]';
export const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [
    async ({ page, context }, use) => {
      const errors: string[] = [];
      // The Google Fonts import uses system fallbacks in CI. No browser request
      // leaves localhost, while application/API requests are passed through.
      await context.route('**/*', (route) =>
        new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
      );
      page.on('pageerror', (error) => errors.push(error.message));
      await use(errors);
      expect(errors, 'No uncaught browser errors').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function openWorkspace(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Agent connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message Pageway' })).toBeVisible();
  await expect(page.locator('#task-PW-103')).toHaveCount(1);
}

export async function send(page: Page, scenario = 'roundtrip', session = randomUUID()) {
  const message = `[e2e:${session}:${scenario}] Please operate this workspace and confirm the execution result.`;
  await page.getByRole('textbox', { name: 'Message Pageway' }).fill(message);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  return { session, message };
}

export async function requests(
  request: APIRequestContext,
  session: string,
): Promise<ModelRequest[]> {
  const response = await request.get(`http://127.0.0.1:4182/requests/${session}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

export function contextData(request: ModelRequest) {
  const system = request.body.messages.find((message) => message.role === 'system')!.content;
  return JSON.parse(system.split('Current application data (JSON):\n')[1]!).state.page[0].data as {
    tasks: { id: string; status: string; title: string }[];
    filters: { priority: string; status: string; query: string };
    view: string;
  };
}

export async function expectUnlocked(page: Page) {
  await expect(page.locator(lockSelector)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message Pageway' })).toBeEditable();
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Create a task' })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
}
