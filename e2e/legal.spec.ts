import { test, expect } from '@playwright/test';
import {
  expectLandmarksAndCompliance,
  expectNoSeriousA11yViolations,
  gotoAndExpectNoRuntimeErrors,
} from './helpers';

// /privacy, /terms, /refunds — the three v2 legal pages (ARCHITECTURE.md §13
// v2 amendment). Unlike /login and /premium, these are genuinely public and
// footer-linked (src/components/Footer.tsx) -- not noindexed, and not gated
// on the owner flipping premium live -- so this spec checks the opposite:
// they're reachable from the footer and carry the shared compliance surface,
// with no robots noindex directive.

const LEGAL_PAGES = ['/privacy', '/terms', '/refunds'] as const;

for (const path of LEGAL_PAGES) {
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

  test(`${path} is NOT noindexed -- it's a genuinely public, footer-linked page`, async ({
    page,
  }) => {
    await page.goto(path, { waitUntil: 'load' });
    const robots = page.locator('meta[name="robots"]');
    const count = await robots.count();
    if (count > 0) {
      await expect(robots).not.toHaveAttribute('content', /noindex/);
    }
  });
}

test('the footer links to /privacy, /terms, and /refunds from the home page', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  const footer = page.locator('footer');
  await expect(footer.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  await expect(footer.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  await expect(footer.getByRole('link', { name: 'Refunds' })).toHaveAttribute('href', '/refunds');
});

test('/terms names the £4/month and £29/year pricing and links to /refunds', async ({ page }) => {
  await page.goto('/terms', { waitUntil: 'load' });
  await expect(page.getByText('£4/month or £29/year')).toBeVisible();
  // Scoped to the article body -- the footer ALSO has a "Refunds" link, and
  // Playwright's accessible-name matching is case-insensitive by default, so
  // an unscoped locator would resolve to both.
  await expect(
    page.locator('article').getByRole('link', { name: 'refunds', exact: true }),
  ).toHaveAttribute('href', '/refunds');
});

test('/refunds states the ledger and every prediction stay free either way', async ({ page }) => {
  await page.goto('/refunds', { waitUntil: 'load' });
  await expect(
    page.getByText(/full prediction ledger and every match prediction stay free and public/i),
  ).toBeVisible();
});

test('/privacy explains the self-serve account deletion route', async ({ page }) => {
  await page.goto('/privacy', { waitUntil: 'load' });
  await expect(page.getByRole('link', { name: 'your account page' })).toHaveAttribute(
    'href',
    '/account',
  );
});
