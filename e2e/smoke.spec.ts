import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Smoke + accessibility coverage for the statically-prerendered, DB-free pages.
// These render identically with or without a database (confirmed: they build
// clean against a dummy Supabase URL), so they're safe to assert on in CI
// without seeded data.
//
// The dynamic, DB-backed routes — /match/[id], /team/[slug], /league/[slug] —
// are intentionally NOT here yet: they need a deterministic local Supabase +
// seed fixtures to test meaningfully (Tier 2).
const STATIC_PAGES = ['/', '/about', '/ledger', '/responsible-gambling'];

for (const path of STATIC_PAGES) {
  test(`${path} renders with no runtime errors`, async ({ page }) => {
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

    // Each page has a single visible top-level heading.
    await expect(page.locator('h1')).toBeVisible();

    expect(pageErrors, `uncaught page errors on ${path}`).toEqual([]);
    expect(consoleErrors, `console errors on ${path}`).toEqual([]);
  });

  test(`${path} has no serious or critical a11y violations`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const seriousOrWorse = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    const report = seriousOrWorse
      .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
      .join('\n');
    expect(seriousOrWorse, `a11y violations on ${path}:\n${report}`).toEqual([]);
  });
}
