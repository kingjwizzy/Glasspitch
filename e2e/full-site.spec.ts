import { test, expect } from '@playwright/test';
import {
  expectLandmarksAndCompliance,
  expectNoSeriousA11yViolations,
  gotoAndExpectNoRuntimeErrors,
} from './helpers';

// v3 "full site" round: the new growth/SEO surfaces (ARCHITECTURE.md §11) --
// /matches (the fixtures crawl hub), /leagues (the competition browse index),
// /methodology (the trust/SEO deep page) and /stats/golden-boot (the top
// scorers leaderboard, migration 0005) -- plus the Header's new "Matches" /
// "Leagues" nav links and static "Sign in" affordance now that legal sign-off
// and ICO registration let accounts be surfaced in the public UI.
//
// Mirrors legal.spec.ts's loop-plus-specifics shape and reuses e2e/helpers.ts
// rather than re-declaring smoke.spec.ts's local assertions a third time.
//
// /matches renders through its PREVIEW_MATCHES=1 hatch (playwright.config.ts
// webServer env) for deterministic day-grouping/probability-bar assertions --
// the same treatment /ledger, /match/[id], /team/[slug] and /league/[slug]
// already get in this suite. /leagues and /stats/golden-boot deliberately have
// NO preview hatch of their own (src/lib/queries/league.ts,
// src/lib/queries/goldenBoot.ts): both degrade to an honest empty state on ANY
// backing-store condition (DESIGN.md §9), so this spec accepts either a
// populated result or the documented empty-state copy rather than assuming
// the shared webServer's real Supabase project has rows -- migration 0005
// (top_scorers) had not been applied live as of this round (see STATUS.md /
// the backend-jobs report), so the honest empty state is what actually
// renders today.

const NEW_PAGES = ['/matches', '/leagues', '/methodology', '/stats/golden-boot'] as const;

for (const path of NEW_PAGES) {
  test(`${path} renders with no runtime errors`, async ({ page }) => {
    await gotoAndExpectNoRuntimeErrors(page, path);
  });

  test(`${path} has the shared landmarks, disclaimer, and zero <img>`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' });
    await expectLandmarksAndCompliance(page);
  });

  test(`${path} has no serious or critical a11y violations`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' });
    await expectNoSeriousA11yViolations(page);
  });
}

// ── Header: "Matches" / "Leagues" nav links + a static "Sign in" affordance ──
// (v3 amendment: accounts may now be surfaced in the public UI, but the
// header itself must stay a plain, session-unaware server component -- a
// cached public page can never branch on auth state, so "Sign in" is always a
// static link to /login, which itself redirects an already-signed-in visitor
// to /account.)
test('primary nav shows Matches, Leagues, and a static Sign in link to /login', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'load' });
  const primaryNav = page.locator('nav[aria-label="Primary"]');
  await expect(primaryNav.getByRole('link', { name: 'Matches', exact: true })).toHaveAttribute(
    'href',
    '/matches',
  );
  await expect(primaryNav.getByRole('link', { name: 'Leagues', exact: true })).toHaveAttribute(
    'href',
    '/leagues',
  );
  // "Sign in" sits just outside the <nav> landmark itself (Header.tsx) but is
  // still a plain static link, not a client-side auth affordance.
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute(
    'href',
    '/login',
  );
});

// ── /matches (populated via PREVIEW_MATCHES=1) ──────────────────────────────
test('/matches groups upcoming fixtures by day and lists recent results', async ({ page }) => {
  await page.goto('/matches', { waitUntil: 'load' });

  await expect(page.getByRole('heading', { name: 'Upcoming fixtures' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent results' })).toBeVisible();

  // Day-group sub-headings (h3) group the upcoming fixtures under the
  // "Upcoming fixtures" h2.
  const dayHeadings = page.locator('h3');
  expect(await dayHeadings.count()).toBeGreaterThan(0);

  // At least one probability bar renders for a published call, labelled with
  // all three outcomes (DESIGN.md §2: colour is never the sole signal).
  const probBars = page.locator('[role="img"][aria-label^="Win probability"]');
  const barCount = await probBars.count();
  expect(barCount, '/matches (populated) should render at least one probability bar').toBeGreaterThan(0);
  for (let i = 0; i < barCount; i++) {
    const label = await probBars.nth(i).getAttribute('aria-label');
    expect(label).toMatch(/Home \d+%, draw \d+%, away \d+%/);
  }

  // Recent results include a scored call: no "We backed"/betting vernacular.
  await expect(page.getByText(/We backed/)).toHaveCount(0);
});

test('/matches links through to /ledger for the full record', async ({ page }) => {
  await page.goto('/matches', { waitUntil: 'load' });
  await expect(page.getByRole('link', { name: 'Full record' })).toHaveAttribute('href', '/ledger');
});

// ── /leagues ─────────────────────────────────────────────────────────────
test('/leagues lists competitions with a fixture count, or shows the honest empty state', async ({
  page,
}) => {
  await page.goto('/leagues', { waitUntil: 'load' });
  await expect(page.getByRole('heading', { name: 'Leagues', exact: true, level: 1 })).toBeVisible();

  const emptyState = page.getByText('No competitions in our record yet.');
  const cards = page.locator('a[href^="/league/"]');
  const cardCount = await cards.count();
  if (cardCount === 0) {
    await expect(emptyState).toBeVisible();
  } else {
    await expect(cards.first()).toContainText(/fixture/);
    // Plain-text league name/country only -- no crest, mark, or logo image.
    await expect(cards.first().locator('img')).toHaveCount(0);
  }
});

// ── /methodology ─────────────────────────────────────────────────────────
test('/methodology states the exact Brier and log-loss formulas', async ({ page }) => {
  await page.goto('/methodology', { waitUntil: 'load' });
  await expect(page.getByRole('heading', { name: 'Methodology', level: 1 })).toBeVisible();
  await expect(page.getByText('BS = (p_home', { exact: false })).toBeVisible();
  await expect(page.getByText(/LL = .ln\(p_correct\)/)).toBeVisible();
});

test('/methodology links through to /ledger and /matches', async ({ page }) => {
  await page.goto('/methodology', { waitUntil: 'load' });
  // exact: true -- the "Audit any call yourself" section also has a separate
  // "full ledger" link, and Playwright's default name matching is a
  // case-insensitive substring match, so an unscoped "ledger" would resolve
  // to both.
  await expect(page.getByRole('link', { name: 'ledger', exact: true })).toHaveAttribute(
    'href',
    '/ledger',
  );
  await expect(page.getByRole('link', { name: 'matches list' })).toHaveAttribute(
    'href',
    '/matches',
  );
});

test('/about and /ledger link through to /methodology', async ({ page }) => {
  await page.goto('/about', { waitUntil: 'load' });
  await expect(
    page.locator('article').getByRole('link', { name: 'methodology', exact: true }),
  ).toHaveAttribute('href', '/methodology');

  await page.goto('/ledger', { waitUntil: 'load' });
  await expect(
    page.locator('article').getByRole('link', { name: 'methodology', exact: true }),
  ).toHaveAttribute('href', '/methodology');
});

// ── /stats/golden-boot -- either a populated top-15 table, or the honest
// empty state (see the file-header note: migration 0005 had not been applied
// live as of this round, so the honest empty state is what actually renders
// today; this spec is written to keep passing once the pipeline has run) ────
test('/stats/golden-boot renders a populated top-15 table or the honest empty state', async ({
  page,
}) => {
  await page.goto('/stats/golden-boot', { waitUntil: 'load' });
  await expect(page.getByRole('heading', { name: 'Golden Boot race', level: 1 })).toBeVisible();

  const table = page.locator('table');
  const emptyState = page.getByText(
    'Top-scorer standings appear once the data pipeline first runs.',
  );

  if ((await table.count()) > 0) {
    const rows = table.locator('tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
    expect(rowCount).toBeLessThanOrEqual(15);
    // Rank is a plain ordinal 1..N with no gaps.
    await expect(rows.first().locator('td').first()).toHaveText('1');
    // No photos or crests anywhere in the table (ARCHITECTURE.md §13).
    await expect(table.locator('img')).toHaveCount(0);
  } else {
    await expect(emptyState).toBeVisible();
  }
});

// Home page's new Golden Boot section (v3): either a populated top-5 race or
// the same honest empty state -- both read the same `top_scorers` table with
// no PREVIEW hatch of their own, so they always agree on which state renders.
test('home page Golden Boot section renders a populated race or the honest empty state', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'load' });
  const section = page.locator('section[aria-labelledby="golden-boot-heading"]');
  await expect(section).toBeVisible();
  await expect(section.getByRole('heading', { name: 'Golden Boot race' })).toBeVisible();
  await expect(section.getByRole('link', { name: 'Full standings' })).toHaveAttribute(
    'href',
    '/stats/golden-boot',
  );

  const rows = section.locator('ol li');
  const rowCount = await rows.count();
  if (rowCount > 0) {
    expect(rowCount).toBeLessThanOrEqual(5);
    await expect(section.locator('img')).toHaveCount(0);
  } else {
    await expect(
      section.getByText('Top-scorer standings appear once the data pipeline first runs.'),
    ).toBeVisible();
  }
});
