import { test, expect } from '@playwright/test';
import {
  expectLandmarksAndCompliance,
  expectNoSeriousA11yViolations,
  gotoAndExpectNoRuntimeErrors,
} from './helpers';

// /login — v2 premium auth (ARCHITECTURE.md §4/§13; DESIGN.md §6). Kept OUT
// of the public nav, noindexed and out of the sitemap until the owner flips
// premium live (ARCHITECTURE.md §13) -- so this spec asserts the noindex
// meta directly, on top of every other smoke/a11y/landmark invariant every
// page in this repo must satisfy. Anonymous-only: middleware redirects an
// already-signed-in visitor to /account, so a bare navigation always hits the
// real sign-in form.

test('/login renders with no runtime errors', async ({ page }) => {
  await gotoAndExpectNoRuntimeErrors(page, '/login');
});

test('/login has the shared landmarks, disclaimer, and zero <img>', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'load' });
  await expectLandmarksAndCompliance(page);
});

test('/login has no serious or critical a11y violations', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'load' });
  await expectNoSeriousA11yViolations(page);
});

test('/login is noindexed (kept out of search until premium goes live)', async ({ page }) => {
  const response = await page.goto('/login', { waitUntil: 'load' });
  expect(response?.status()).toBeLessThan(400);
  const robots = page.locator('meta[name="robots"]');
  await expect(robots).toHaveAttribute('content', /noindex/);
});

test('/login shows the magic-link email form and the required 18+ attestation', async ({
  page,
}) => {
  await page.goto('/login', { waitUntil: 'load' });

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  const email = page.getByLabel('Email address');
  await expect(email).toBeVisible();
  await expect(email).toHaveAttribute('type', 'email');
  await expect(email).toHaveAttribute('required', '');

  // The 18+ confirmation is a REQUIRED checkbox -- not a soft note (this is a
  // gambling-adjacent product; DESIGN.md §6/ARCHITECTURE.md §13). No magic
  // link can be requested without it.
  const is18 = page.locator('#is18');
  await expect(is18).toHaveAttribute('type', 'checkbox');
  await expect(is18).toHaveAttribute('required', '');
  await expect(page.getByText(/I confirm I am 18 or over/)).toBeVisible();

  await expect(page.getByRole('button', { name: 'Send magic link' })).toBeVisible();

  // No password field anywhere -- this is a magic-link-only flow.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test('/login form submits and the server action returns state (no error boundary)', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/login', { waitUntil: 'load' });

  // "foo@bar" passes the browser's type=email check (no TLD required) but fails
  // the action's stricter EMAIL_RE (which requires a dot), so the server action
  // runs and returns its validation state WITHOUT calling Supabase or sending
  // an email. This exercises the useActionState <-> 'use server' round trip a
  // GET render never triggers -- the exact path that 500'd into the error
  // boundary when login/actions.ts illegally exported a non-function value
  // ("A 'use server' file can only export async functions, found object").
  await page.getByLabel('Email address').fill('foo@bar');
  await page.locator('#is18').check();
  await page.getByRole('button', { name: 'Send magic link' }).click();

  // The action's own validation message proves it ran and returned state...
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  // ...and the page did NOT fall into error.tsx ("Something went wrong").
  await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
  expect(errors, `runtime errors during submit: ${errors.join(' | ')}`).toEqual([]);
});

test('/login never shows dark-pattern urgency language', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'load' });
  const bodyText = (await page.locator('body').innerText()).toLowerCase();
  expect(bodyText).not.toMatch(/hurry|only today|last chance/);
});
