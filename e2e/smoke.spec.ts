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

// ── Home page structural invariants ─────────────────────────────────────────
// These hold in any data state (populated / live / empty) because they come
// from the static layout — not from DB rows. The shared webServer renders the
// home page with PREVIEW_HOMEPAGE=1 (playwright.config.ts), so the populated
// hero + ProbabilityBars are exercised here too, not just the empty state.
test('/ has correct landmark structure and data-state-independent semantics', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'load' });

  // Compliance: the disclaimer banner is present and carries the compliance text.
  const banner = page.locator('[role="note"][aria-label="Compliance disclaimer"]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('not betting advice');
  await expect(banner).toContainText('18+');

  // Compliance: the footer repeats the disclaimer (ARCHITECTURE.md §13).
  const footer = page.locator('footer');
  await expect(footer).toContainText('not betting advice');

  // Primary nav landmark exists and is labelled.
  const primaryNav = page.locator('nav[aria-label="Primary"]');
  await expect(primaryNav).toBeVisible();

  // Heading order: h1 is present and unique; all labelled sections exist as h2.
  await expect(page.locator('h1')).toHaveCount(1);
  // The five named sections each get a visible or sr-only h2 via SectionHeader
  // or an inline element — at least four named h2s must be present.
  const namedSections = page.locator('section[aria-labelledby]');
  await expect(namedSections).toHaveCount(5);

  // ProbabilityBar uses role=img with a descriptive aria-label naming all three
  // outcomes (DESIGN.md §2: colour is never the sole signal). With preview data
  // the populated hero guarantees at least one bar, so the contract is actually
  // enforced rather than skipped.
  const probBars = page.locator('[role="img"][aria-label^="Win probability"]');
  const barCount = await probBars.count();
  expect(
    barCount,
    'populated home page should render at least one probability bar',
  ).toBeGreaterThan(0);
  for (let i = 0; i < barCount; i++) {
    const label = await probBars.nth(i).getAttribute('aria-label');
    expect(label, `ProbabilityBar[${i}] should describe all three outcomes`).toMatch(
      /Home \d+%, draw \d+%, away \d+%/,
    );
  }

  // No team crests or photos (ARCHITECTURE.md §13): page must have zero <img> elements.
  await expect(page.locator('img')).toHaveCount(0);
});

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
