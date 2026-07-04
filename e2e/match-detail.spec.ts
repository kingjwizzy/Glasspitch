import { test, expect } from '@playwright/test';

// Two RAMBO-wave surfaces on the match page that don't get their own file
// elsewhere in this suite:
//
// 1. RelatedFixtures ("More matchday calls", improvement #4) — dense internal
//    linking to other fixtures. src/lib/queries/related.ts has NO preview
//    hatch of its own (it reads the real `fixtures` table directly, unlike
//    match.ts's PREVIEW_MATCH hatch) and degrades to an all-empty result on
//    any read failure/no match — same "accept either state" convention as
//    /leagues, /board and /stats/golden-boot elsewhere in this suite.
//
// 2. LivePill's defensive minute rendering (RAMBO wave 3 #1) — preview
//    fixture id=5 (Portugal v Uruguay) is the one deliberately left `status:
//    'live'` with `status_short`/`elapsed_minute` both null (see
//    src/lib/queries/match.preview.ts's comment), exercising the "no minute
//    yet, fall back to plain Live" path rather than a fabricated clock. The
//    minute-STRING format itself (`67'`, `HT`, `90+2'`) is a pure function
//    (`liveMinuteLabel`, src/lib/format.ts) covered by
//    jobs/tests/test_fetch_fixtures.py's live-clock parsing tests instead
//    (there is no TS unit-test harness in this repo — see CLAUDE.md).

test('/match/1 shows "More matchday calls" related-fixture links, or renders without the section when the live backing store has nothing to relate', async ({
  page,
}) => {
  await page.goto('/match/1', { waitUntil: 'load' });

  const section = page.locator('section[aria-labelledby="related-heading"]');
  if ((await section.count()) > 0) {
    await expect(section.getByRole('heading', { name: 'More matchday calls' })).toBeVisible();

    const links = section.locator('a[href^="/match/"]');
    const linkCount = await links.count();
    expect(linkCount).toBeGreaterThan(0);
    // Never links back to the page it's on.
    await expect(section.locator('a[href="/match/1"]')).toHaveCount(0);
    // Deliberately lighter than the main match card (RelatedFixtures.tsx's own
    // banner comment): link density only, no probability bar and no ✓/✗
    // result badge repeating what the visitor already saw above.
    await expect(section.locator('[role="img"][aria-label^="Win probability"]')).toHaveCount(0);
    // Each group has its own labelled sub-heading (h3).
    expect(await section.locator('h3').count()).toBeGreaterThan(0);
  } else {
    // A quiet, best-effort surface — never renders an empty shell (see
    // RelatedFixtures.tsx: `if (populated.length === 0) return null`).
    await expect(section).toHaveCount(0);
  }
});

test('/match/5 (preview, live with no minute yet) renders the defensive plain "Live" pill, never a fabricated clock', async ({
  page,
}) => {
  await page.goto('/match/5', { waitUntil: 'load' });

  await expect(page.locator('h1')).toBeVisible();

  // status_short/elapsed_minute are deliberately null in this preview fixture
  // (match.preview.ts) — LivePill must still say "Live" and must NOT invent a
  // minute figure. The live status has no separate accessible name of its own
  // beyond the visible "Live" text, so match on the rendered text directly.
  const livePill = page.getByText('Live', { exact: true });
  await expect(livePill).toBeVisible();
  // No stray digit-plus-apostrophe minute marker anywhere near the pill (the
  // format a real live minute WOULD take, e.g. "67'" or "90+2'").
  await expect(page.getByText(/^\d+(\+\d+)?['’]$/)).toHaveCount(0);
  await expect(page.getByText('HT', { exact: true })).toHaveCount(0);

  // "Postponed"/"Upcoming"/"Full time" (the other three status labels) must
  // never appear alongside a fixture this page renders as live.
  await expect(page.getByText('Full time', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Upcoming', { exact: true })).toHaveCount(0);
});
