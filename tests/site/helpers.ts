import { expect, test as base, type Page } from '@playwright/test';

export const lockSelector = 'dialog[data-pageway-lock="true"][open]';

export const test = base.extend<{ siteErrors: string[] }>({
  siteErrors: [
    async ({ page, baseURL }, use) => {
      const errors: string[] = [];
      const origin = new URL(baseURL ?? 'http://127.0.0.1:4190').origin;
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        const url = message.location().url;
        if (message.type() === 'error' && (!url || url.startsWith(origin)))
          errors.push(message.text());
      });
      page.on('response', (response) => {
        if (response.url().startsWith(origin) && response.status() >= 400)
          errors.push(`${response.status()} ${response.url()}`);
      });
      page.on('requestfailed', (request) => {
        if (request.url().startsWith(origin) && request.failure()?.errorText !== 'net::ERR_ABORTED')
          errors.push(`${request.failure()?.errorText} ${request.url()}`);
      });
      await use(errors);
      expect(errors, 'No runtime errors or broken same-origin production assets').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function openDemo(page: Page) {
  const response = await page.goto('demo/');
  expect(response?.ok()).toBe(true);
  await expect(page.getByText('Browser demo ready', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message Pageway' })).toBeVisible();
}

export async function send(page: Page, message: string) {
  await page.getByRole('textbox', { name: 'Message Pageway' }).fill(message);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
}

export async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}
