import { test, expect } from '@playwright/test';
import {
  expectLandmarksAndCompliance,
  expectNoSeriousA11yViolations,
  gotoAndExpectNoRuntimeErrors,
} from './helpers';

// W6 World Cup chances — the owner's flagship circles (/chances + the
// homepage's 8th named section). PUBLIC + ISR + zero client JS; reads
// `tournament_chances` (migration 0007, written nightly by the Monte Carlo
// sim job) with NO preview hatch — Golden-Boot-slot convention, so both
// surfaces degrade to the honest "after tonight's first simulation run" copy
// on any backing-store condition. These specs accept either state (the live
// table populated after the first sim run, or empty before it) and assert the
// full contract of whichever renders — including that a populated cloud
// always PRINTS its percentages (size is never the sole signal, DESIGN.md §2)
// and states its provenance (trial count + snapshot date, §10 register).

const EMPTY_COPY = /Tournament chances appear here after tonight/;

test('/chances renders with no runtime errors', async ({ page }) => {
  await gotoAndExpectNoRuntimeErrors(page, '/chances');
});

test('/chances has the shared landmarks, disclaimer, and only sanctioned images', async ({
  page,
}) => {
  await page.goto('/chances', { waitUntil: 'load' });
  // Every <img> must be a vendored /flags/ SVG (aria-hidden, alt="", fixed
  // size, plain-text nation beside it) — the circle marks themselves are the
  // sanctioned flags, and an unmapped nation degrades to a text disc, so no
  // other image can ever appear here (§13).
  await expectLandmarksAndCompliance(page);
});

test('/chances has no serious or critical a11y violations', async ({ page }) => {
  await page.goto('/chances', { waitUntil: 'load' });
  await expectNoSeriousA11yViolations(page);
});

test('/chances renders the sized circle cloud with printed figures, or the honest empty state', async ({
  page,
}) => {
  await page.goto('/chances', { waitUntil: 'load' });
  await expect(page.locator('h1')).toHaveText('World Cup chances');

  // The analysis-not-advice note card renders in every state — simulation
  // context must never read as the locked, scored record.
  await expect(
    page.getByText(/estimates from a Monte Carlo simulation/),
  ).toBeVisible();

  const cloud = page.locator('section[aria-labelledby="cloud-heading"] ol > li');
  const teamCount = await cloud.count();
  if (teamCount > 0) {
    // POPULATED. Every circle prints its exact chance under it — the size
    // encoding is honest but never the only carrier (DESIGN.md §2).
    expect(
      await page
        .locator('section[aria-labelledby="cloud-heading"]')
        .getByText(/^(\d+|<1|>99)%$/)
        .count(),
    ).toBe(teamCount);

    // Provenance microline: trial count, cadence, snapshot date (§10:
    // print the sample size).
    await expect(
      page.getByText(/simulated [\d,]+ times · updated daily · snapshot .+/),
    ).toBeVisible();

    // The full table: semis / final / wins-it columns for every survivor,
    // plus the printed day-over-day move.
    const table = page.locator('table');
    await expect(table.locator('thead th')).toHaveText([
      'Nation',
      'Semis',
      'Final',
      'Wins it',
      'Day move',
    ]);
    expect(await table.locator('tbody tr').count()).toBe(teamCount);

    await expect(page.getByText(EMPTY_COPY)).toHaveCount(0);
  } else {
    // EMPTY: the honest structural state — reserved space and plain copy,
    // never invented numbers, no spinner.
    await expect(page.getByText(EMPTY_COPY)).toBeVisible();
    await expect(page.locator('table')).toHaveCount(0);
    // No percentages anywhere in the article body when there is no data.
    expect(await page.locator('article').innerText()).not.toMatch(/\d+% to win/);
  }
});

// ── The homepage chances slot (8th named section, W6) ──────────────────────
// Rendered by the shared webServer; the slot reads the SAME live table as
// /chances (no preview hatch), so the two surfaces always agree on state.
test('/ chances section renders the cloud or its honest empty state, and links to /chances', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'load' });

  const section = page.locator('section[aria-labelledby="chances-heading"]');
  await expect(section).toBeVisible();
  await expect(
    section.getByRole('heading', { name: 'World Cup chances' }),
  ).toBeVisible();
  await expect(section.getByRole('link', { name: 'The full picture' })).toHaveAttribute(
    'href',
    '/chances',
  );

  const circles = section.locator('ol > li');
  const circleCount = await circles.count();
  if (circleCount > 0) {
    // Populated: printed % under every circle, provenance line present.
    expect(await section.getByText(/^(\d+|<1|>99)%$/).count()).toBe(circleCount);
    await expect(
      section.getByText(/simulated [\d,]+ times · updated daily/),
    ).toBeVisible();
  } else {
    await expect(section.getByText(EMPTY_COPY)).toBeVisible();
  }
});
