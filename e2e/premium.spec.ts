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

  // The two Checkout buttons ARE the page's one quiet upgrade affordance
  // (DESIGN.md §6: no more than one per page) -- both prices stated plainly,
  // no "starting from", no hidden/asterisked fees.
  await expect(page.getByRole('button', { name: /£6/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /per month/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /£39/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /per year/ })).toBeVisible();
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
