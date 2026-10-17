import { test, expect, openWorkspace, send, lockSelector } from './helpers';
import type { Page } from '@playwright/test';

type Frame = {
  phase: string | null;
  locked: boolean;
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
  route: string | null;
  highlight: boolean;
  feedback: boolean;
  animations: number;
};
declare global {
  interface Window {
    pagewayMotionFrames: Frame[];
    pagewayMotionTimer: ReturnType<typeof setInterval>;
  }
}

async function observeMotion(page: Page) {
  await page.evaluate(() => {
    window.pagewayMotionFrames = [];
    window.pagewayMotionTimer = setInterval(() => {
      const dialog = document.querySelector('dialog[data-pageway-lock="true"][open]');
      const cursor = dialog?.querySelector('.pw-agent-cursor');
      if (!dialog || !cursor || window.pagewayMotionFrames.length >= 1500) return;
      const rect = cursor.getBoundingClientRect();
      window.pagewayMotionFrames.push({
        phase: dialog.getAttribute('data-pageway-phase'),
        locked: dialog.matches(':modal'),
        x: rect.x,
        y: rect.y,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        route: dialog.querySelector('[data-pageway-route="active"]')?.getAttribute('d') ?? null,
        highlight: Boolean(dialog.querySelector('.pw-target-highlight')),
        feedback: Boolean(dialog.querySelector('.pw-step-feedback-success')),
        animations: cursor
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === 'running').length,
      });
    }, 16);
  });
}

async function collectMotion(page: Page) {
  return page.evaluate(() => {
    clearInterval(window.pagewayMotionTimer);
    return window.pagewayMotionFrames;
  });
}

test('the cursor travels a visible curved route, highlights the target, and acknowledges a completed action', async ({
  page,
}, testInfo) => {
  await openWorkspace(page);
  await observeMotion(page);
  await send(page);
  await expect(page.locator(`${lockSelector}[data-pageway-phase="moving"]`)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('moving.png') });
  await expect(page.locator(`${lockSelector}[data-pageway-phase="success"]`)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('success.png') });
  await expect(page.locator('.pw-message-assistant').last()).toContainText('已完成 PW-103 → done');
  await expect(page.locator(lockSelector)).toHaveCount(0);
  const frames = await collectMotion(page);
  await testInfo.attach('motion-observations', {
    body: JSON.stringify(frames, null, 2),
    contentType: 'application/json',
  });
  const moving = frames.filter((frame) => frame.phase === 'moving');
  expect(moving.length).toBeGreaterThan(5);
  expect(
    new Set(moving.map((frame) => `${Math.round(frame.x)},${Math.round(frame.y)}`)).size,
  ).toBeGreaterThan(4);
  expect(moving.some((frame) => frame.route?.includes('C'))).toBe(true);
  expect(frames.some((frame) => frame.phase === 'acting' && frame.highlight)).toBe(true);
  expect(
    frames.some((frame) => frame.phase === 'success' && frame.highlight && frame.feedback),
  ).toBe(true);
  expect(frames.every((frame) => frame.locked)).toBe(true);
  expect(
    moving.every(
      (frame) =>
        frame.x >= -32 &&
        frame.x <= frame.viewportWidth &&
        frame.y >= -32 &&
        frame.y <= frame.viewportHeight,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});

test('reduced motion keeps static target and completion feedback while executing the same tool round trip', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openWorkspace(page);
  await observeMotion(page);
  await send(page);
  await expect(page.locator('.pw-message-assistant').last()).toContainText('已完成 PW-103 → done');
  await expect(page.locator(lockSelector)).toHaveCount(0);
  const frames = await collectMotion(page);
  await testInfo.attach('reduced-motion-observations', {
    body: JSON.stringify(frames, null, 2),
    contentType: 'application/json',
  });
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.every((frame) => frame.animations === 0)).toBe(true);
  expect(frames.some((frame) => frame.phase === 'moving')).toBe(false);
  expect(
    frames.some((frame) => frame.phase === 'success' && frame.highlight && frame.feedback),
  ).toBe(true);
  await expect(page.getByRole('combobox', { name: 'PW-103 status', exact: true })).toHaveValue(
    'done',
  );
  await expect(page.locator('.pw-action.pw-is-success')).toHaveCount(1);
});
