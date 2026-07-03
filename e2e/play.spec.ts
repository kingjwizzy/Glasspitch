import { test, expect } from '@playwright/test';
import {
  expectLandmarksAndCompliance,
  expectNoSeriousA11yViolations,
  gotoAndExpectNoRuntimeErrors,
} from './helpers';

// W6 "Beat the Model" — the ANONYMOUS face of /play (ARCHITECTURE.md §5 v3
// game-picks amendment; DESIGN.md §6). Playwright runs with no auth cookies,
// so the force-dynamic segment always renders the static PlayExplainer here:
// a plain, honest explainer with exactly ONE sign-in affordance, no urgency
// mechanics, no prizes, no client-side form. The authed picks UI (PickCard,
// pools, leaderboards) writes through the visitor's own RLS-scoped client and
// is deliberately NOT driven by this suite — the DB-enforced invariants
// (pre-kickoff-only writes, no deletes, post-lock visibility) are integration
// concerns for the jobs-side suite, not something a cookie-less browser can
// reach.

test('/play (anonymous) renders the static explainer with no runtime errors', async ({
  page,
}) => {
  await gotoAndExpectNoRuntimeErrors(page, '/play');
  await expect(page.locator('h1')).toHaveText('Beat the model');

  // The three-step contract is stated in plain language: call it, locked at
  // kickoff, scored like ours — the same register as the ledger.
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
  await expect(page.getByText('Locked at kickoff.')).toBeVisible();
  await expect(page.getByText('Scored like ours.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pools with friends' })).toBeVisible();
});

test('/play (anonymous) has exactly one sign-in affordance and no pressure mechanics', async ({
  page,
}) => {
  await page.goto('/play', { waitUntil: 'load' });

  // ONE sign-in CTA in the page body, carrying the return path (DESIGN.md §6:
  // a single quiet affordance, never a gauntlet). The header's dim "Sign in"
  // is navigation chrome outside <main>.
  const cta = page.getByRole('link', { name: 'Sign in to play' });
  await expect(cta).toHaveCount(1);
  await expect(cta).toHaveAttribute('href', '/login?next=/play');
  await expect(page.locator('main a[href^="/login"]')).toHaveCount(1);

  // The prize-free promise is stated on the page itself — the game can never
  // quietly grow stakes, streaks, or countdown pressure.
  await expect(page.getByText(/prize-free forever/)).toBeVisible();
  await expect(page.getByText(/no money, no streaks, no pressure/)).toBeVisible();

  // Static explainer means static: no forms, no inputs, no dialogs — the
  // interactive pick islands exist only behind auth.
  await expect(page.locator('main form')).toHaveCount(0);
  await expect(page.locator('main input')).toHaveCount(0);
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);

  // No streak/urgency vocabulary beyond the shared sweep: the words that
  // would signal engagement mechanics creeping into the game surface.
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(/streak bonus|daily reward|don['’]t break/i);
});

test('/play (anonymous) has the shared landmarks, disclaimer, and only sanctioned images', async ({
  page,
}) => {
  await page.goto('/play', { waitUntil: 'load' });
  // Includes the §13 image rule (the explainer's spot illustration is inline
  // SVG, not an <img>) and the §6 dark-pattern vocabulary sweep.
  await expectLandmarksAndCompliance(page);
});

test('/play (anonymous) has no serious or critical a11y violations', async ({ page }) => {
  await page.goto('/play', { waitUntil: 'load' });
  await expectNoSeriousA11yViolations(page);
});
