import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Smoke + accessibility coverage for every page.
//
// STATIC_PAGES render identically with or without a database (confirmed: they
// build clean against a dummy Supabase URL) — /ledger is the one exception:
// playwright.config.ts's webServer sets PREVIEW_LEDGER=1 (alongside
// ALLOW_PREVIEW=1), so it renders the POPULATED trust-engine UI (calibration
// table, scored calls) here, not the empty "no record yet" state — see the
// dedicated "/ledger (populated)" tests below for content-specific assertions.
//
// DYNAMIC_PAGES are the DB-backed routes (/match/[id], /team/[slug],
// /league/[slug]) — rendered via their server-only PREVIEW_* hatches
// (src/lib/queries/*.preview.ts), which fabricate representative in-memory
// data and write NOTHING, so these run with no seeded database at all. Every
// PREVIEW_* hatch requires ALLOW_PREVIEW=1 alongside it (see
// playwright.config.ts's webServer env) — a real deploy without that flag
// renders these routes from Supabase as normal.
const STATIC_PAGES = ['/', '/about', '/ledger', '/responsible-gambling'];
const DYNAMIC_PAGES = ['/match/1', '/team/brazil', '/league/world-cup'];
const ALL_PAGES = [...STATIC_PAGES, ...DYNAMIC_PAGES];

/** Shared structural/compliance assertions every page must satisfy, regardless
 *  of data state (ARCHITECTURE.md §13; DESIGN.md §2). Assumes `page` has
 *  already navigated. */
async function expectLandmarksAndCompliance(page: Page) {
  const banner = page.locator('[role="region"][aria-label="Compliance disclaimer"]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('not betting advice');
  await expect(banner).toContainText('18+');

  const footer = page.locator('footer');
  await expect(footer).toContainText('not betting advice');

  const primaryNav = page.locator('nav[aria-label="Primary"]');
  await expect(primaryNav).toBeVisible();

  await expect(page.locator('h1')).toHaveCount(1);

  // No team crests, player photos, or any other <img> (ARCHITECTURE.md §13):
  // plain-text team names only, on every page including the dynamic ones.
  await expect(page.locator('img')).toHaveCount(0);
}

// ── Home page structural invariants ─────────────────────────────────────────
// These hold in any data state (populated / live / empty) because they come
// from the static layout — not from DB rows. The shared webServer renders the
// home page with PREVIEW_HOMEPAGE=1 (playwright.config.ts), so the populated
// hero + ProbabilityBars are exercised here too, not just the empty state.
test('/ has correct landmark structure and data-state-independent semantics', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'load' });

  // Compliance: the disclaimer banner is present and carries the compliance text.
  const banner = page.locator('[role="region"][aria-label="Compliance disclaimer"]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('not betting advice');
  await expect(banner).toContainText('18+');

  // Compliance: the footer repeats the disclaimer (ARCHITECTURE.md §13).
  const footer = page.locator('footer');
  await expect(footer).toContainText('not betting advice');

  // Primary nav landmark exists and is labelled.
  const primaryNav = page.locator('nav[aria-label="Primary"]');
  await expect(primaryNav).toBeVisible();

  // Heading order: h1 is present and unique; all labelled sections exist as h2.
  await expect(page.locator('h1')).toHaveCount(1);
  // The six named sections (hero, upcoming, watching, recent calls, the v3
  // Golden Boot race, and the running record) each get a visible or sr-only
  // h2 via SectionHeader or an inline element.
  const namedSections = page.locator('section[aria-labelledby]');
  await expect(namedSections).toHaveCount(6);

  // ProbabilityBar uses role=img with a descriptive aria-label naming all three
  // outcomes (DESIGN.md §2: colour is never the sole signal). With preview data
  // the populated hero guarantees at least one bar, so the contract is actually
  // enforced rather than skipped.
  const probBars = page.locator('[role="img"][aria-label^="Win probability"]');
  const barCount = await probBars.count();
  expect(
    barCount,
    'populated home page should render at least one probability bar',
  ).toBeGreaterThan(0);
  for (let i = 0; i < barCount; i++) {
    const label = await probBars.nth(i).getAttribute('aria-label');
    expect(label, `ProbabilityBar[${i}] should describe all three outcomes`).toMatch(
      /Home \d+%, draw \d+%, away \d+%/,
    );
  }

  // No team crests or photos (ARCHITECTURE.md §13): page must have zero <img> elements.
  await expect(page.locator('img')).toHaveCount(0);
});

// ── Landmarks + compliance on every dynamic page + the populated ledger ─────
// (audit digest: "DB-backed routes have zero e2e or axe coverage despite ready
// PREVIEW hatches"; "/ledger is only ever tested in its empty state"). Static
// pages other than '/' don't repeat this whole checklist — the home test above
// already proves the shared layout carries it; this loop proves it ALSO holds
// on routes rendered through a completely different code path (DB reads /
// preview hatches), where a missing DisclaimerBanner or a stray <img> would
// otherwise go uncaught.
for (const path of [...DYNAMIC_PAGES, '/ledger']) {
  test(`${path} has landmarks, zero <img>, and the disclaimer`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' });
    await expectLandmarksAndCompliance(page);
  });
}

for (const path of ALL_PAGES) {
  test(`${path} renders with no runtime errors`, async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const response = await page.goto(path, { waitUntil: 'load' });
    expect(
      response?.status() ?? 0,
      `${path} should return a non-error HTTP status`,
    ).toBeLessThan(400);

    // Each page has a single visible top-level heading.
    await expect(page.locator('h1')).toBeVisible();

    expect(pageErrors, `uncaught page errors on ${path}`).toEqual([]);
    expect(consoleErrors, `console errors on ${path}`).toEqual([]);
  });

  test(`${path} has no serious or critical a11y violations`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const seriousOrWorse = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    const report = seriousOrWorse
      .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
      .join('\n');
    expect(seriousOrWorse, `a11y violations on ${path}:\n${report}`).toEqual([]);
  });
}

// ── /ledger, populated (PREVIEW_LEDGER=1) ───────────────────────────────────
// The empty-state ledger is already covered by the loops above; this proves
// the trust-engine UI itself — the running record, the calibration table, and
// at least one scored row — actually renders (audit digest: "/ledger is only
// ever tested in its empty state").
test('/ledger (populated) renders the running record, calibration table, and scored calls', async ({
  page,
}) => {
  await page.goto('/ledger', { waitUntil: 'load' });

  await expect(page.getByRole('heading', { name: 'Running record' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Calibration' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Every scored call' })).toBeVisible();

  // The genuinely-empty-state copy must be gone now that there's a record.
  await expect(page.getByText('No scored predictions yet')).toHaveCount(0);

  // Ten fixed calibration deciles, per §10 — 0–10% is always the first band.
  const calibrationSection = page.locator('section[aria-labelledby="calibration-heading"]');
  await expect(calibrationSection.getByText('0–10%')).toBeVisible();

  // At least one scored row in "Every scored call", with a Brier score
  // rendered as a decimal (not the empty-state "—").
  const scoredCallsSection = page.locator('section[aria-labelledby="calls-heading"]');
  const rows = scoredCallsSection.locator('tbody tr');
  expect(await rows.count()).toBeGreaterThan(0);
  await expect(rows.first()).toContainText(/\d\.\d{2}/);
});

// ── /responsible-gambling — real support links, not placeholders ───────────
test('/responsible-gambling has real tel: and https: support links, no placeholders', async ({
  page,
}) => {
  await page.goto('/responsible-gambling', { waitUntil: 'load' });

  const telLinks = page.locator('a[href^="tel:"]');
  expect(await telLinks.count()).toBeGreaterThan(0);

  const httpsLinks = page.locator('a[href^="https://"]');
  expect(await httpsLinks.count()).toBeGreaterThan(0);

  // The old scaffolding explicitly said resources were unverified placeholders.
  await expect(page.getByText(/to be confirmed/i)).toHaveCount(0);
  await expect(page.getByText(/verify yourself/i)).toHaveCount(0);
});

// ── /match/[id] — the timestamp audit line + "Our call:" phrasing ──────────
// Covers two of the frontend v2 changes together: published_at/locked_at/
// scored_at are now selected and rendered (AuditLine), and every scored-call
// surface uses "Our call:" instead of the old "We backed"/"Backed" betting
// vernacular (lib/format.ts OUR_CALL_LABEL).
test('/match/1 (preview, scored) shows the audit line and "Our call:" phrasing', async ({
  page,
}) => {
  await page.goto('/match/1', { waitUntil: 'load' });

  // The audit line: "Published <time> · locked <time> · scored <time>".
  await expect(page.getByText(/^Published/)).toBeVisible();
  await expect(page.getByText(/^Published/)).toContainText('locked');
  await expect(page.getByText(/^Published/)).toContainText('scored');
  // Kickoff (MatchHeader) + published/locked/scored (AuditLine) => 4 <time>s.
  expect(await page.locator('time').count()).toBeGreaterThanOrEqual(4);

  await expect(page.getByText(/Our call:/)).toBeVisible();
  await expect(page.getByText(/We backed/)).toHaveCount(0);
});

// A voided prediction is NEVER presented as our call (§9, §10) — the honesty
// invariant that makes "Our call:" trustworthy everywhere else it appears.
//
// Copy note (v2 hardening): the voided-note copy now covers TWO cases -- a
// prediction that missed the kickoff lock, OR a fixture cancelled/abandoned
// after locking (the new `void_cancelled` status) -- so "voided" and
// "excluded from our scored record" are no longer one contiguous phrase.
// Asserted as two separate substrings of the same visible text so the test
// tracks the accurate, expanded copy rather than one exact phrase.
test('/match/6 (preview, voided) never shows "Our call:" for the excluded prediction', async ({
  page,
}) => {
  await page.goto('/match/6', { waitUntil: 'load' });

  const voidedNote = page.getByText(/was voided/i);
  await expect(voidedNote).toBeVisible();
  await expect(voidedNote).toContainText(/excluded from our scored record/i);
  await expect(page.getByText(/Our call:/)).toHaveCount(0);
});
