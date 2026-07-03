import { test, expect } from '@playwright/test';
import {
  expectLandmarksAndCompliance,
  expectNoSeriousA11yViolations,
  gotoAndExpectNoRuntimeErrors,
} from './helpers';

// W4 homepage — the honest STRUCTURAL EMPTY state (young ledger, no fixtures),
// served by the second webServer (e2e/empty-home-server.mjs on :3001, a
// separate build with PREVIEW_HOMEPAGE=empty; see playwright.config.ts). The
// homepage is fully static, so the main webServer (populated preview) can
// never render this state — and "never fake data" is a core W4 invariant, so
// the empty surfaces need their own proof: ghost chips and honest copy, never
// invented numbers, with the page skeleton (7 sections, one sign-up end-cap,
// disclaimer) fully intact.
//
// NOTE: the Golden Boot slot has NO homepage preview hatch (it reads the real
// backing store and degrades to an em-dash skeleton), so its data state is
// deliberately not asserted here.

const EMPTY_HOME_URL = `http://localhost:${process.env.EMPTY_HOME_PORT ?? 3001}`;

// The whole file rides on the optional second webServer.
test.skip(
  process.env.E2E_SKIP_EMPTY === '1',
  'empty-homepage server skipped via E2E_SKIP_EMPTY=1',
);

test('/ (empty) renders honest structural empty states — never fake data', async ({
  page,
}) => {
  await page.goto(`${EMPTY_HOME_URL}/`, { waitUntil: 'load' });

  // Hero slot: an honest fallback, not an invented fixture.
  const hero = page.locator('section[aria-labelledby="home-kicker"]');
  await expect(hero.getByText(/No match scheduled right now/)).toBeVisible();

  // Proof rail: em-dash stat tiles + the ghost-chip pipeline empty state.
  for (const label of ['predictions scored', 'mean Brier', 'most-likely outcome landed']) {
    await expect(hero.getByText(label, { exact: true })).toBeVisible();
  }
  expect(await hero.getByText('—', { exact: true }).count()).toBeGreaterThanOrEqual(3);
  await expect(
    hero.getByText('First calls lock at kickoff and get scored here — misses included.'),
  ).toBeVisible();
  // NO fabricated receipts and no phantom featured-match link.
  await expect(hero.locator('a[href^="/match/"]')).toHaveCount(0);
  // The ledger link still stands — the promise is structural, not data-fed.
  await expect(hero.getByRole('link', { name: 'See the full ledger' })).toHaveAttribute(
    'href',
    '/ledger',
  );

  // Matchday stream + watching: honest empties.
  await expect(page.getByText(/No upcoming fixtures right now/)).toBeVisible();
  await expect(page.getByText(/Nothing flagged yet/)).toBeVisible();

  // Receipts: the record opens only after the first final whistle.
  const receipts = page.locator('section[aria-labelledby="recent-heading"]');
  await expect(
    receipts.getByText('The record opens after the first final whistle — misses included.'),
  ).toBeVisible();
  await expect(receipts.locator('a[href^="/match/"]')).toHaveCount(0);

  // Record band: structural honesty — the immutability claim, but NO invented
  // aggregate figures (no three-decimal metrics anywhere in the band).
  const band = page.locator('section[aria-labelledby="record-heading"]');
  await expect(band.getByRole('heading', { name: 'The record so far' })).toBeVisible();
  await expect(band.getByText(/cannot be edited, not even by us/)).toBeVisible();
  expect(await band.innerText()).not.toMatch(/\d\.\d{3}/);
});

test('/ (empty) keeps the page skeleton: 8 sections, one sign-up end-cap, disclaimer', async ({
  page,
}) => {
  await page.goto(`${EMPTY_HOME_URL}/`, { waitUntil: 'load' });

  await expectLandmarksAndCompliance(page);
  // 8 = the W4 seven + the W6 World Cup chances section. (That slot has no
  // preview hatch — it renders from the REAL `tournament_chances` table in
  // whichever state it holds; see the dedicated chances-slot test below. The
  // section itself is always present, so the count is state-independent.)
  await expect(page.locator('section[aria-labelledby]')).toHaveCount(8);
  await expect(page.locator('h1')).toHaveText('Football analysis you can check');

  // Exactly one sign-up affordance, even with nothing to show.
  await expect(page.getByRole('link', { name: 'Create a free account' })).toHaveCount(1);
  await expect(page.locator('main a[href="/login"]')).toHaveCount(2);
});

// W6: the chances slot reads the LIVE `tournament_chances` table (no preview
// hatch — Golden-Boot-slot convention), so this build renders whichever state
// the real backing store holds: the sized circle cloud with its printed
// percentages, or the honest "after tonight's first simulation run" copy.
// Either way the section is structurally intact and never invents numbers —
// a spinner or a fabricated placeholder figure would fail both branches.
test('/ (empty) chances slot is structurally honest — real circles or the empty copy', async ({
  page,
}) => {
  await page.goto(`${EMPTY_HOME_URL}/`, { waitUntil: 'load' });

  const section = page.locator('section[aria-labelledby="chances-heading"]');
  await expect(section).toBeVisible();
  await expect(section.getByRole('heading', { name: 'World Cup chances' })).toBeVisible();
  await expect(section.getByRole('link', { name: 'The full picture' })).toHaveAttribute(
    'href',
    '/chances',
  );

  const circles = section.locator('ol > li');
  const circleCount = await circles.count();
  if (circleCount > 0) {
    // Populated from the real table: every circle prints its % (size is
    // never the sole signal) and the provenance line states the trial count.
    expect(await section.getByText(/^(\d+|<1|>99)%$/).count()).toBe(circleCount);
    await expect(
      section.getByText(/simulated [\d,]+ times · updated daily/),
    ).toBeVisible();
  } else {
    await expect(
      section.getByText(/Tournament chances appear here after tonight/),
    ).toBeVisible();
  }
});

test('/ (empty) renders with no runtime errors', async ({ page }) => {
  await gotoAndExpectNoRuntimeErrors(page, `${EMPTY_HOME_URL}/`);
});

test('/ (empty) has no serious or critical a11y violations', async ({ page }) => {
  await page.goto(`${EMPTY_HOME_URL}/`, { waitUntil: 'load' });
  await expectNoSeriousA11yViolations(page);
});
