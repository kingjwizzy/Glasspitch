import { test, expect } from '@playwright/test';
import {
  expectLandmarksAndCompliance,
  expectNoSeriousA11yViolations,
  gotoAndExpectNoRuntimeErrors,
} from './helpers';

// W6 share kit + email capture, the parts a cookie-less browser can prove:
//
// 1. The three OG image routes actually return real PNGs (status +
//    content-type + magic bytes; deliberately NO pixel assertions — the
//    cards' look is a design review concern, not an e2e one).
// 2. The footer email-capture surface renders its ENV-GATED state: the e2e
//    servers deliberately leave EMAIL_CAPTURE_ENABLED unset (matching
//    production today), so the footer must render NOTHING — no form, no
//    "coming soon" line — and the subscribe API must degrade to a quiet 503,
//    never a fake success (ARCHITECTURE.md §5 v3 email-capture amendment).
// 3. The /email/* landing pages (static, linked from real emails) render
//    with the full landmark/compliance/a11y contract.
// 4. The confirm/unsubscribe routes reject malformed tokens with a plain 400
//    (they are deliberately NOT gated on the capture switch — an emailed
//    link must keep working — but a junk token can never reach the DB).

// ── 1. OG image routes ──────────────────────────────────────────────────────
// /match/1 renders via PREVIEW_MATCH=1, so the per-match receipt card is
// exercised with deterministic data; the rest are static-shell/live-read
// cards (RAMBO wave W6 share kit: /ledger and /board joined the original
// three-route set, sharing the same "real PNG, no pixel assertions" contract).
const OG_ROUTES = [
  '/opengraph-image',
  '/chances/opengraph-image',
  '/match/1/opengraph-image',
  '/ledger/opengraph-image',
  '/board/opengraph-image',
] as const;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

for (const route of OG_ROUTES) {
  test(`${route} returns a real PNG`, async ({ request }) => {
    const res = await request.get(route);
    expect(res.status(), `${route} should return 200`).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
    // Magic bytes: a PNG bitstream, not an HTML error page mislabelled.
    const body = await res.body();
    expect(body.subarray(0, 8).equals(PNG_MAGIC), `${route} body should start with the PNG signature`).toBe(
      true,
    );
  });
}

// ── 2. The env-gated footer form: OFF renders NOTHING ──────────────────────
test('footer email capture renders nothing while EMAIL_CAPTURE_ENABLED is unset', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'load' });
  const footer = page.locator('footer');

  // Feature off → byte-absent: no form, no email input, and neither the
  // enabled-state heading nor the half-enabled "coming soon" line.
  await expect(footer.locator('form')).toHaveCount(0);
  await expect(footer.locator('input')).toHaveCount(0);
  await expect(footer.getByText('The scored record, by email')).toHaveCount(0);
  await expect(footer.getByText(/coming soon/)).toHaveCount(0);
});

test('POST /api/email/subscribe degrades to a quiet 503 while capture is off', async ({
  request,
}) => {
  const res = await request.post('/api/email/subscribe', {
    form: { email: 'visitor@example.com' },
  });
  expect(res.status()).toBe(503);
  // A plain sentence, never a fake success and never a crash page.
  expect(await res.text()).toContain('not switched on yet');
});

// ── 3. The /email/* landing pages ───────────────────────────────────────────
const EMAIL_PAGES = [
  { path: '/email/sent', h1: 'Check your inbox' },
  { path: '/email/confirmed', h1: 'You’re on the list' },
  { path: '/email/unsubscribed', h1: 'You’re unsubscribed' },
] as const;

for (const { path, h1 } of EMAIL_PAGES) {
  test(`${path} renders with no runtime errors`, async ({ page }) => {
    await gotoAndExpectNoRuntimeErrors(page, path);
    await expect(page.locator('h1')).toHaveText(h1);
  });

  test(`${path} has the shared landmarks, disclaimer, and no dark patterns`, async ({
    page,
  }) => {
    await page.goto(path, { waitUntil: 'load' });
    // Includes the §6 vocabulary sweep — the unsubscribed page especially
    // must carry no guilt or win-back pressure copy.
    await expectLandmarksAndCompliance(page);
  });

  test(`${path} has no serious or critical a11y violations`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' });
    await expectNoSeriousA11yViolations(page);
  });
}

// ── 4. Token routes: malformed input → plain 400, never a DB touch ─────────
test('confirm and unsubscribe reject missing or malformed tokens with 400', async ({
  request,
}) => {
  for (const url of [
    '/api/email/confirm',
    '/api/email/confirm?token=not-a-uuid',
    '/api/email/unsubscribe',
    '/api/email/unsubscribe?token=junk',
  ]) {
    const res = await request.get(url);
    expect(res.status(), `${url} should 400`).toBe(400);
    expect(res.headers()['content-type']).toContain('text/plain');
  }
});
