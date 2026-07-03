import { type Page, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Shared assertions for the v2 premium specs (login/premium/legal/guardrails)
// -- factored out of smoke.spec.ts's local helper of the same intent so the
// new v2 surface doesn't duplicate it a third and fourth time. smoke.spec.ts
// itself is left untouched (it already passes; no reason to risk it).

/** Structural/compliance assertions every page must satisfy regardless of
 *  route or auth state (ARCHITECTURE.md §13; DESIGN.md §2). Assumes `page`
 *  has already navigated. */
export async function expectLandmarksAndCompliance(page: Page) {
  const banner = page.locator('[role="region"][aria-label="Compliance disclaimer"]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('not betting advice');
  await expect(banner).toContainText('18+');

  const footer = page.locator('footer');
  await expect(footer).toContainText('not betting advice');

  const primaryNav = page.locator('nav[aria-label="Primary"]');
  await expect(primaryNav).toBeVisible();

  await expect(page.locator('h1')).toHaveCount(1);

  // No team crests, player photos, or any other <img> (ARCHITECTURE.md §13):
  // plain-text team names only, everywhere, including the new v2 surface.
  await expect(page.locator('img')).toHaveCount(0);
}

/** No serious/critical axe violations on the current page (WCAG 2.0/2.1
 *  A/AA) -- same tag set and severity floor as smoke.spec.ts. */
export async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const seriousOrWorse = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  const report = seriousOrWorse
    .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
    .join('\n');
  expect(seriousOrWorse, `a11y violations:\n${report}`).toEqual([]);
}

/** Navigate to `path` and assert a non-error status, no uncaught page errors,
 *  and no console errors -- the runtime half of every smoke test in this repo. */
export async function gotoAndExpectNoRuntimeErrors(page: Page, path: string) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const response = await page.goto(path, { waitUntil: 'load' });
  expect(
    response?.status() ?? 0,
    `${path} should return a non-error HTTP status`,
  ).toBeLessThan(400);

  expect(pageErrors, `uncaught page errors on ${path}`).toEqual([]);
  expect(consoleErrors, `console errors on ${path}`).toEqual([]);
  return response;
}
