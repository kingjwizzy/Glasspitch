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

// ── /match/1/insights, logged out: the paywall states the price + a Go
// Premium CTA + a "already subscribe? sign in" escape hatch (audit fix #4 --
// previously the price was missing for a logged-out visitor). Playwright
// carries no auth cookies, so this dynamic route always renders its genuine
// anonymous branch here -- no mocking needed. ───────────────────────────────
test('/match/1/insights (logged out) states the price plainly with a Go Premium CTA and a sign-in escape hatch', async ({
  page,
}) => {
  await page.goto('/match/1/insights', { waitUntil: 'load' });

  await expect(page.getByRole('heading', { name: 'Deeper read', level: 1 })).toBeVisible();

  const teaser = page.locator('section[aria-labelledby="teaser-heading"]');
  await expect(teaser).toBeVisible();
  await expect(teaser.getByText('£6/month or £39/year')).toBeVisible();
  await expect(teaser.getByText(/stay free, forever, either way/i)).toBeVisible();

  const goPremium = teaser.getByRole('link', { name: 'Go Premium' });
  await expect(goPremium).toHaveAttribute('href', '/premium');

  // Logged-out only: someone who already subscribes but isn't recognised on
  // this device/browser gets an explicit way back to sign in, carrying the
  // return path.
  const signIn = teaser.getByRole('link', { name: /Already subscribe\? Sign in/ });
  await expect(signIn).toHaveAttribute('href', '/login?next=/match/1/insights');

  // Never a real fixture_insights read for a non-entitled viewer -- the
  // mockup is a decorative, aria-hidden placeholder (never real fetched
  // data), so it must still be present and reads unambiguously as a locked
  // preview to sighted and screen-reader users alike.
  const mock = teaser.locator('[aria-hidden="true"]').filter({ hasText: 'Expected goals' });
  await expect(mock).toBeVisible();
  await expect(teaser.getByText('A locked preview')).toBeVisible();
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

// ── /api/stripe/checkout CSRF hardening (security audit finding #4) ────────
// The route is now POST-only (a GET could be triggered as a same-site side
// effect with no CSRF token needed -- see the route's own file banner), and
// every POST is guarded by isCrossOriginRequest (src/lib/security/
// originGuard.ts) since Route Handlers, unlike Server Actions, get no
// automatic Origin check for free.
test.describe('/api/stripe/checkout CSRF hardening', () => {
  test('GET is rejected with 405 (state-changing route is POST-only)', async ({ request }) => {
    const response = await request.get('/api/stripe/checkout');
    expect(response.status()).toBe(405);
  });

  test('a cross-origin POST (forged Origin) is rejected with 403, never reaching Stripe', async ({
    request,
  }) => {
    const response = await request.post('/api/stripe/checkout', {
      headers: { origin: 'https://evil.example' },
      form: { plan: 'monthly' },
    });
    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/cross-origin/i);
  });

  test('a same-origin POST with no plan gets a plain 400, never a crash', async ({ request }) => {
    // No Origin/Sec-Fetch-Site header at all is treated as same-origin (a
    // real cross-site browser request always carries one of the two -- see
    // originGuard.ts's own reasoning) -- this proves the route is reachable
    // at all and fails cleanly on the NEXT validation step (an invalid plan),
    // rather than every non-GET request being blanket-rejected.
    const response = await request.post('/api/stripe/checkout', { form: { plan: 'not-a-plan' } });
    expect(response.status()).toBe(400);
  });
});

// /checkout/resume — the "resume to Stripe" landing page (same audit fix):
// noindexed, out of the sitemap/nav, reached only via the /login magic-link
// redirect chain, and its own real <form method="POST"> is what re-enters
// the checkout route.
test('/checkout/resume renders and is noindexed', async ({ page }) => {
  const response = await page.goto('/checkout/resume?plan=monthly', { waitUntil: 'load' });
  expect(response?.status()).toBeLessThan(400);

  await expect(page.getByRole('heading', { name: 'You’re signed in' })).toBeVisible();
  await expect(page.getByText(/Continue to Stripe to finish subscribing/)).toBeVisible();

  const robots = page.locator('meta[name="robots"]');
  await expect(robots).toHaveAttribute('content', /noindex/);

  const form = page.locator('form[action="/api/stripe/checkout"]');
  await expect(form).toHaveCount(1);
  await expect(form.locator('input[name="plan"]')).toHaveAttribute('value', 'monthly');
  await expect(form.getByRole('button', { name: /Continue to checkout/ })).toBeVisible();
});

test('/checkout/resume redirects to /premium when no valid plan is given', async ({ page }) => {
  const response = await page.goto('/checkout/resume', { waitUntil: 'load' });
  expect(response?.status()).toBeLessThan(400);
  await expect(page).toHaveURL(/\/premium$/);
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
