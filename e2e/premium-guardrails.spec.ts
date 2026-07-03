import { test, expect } from '@playwright/test';

// v2 premium guardrails that don't fit neatly under login/premium/legal:
//  1. The free, cached match page still carries its one quiet "Deeper read"
//     premium affordance (DESIGN.md §6: no more than one per page) -- proves
//     the W1 match-page contract survived the v2 pass.
//  2. Public, DB-read pages emit NO Set-Cookie -- the v2 auth middleware
//     (src/middleware.ts) is scoped to exactly /login, /auth/*, /account/*,
//     /premium/*, /api/stripe/* (its `config.matcher`), so a public page must
//     never gain a cookie/session side-effect that would force it dynamic or
//     break shared HTTP/CDN caching (ARCHITECTURE.md §7 v2 amendment).
//  3. The Stripe webhook route degrades gracefully (400/503), never 500, to
//     an unsigned request -- this repo's real .env.local (and CI) leave
//     STRIPE_WEBHOOK_SECRET unset pre-launch, and the route must never crash.

test('/match/1 (preview) still shows the quiet "Deeper read" premium line', async ({ page }) => {
  await page.goto('/match/1', { waitUntil: 'load' });

  const section = page.locator('section[aria-labelledby="deeper-read-heading"]');
  await expect(section).toBeVisible();
  await expect(section.getByRole('heading', { name: 'Deeper read' })).toBeVisible();
  await expect(section).toContainText(/stay free forever/i);

  const link = section.getByRole('link', { name: /See the deeper read/i });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '/match/1/insights');
});

test.describe('public pages emit no Set-Cookie (cacheable; no auth side-effects)', () => {
  const PUBLIC_PATHS = ['/', '/match/1'] as const;

  for (const path of PUBLIC_PATHS) {
    test(`${path} sets no Set-Cookie header`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBeLessThan(400);

      const headers = await response.headersArray();
      const setCookieHeaders = headers.filter((h) => h.name.toLowerCase() === 'set-cookie');
      expect(setCookieHeaders).toEqual([]);
    });
  }
});

test.describe('/api/stripe/webhook degrades gracefully -- never a 500', () => {
  test('an unsigned POST with a JSON body responds 400 or 503, never 500', async ({ request }) => {
    const response = await request.post('/api/stripe/webhook', {
      data: { type: 'checkout.session.completed' },
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status(), 'must never be a 500').not.toBe(500);
    expect([400, 503]).toContain(response.status());
  });

  test('a bare POST with no body and no signature header responds 400 or 503, never 500', async ({
    request,
  }) => {
    const response = await request.post('/api/stripe/webhook');
    expect(response.status(), 'must never be a 500').not.toBe(500);
    expect([400, 503]).toContain(response.status());
  });

  test('a GET is rejected without crashing the route (not a 500)', async ({ request }) => {
    const response = await request.get('/api/stripe/webhook');
    expect(response.status()).not.toBe(500);
    expect(response.status()).toBeLessThan(500);
  });
});
