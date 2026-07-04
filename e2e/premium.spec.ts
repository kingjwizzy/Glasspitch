import { test, expect } from '@playwright/test';
import {
  expectLandmarksAndCompliance,
  expectNoSeriousA11yViolations,
  gotoAndExpectNoRuntimeErrors,
} from './helpers';

// /premium — the pricing page (ARCHITECTURE.md §4 v2; DESIGN.md §6 paywall
// rules). Noindexed, out of the public nav and the sitemap until the owner
// flips premium live post-Stripe-vetting and legal sign-off (§13).
// playwright.config.ts's webServer sets fake-but-well-formed
// STRIPE_SECRET_KEY/STRIPE_PRICE_ID_MONTHLY/STRIPE_PRICE_ID_ANNUAL so this
// page renders its REAL Checkout buttons here rather than the "not switched
// on yet" fallback -- the prices themselves are exactly what this spec needs
// to assert.

test('/premium renders with no runtime errors', async ({ page }) => {
  await gotoAndExpectNoRuntimeErrors(page, '/premium');
});

test('/premium has the shared landmarks, disclaimer, and zero <img>', async ({ page }) => {
  await page.goto('/premium', { waitUntil: 'load' });
  await expectLandmarksAndCompliance(page);
});

test('/premium has no serious or critical a11y violations', async ({ page }) => {
  await page.goto('/premium', { waitUntil: 'load' });
  await expectNoSeriousA11yViolations(page);
});

test('/premium is noindexed (kept out of search until premium goes live)', async ({ page }) => {
  const response = await page.goto('/premium', { waitUntil: 'load' });
  expect(response?.status()).toBeLessThan(400);
  const robots = page.locator('meta[name="robots"]');
  await expect(robots).toHaveAttribute('content', /noindex/);
});

test('/premium states both locked prices plainly', async ({ page }) => {
  await page.goto('/premium', { waitUntil: 'load' });

  await expect(page.getByRole('heading', { name: 'Glass Pitch Premium' })).toBeVisible();

  // The price + cadence render as their own line ABOVE each button (audit
  // fix #5/#16/#24) -- stated plainly, no "starting from", no hidden/
  // asterisked fees.
  await expect(page.getByText('£6', { exact: true })).toBeVisible();
  await expect(page.getByText('per month', { exact: true })).toBeVisible();
  await expect(page.getByText('£39', { exact: true })).toBeVisible();
  await expect(page.getByText('per year', { exact: true })).toBeVisible();

  // The two Checkout buttons ARE the page's one quiet upgrade affordance
  // (DESIGN.md §6: no more than one per page). Each button's accessible NAME
  // is now a verb + price label ("Start monthly · £6/mo" / "Start annual ·
  // £39/yr") -- a solid, unmistakably-clickable CTA, not a plain price
  // restated as the button name.
  const monthly = page.getByRole('button', { name: /Start monthly/ });
  await expect(monthly).toBeVisible();
  await expect(monthly).toHaveAccessibleName(/£6\/mo/);
  const annual = page.getByRole('button', { name: /Start annual/ });
  await expect(annual).toBeVisible();
  await expect(annual).toHaveAccessibleName(/£39\/yr/);

  // Annual is the emphasised/default plan, with a real, calculable saving
  // badge (no fake "was £X" strike price, no countdown).
  await expect(page.getByText(/Save 46%/)).toBeVisible();
});

test('/premium states plainly that the ledger and every prediction stay free forever', async ({
  page,
}) => {
  await page.goto('/premium', { waitUntil: 'load' });
  await expect(
    page.getByText(/full ledger and every prediction stay free, forever/i),
  ).toBeVisible();
  // Never implies paying changes or improves the predictions/model.
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(/better predictions|improves? the (model|predictions)/i);
});

test('/premium cancellation is stated as easy as subscribing, with no dark-pattern vocabulary', async ({
  page,
}) => {
  await page.goto('/premium', { waitUntil: 'load' });
  await expect(page.getByText(/cancelling is exactly as easy as subscribing/i)).toBeVisible();

  // DESIGN.md §6 (responsible-design rule): no fake urgency, no countdowns,
  // no guilt copy -- assert their absence directly rather than trusting a
  // manual read of the copy.
  const bodyText = (await page.locator('body').innerText()).toLowerCase();
  expect(bodyText).not.toMatch(/hurry|only today|last chance/);
  expect(bodyText).not.toMatch(/limited time|act now|don't miss out|offer ends/);
});
