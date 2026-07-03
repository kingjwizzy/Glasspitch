import { defineConfig, devices } from '@playwright/test';

// E2E runs against a production build (`next build && next start`), not `next
// dev` — the dev server emits Fast-Refresh / devtools console noise that would
// make the "no console errors" assertion both flaky and unrepresentative of
// what ships. baseURL is the local production server on :3000.
const PORT = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Fail CI if a `test.only` was committed by accident.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    // Mobile-first is a hard design goal (DESIGN.md / ARCHITECTURE.md §… ),
    // so every smoke spec runs at a phone viewport AND desktop.
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run build && npm run start',
    url: baseURL,
    timeout: 120_000,
    // Locally, reuse a server already on :3000; in CI always start fresh.
    reuseExistingServer: !process.env.CI,
    // Render every DB-backed route with representative preview data (server-only
    // hatches, write NOTHING — see src/lib/queries/*.preview.ts) so the e2e
    // a11y/landmark specs exercise populated content — the hero + ProbabilityBars,
    // a scored/locked/voided match, a team, a league, and the ledger's calibration
    // table + scored rows — not only empty states. ALLOW_PREVIEW=1 is the second,
    // explicit flag every PREVIEW_* hatch requires together (src/lib/queries/shared.ts
    // previewAllowed()) — a single stray PREVIEW_* var alone does nothing, which is
    // exactly why it must be set here for any of them to fire in this production
    // build. Merged over process.env (CI provides the dummy NEXT_PUBLIC_* there;
    // locally `next` reads them from .env.local).
    env: {
      ALLOW_PREVIEW: '1',
      PREVIEW_HOMEPAGE: '1',
      PREVIEW_LEDGER: '1',
      PREVIEW_MATCH: '1',
      PREVIEW_TEAM: '1',
      PREVIEW_LEAGUE: '1',
      // v2 premium (e2e/premium.spec.ts): fake-but-well-formed test-mode
      // values so /premium renders its REAL £4/£29 Checkout buttons instead
      // of the "not switched on yet" fallback (src/lib/stripe/plans.ts's
      // plansConfigured() needs both price ids; the page's canCheckout also
      // needs a truthy STRIPE_SECRET_KEY). These are never used to make a
      // real Stripe API call in this suite — getStripe() only constructs the
      // SDK client (no network call at construction time), and every e2e
      // request that would actually reach Stripe (checkout/portal) is
      // anonymous and redirects to /login first. Deliberately NOT setting
      // STRIPE_WEBHOOK_SECRET here: leaving it unset exercises the webhook
      // route's genuine pre-launch 503-degradation path (see
      // e2e/premium-guardrails.spec.ts), matching this repo's real
      // .env.local, where the webhook secret and price ids are the fields
      // allowed to be empty pre-launch.
      STRIPE_SECRET_KEY: 'sk_test_e2e_dummy_00000000000000000000000000',
      STRIPE_PRICE_ID_MONTHLY: 'price_test_e2e_monthly',
      STRIPE_PRICE_ID_ANNUAL: 'price_test_e2e_annual',
    },
  },
});
