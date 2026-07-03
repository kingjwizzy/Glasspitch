import { test, expect } from '@playwright/test';
import {
  expectLandmarksAndCompliance,
  expectNoSeriousA11yViolations,
  gotoAndExpectNoRuntimeErrors,
} from './helpers';

// W6 Gameweek Board (/board) + Fixture Ticker (/board/ticker) — free, PUBLIC,
// ISR, zero client JS (ARCHITECTURE.md §5 v3; ROADMAP.md §2). Both read
// `team_probability_snapshots` (migration 0006, written nightly by
// jobs/snapshot_probabilities.py) with NO preview hatch of their own — like
// /leagues and /stats/golden-boot they degrade to an honest structural empty
// state on ANY backing-store condition, so these specs accept either a
// populated board or the documented empty copy (whichever the live snapshot
// table holds on the day the suite runs) and assert the full contract of
// whichever state renders. Structural invariants (landmarks, §13 images,
// disclaimer, a11y) hold in BOTH states.

const BOARD_PAGES = ['/board', '/board/ticker'] as const;

for (const path of BOARD_PAGES) {
  test(`${path} renders with no runtime errors`, async ({ page }) => {
    await gotoAndExpectNoRuntimeErrors(page, path);
  });

  test(`${path} has the shared landmarks, disclaimer, and only sanctioned images`, async ({
    page,
  }) => {
    await page.goto(path, { waitUntil: 'load' });
    // expectOnlySanctionedImages inside: every <img> must be a vendored
    // /flags/ SVG (aria-hidden, alt="", fixed size, beside its plain-text
    // team name) — a crest or player photo on these dense team surfaces
    // would fail here (§13, W4/W6 flag sanction).
    await expectLandmarksAndCompliance(page);
  });

  test(`${path} has no serious or critical a11y violations`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' });
    await expectNoSeriousA11yViolations(page);
  });
}

// ── /board: populated table or the honest empty state ──────────────────────
test('/board renders a populated snapshot table or the honest empty state', async ({
  page,
}) => {
  await page.goto('/board', { waitUntil: 'load' });
  await expect(page.locator('h1')).toHaveText('Gameweek board');

  // The in-house-Elo provenance note renders in EVERY state — these context
  // numbers must never be mistakable for the locked, scored ledger calls.
  await expect(
    page.getByText(/estimates from our own Elo ratings/),
  ).toBeVisible();

  const table = page.locator('table');
  if ((await table.count()) > 0) {
    // POPULATED: the full column contract, one row per team.
    await expect(table.locator('thead th')).toHaveText([
      'Team',
      'Next',
      'Win',
      'Clean sheet',
      'xG for / against',
      'Day move',
    ]);
    const rows = table.locator('tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
    // Win probability is PRINTED per row (never colour/size alone, §2).
    await expect(rows.first()).toContainText(/(\d+|<1|>99)%/);
    // Day-over-day movement is printed as a value (▲/▼ pp or 0.0 or the
    // honest "—" when there is no previous snapshot) — check the cell text.
    await expect(rows.first()).toContainText(/[▲▼]\s\d+\.\d|0\.0|—/);
    // Each row links through to its match page.
    expect(await table.locator('a[href^="/match/"]').count()).toBeGreaterThan(0);

    // Provenance: which snapshot this is, and the cadence.
    await expect(page.getByText(/Snapshot .+ · refreshed nightly/)).toBeVisible();
    // The ticker link only exists alongside a populated board.
    await expect(page.getByRole('link', { name: 'Fixture ticker' })).toHaveAttribute(
      'href',
      '/board/ticker',
    );
  } else {
    // EMPTY: honest copy + an aria-hidden dash skeleton, never invented rows.
    await expect(
      page.getByText('The board appears once the nightly snapshot job first runs'),
    ).toBeVisible();
    await expect(page.locator('ol[aria-hidden="true"]')).toHaveCount(1);
    await expect(page.locator('a[href^="/match/"]')).toHaveCount(0);
  }
});

// ── /board/ticker: populated difficulty grid or the honest empty state ─────
test('/board/ticker renders the difficulty grid or the honest empty state', async ({
  page,
}) => {
  await page.goto('/board/ticker', { waitUntil: 'load' });
  await expect(page.locator('h1')).toHaveText('Fixture ticker');

  // Way back to the board is always present. (Scoped to <main>: the footer
  // nav carries its own "Gameweek board" link on every page.)
  await expect(
    page.locator('main').getByRole('link', { name: /Gameweek board/ }),
  ).toHaveAttribute('href', '/board');
  // The provenance note renders in every state.
  await expect(
    page.getByText(/Difficulty comes from our own nightly Elo win probabilities/),
  ).toBeVisible();

  const table = page.locator('table');
  if ((await table.count()) > 0) {
    // POPULATED: every difficulty cell prints its number AND the win % — the
    // tinted border is a secondary cue only (colour never the sole signal).
    const cells = table.locator('a[href^="/match/"]');
    const cellCount = await cells.count();
    expect(cellCount).toBeGreaterThan(0);
    expect(
      await table.getByText(/D[1-5] · win (\d+|<1|>99)%/).count(),
    ).toBeGreaterThan(0);
    // The accessible label carries the whole reading: opponent, difficulty
    // out of 5 in words, and the win probability.
    await expect(cells.first()).toHaveAttribute(
      'aria-label',
      /difficulty [1-5] of 5 \(.+\), win probability/,
    );
  } else {
    await expect(
      page.getByText('The ticker appears once the nightly snapshot job first runs.'),
    ).toBeVisible();
    await expect(page.locator('ol[aria-hidden="true"]')).toHaveCount(1);
  }
});
