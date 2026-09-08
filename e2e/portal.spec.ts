import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://api.anthropic.com/**', (route) => route.abort());
});

test('logged-in administrator can navigate the dashboard without accessibility violations', async ({
  page,
}) => {
  const browserErrors: string[] = [];
  const unexpectedWrites: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.startsWith('/api/') &&
      request.method() !== 'GET'
    )
      unexpectedWrites.push(
        `${request.method()} ${new URL(request.url()).pathname}`,
      );
  });

  await page.goto('/signin-with-chatgpt?return_to=/');
  const baselineChoice = page.getByRole('button', {
    name: '가상 예시 데이터 선택',
  });
  await baselineChoice.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if (await baselineChoice.isVisible()) await baselineChoice.click();
  await expect(
    page.getByRole('heading', { name: '오늘의 협업 진행현황' }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('김성민 대표').first()).toBeVisible();

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await page
    .getByRole('button', { name: 'AI 진단 사전점검' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'AI 진단 사전점검' }),
  ).toBeVisible();
  await expect(page.getByText('운영 외부 AI 처리')).toBeVisible();
  await expect(page.getByText('중지', { exact: true })).toBeVisible();
  expect(browserErrors).toEqual([]);
  expect(
    unexpectedWrites.every((request) => request === 'PUT /api/state'),
  ).toBe(true);
  expect(unexpectedWrites.length).toBeLessThanOrEqual(1);
});
