import { test, expect } from '@playwright/test';
import {
  expectLandmarksAndCompliance,
  expectNoDarkPatternVocabulary,
  expectNoSeriousA11yViolations,
  gotoAndExpectNoRuntimeErrors,
} from './helpers';

// /leaderboard — the public, opt-in "Beat the Model" leaderboard (RAMBO wave 2
// improvement #5; src/app/leaderboard/page.tsx). Reads `leaderboard_standings`
// (a nightly jobs-written snapshot) with NO preview hatch of its own — like
// /leagues, /board and /stats/golden-boot it degrades to an honest structural
// empty state on ANY backing-store condition (no players opted in yet, or the
// nightly job hasn't run), so this spec accepts either a populated table or
// the documented empty-state copy and asserts the full contract of whichever
// state actually renders.

test('/leaderboard renders with no runtime errors', async ({ page }) => {
  await gotoAndExpectNoRuntimeErrors(page, '/leaderboard');
});

test('/leaderboard has the shared landmarks, disclaimer, and only sanctioned images', async ({
  page,
}) => {
  await page.goto('/leaderboard', { waitUntil: 'load' });
  await expectLandmarksAndCompliance(page);
});

test('/leaderboard has no serious or critical a11y violations', async ({ page }) => {
  await page.goto('/leaderboard', { waitUntil: 'load' });
  await expectNoSeriousA11yViolations(page);
});

test('/leaderboard renders a populated ranking or the honest "opens as players opt in" empty state', async ({
  page,
}) => {
  await page.goto('/leaderboard', { waitUntil: 'load' });
  await expect(page.getByRole('heading', { name: 'Leaderboard', level: 1 })).toBeVisible();

  // Never framed as winners/losers or a competition with stakes — stated in
  // the header copy regardless of data state.
  await expect(
    page.getByText(/not a leaderboard of winners and losers/i),
  ).toBeVisible();
  await expect(page.getByText(/no money or prizes/i)).toBeVisible();
  await expect(page.getByText(/entirely opt-in/i)).toBeVisible();

  const table = page.locator('table');
  const emptyState = page.getByText(/opens as players opt in and their calls are scored/i);

  if ((await table.count()) > 0) {
    // POPULATED: the beat-margin ranking, one row per opted-in player.
    await expect(
      page.getByRole('heading', { name: 'Best-calibrated vs the model' }),
    ).toBeVisible();
    await expect(table.locator('thead th')).toHaveText([
      'Rank',
      'Player',
      'Picks scored',
      'Player Brier',
      'Model Brier',
      'Margin',
    ]);
    const rows = table.locator('tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
    // Rank is a plain ordinal starting at 1.
    await expect(rows.first().locator('td').first()).toHaveText('1');
    // Player identity is anonymised/opt-in text only — never an email or a
    // photo/crest image (§13).
    await expect(table.locator('img')).toHaveCount(0);
    await expect(emptyState).toHaveCount(0);
  } else {
    // EMPTY: no numbers invented in the meantime, and a live path back to
    // start playing. (The header prose above ALSO links "Beat the Model" to
    // /play regardless of data state — `.first()` picks either, both resolve
    // to the same href, so this stays robust to which copy renders first.)
    await expect(emptyState).toBeVisible();
    await expect(page.getByRole('link', { name: 'Beat the Model' }).first()).toHaveAttribute(
      'href',
      '/play',
    );
    await expect(table).toHaveCount(0);
  }

  // No dark-pattern/gambling vocabulary anywhere on the page (shared sweep),
  // plus the specific "misses count" honesty framing this surface promises.
  await expectNoDarkPatternVocabulary(page);
  const bodyText = (await page.locator('article').innerText()).toLowerCase();
  expect(bodyText).not.toMatch(/\bbet\b|\bodds\b|stake|wager/);
});

// ── Discoverability: nav (desktop inline row + mobile overflow panel),
// footer, and sitemap all point at /leaderboard — RAMBO wave 2 #5 makes this
// a first-class public surface, not an orphaned route. ─────────────────────
test('/leaderboard is linked from the footer and the sitemap', async ({ page, request }) => {
  await page.goto('/', { waitUntil: 'load' });
  await expect(
    page.locator('footer').getByRole('link', { name: 'Leaderboard', exact: true }),
  ).toHaveAttribute('href', '/leaderboard');

  const sitemapRes = await request.get('/sitemap.xml');
  expect(sitemapRes.status()).toBe(200);
  const sitemapBody = await sitemapRes.text();
  expect(sitemapBody).toContain('/leaderboard');
});
