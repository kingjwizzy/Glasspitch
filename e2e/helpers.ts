import { type Page, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Shared assertions for the v2 premium specs (login/premium/legal/guardrails)
// -- factored out of smoke.spec.ts's local helper of the same intent so the
// new v2 surface doesn't duplicate it a third and fourth time. smoke.spec.ts
// itself is left untouched (it already passes; no reason to risk it).

/** The one sanctioned image source (W4 owner amendment to ARCHITECTURE.md
 *  §13): vendored circle-flag national flags. Everything else — crests,
 *  player photos, tournament marks — remains banned. */
const FLAG_SRC_PREFIX = '/flags/';

/** No dark-pattern / urgency vocabulary anywhere in the rendered page
 *  (DESIGN.md §6): the W4 redesign added a sign-up end-cap, and this pins the
 *  no-pressure-copy invariant site-wide so it can never regress. */
export async function expectNoDarkPatternVocabulary(page: Page) {
  const bodyText = await page.locator('body').innerText();
  expect(
    bodyText,
    'dark-pattern / urgency vocabulary must never appear (DESIGN.md §6)',
  ).not.toMatch(/hurry|only today|last chance|don['’]t miss/i);
}

/** Image compliance (ARCHITECTURE.md §13, W4 amendment): the ONLY images
 *  allowed anywhere are the sanctioned national flags under /flags/ — no team
 *  crests, player photos, or tournament marks. Every flag must be strictly
 *  decorative (alt="" + aria-hidden) with fixed dimensions (zero CLS), and the
 *  plain-text team name must sit right beside it as the real identifier. */
export async function expectOnlySanctionedImages(page: Page) {
  await expect(
    page.locator(`img:not([src^="${FLAG_SRC_PREFIX}"])`),
    'the only sanctioned <img> source is /flags/ (ARCHITECTURE.md §13)',
  ).toHaveCount(0);

  const flags = page.locator(`img[src^="${FLAG_SRC_PREFIX}"]`);
  const count = await flags.count();
  for (let i = 0; i < count; i++) {
    const flag = flags.nth(i);
    await expect(flag, `flag[${i}] must be aria-hidden`).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    await expect(flag, `flag[${i}] must have an empty alt`).toHaveAttribute('alt', '');
    // Fixed intrinsic size — the zero-CLS half of the TeamFlag contract.
    await expect(flag, `flag[${i}] must have a fixed width`).toHaveAttribute(
      'width',
      /^\d+$/,
    );
    await expect(flag, `flag[${i}] must have a fixed height`).toHaveAttribute(
      'height',
      /^\d+$/,
    );
    // The decorative flag never stands alone: its immediate container must
    // carry the plain-text team name (the primary identifier, §13).
    const adjacentText = await flag
      .locator('xpath=..')
      .evaluate((el) => el.textContent?.trim() ?? '');
    expect(
      adjacentText.length,
      `flag[${i}] must sit beside a plain-text team name`,
    ).toBeGreaterThan(0);
  }
}

/** Primary-nav reachability, viewport-aware (audit #2 amendment):
 *  Header.tsx's inline `nav[aria-label="Primary"]` row is `hidden md:flex` —
 *  below md there is no room for seven inline links on a phone-width
 *  viewport, so MobileNav's hamburger (a client island beside Header) takes
 *  over instead, and the landmark itself stays parked in the DOM (so its own
 *  `aria-controls`/labelling stay wired to a real element) without being
 *  visible. Asserting plain `.toBeVisible()` on the landmark unconditionally
 *  would therefore fail on every page at the Pixel 5 viewport by design, not
 *  by regression — this checks the reachable affordance for whichever
 *  viewport is actually rendering: the inline nav at md+, the hamburger
 *  toggle below it. Dedicated hamburger *behaviour* (open/close/focus) is
 *  covered separately in full-site.spec.ts. */
export async function expectPrimaryNavReachable(page: Page) {
  const primaryNav = page.locator('nav[aria-label="Primary"]');
  await expect(primaryNav).toBeAttached();

  const viewport = page.viewportSize();
  const isBelowMd = (viewport?.width ?? 1280) < 768;
  if (isBelowMd) {
    await expect(primaryNav).toBeHidden();
    await expect(page.getByRole('button', { name: /open menu|close menu/i })).toBeVisible();
  } else {
    await expect(primaryNav).toBeVisible();
  }
}

/** Structural/compliance assertions every page must satisfy regardless of
 *  route or auth state (ARCHITECTURE.md §13; DESIGN.md §2, §6). Assumes `page`
 *  has already navigated. */
export async function expectLandmarksAndCompliance(page: Page) {
  const banner = page.locator('[role="region"][aria-label="Compliance disclaimer"]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('not betting advice');
  await expect(banner).toContainText('18+');

  const footer = page.locator('footer');
  await expect(footer).toContainText('not betting advice');

  await expectPrimaryNavReachable(page);

  await expect(page.locator('h1')).toHaveCount(1);

  // W4 amendment: aria-hidden national flags beside plain-text team names are
  // sanctioned; every other image (crests, photos, marks) is still banned.
  await expectOnlySanctionedImages(page);

  // No urgency/pressure copy on any page (DESIGN.md §6).
  await expectNoDarkPatternVocabulary(page);
}

/** No serious/critical axe violations on the current page (WCAG 2.0/2.1
 *  A/AA) -- shared severity floor and tag set for every spec. */
export async function expectNoSeriousA11yViolations(page: Page) {
  // Audit the SETTLED presentation. The W4 motion kit's scroll-driven reveals
  // (`animation-timeline: view()`) hold a section that straddles the fold at
  // an intermediate opacity as a pure function of scroll position, and axe
  // correctly measures that as a blended, sub-AA foreground colour — making
  // the audit a lottery on viewport height and page geometry rather than a
  // check of the design. Emulating reduced motion (honoured by the global
  // kill-switch in globals.css) pins every element at its final state, so the
  // audit is deterministic at any viewport while still covering the identical
  // DOM, colours, names and roles. The motion kit itself has dedicated
  // coverage in home.spec.ts, and the mid-reveal contrast caveat is tracked
  // as a frontend finding (consider a transform-only reveal keyframe).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const seriousOrWorse = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  const report = seriousOrWorse
    .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
    .join('\n');
  expect(seriousOrWorse, `a11y violations:\n${report}`).toEqual([]);
}

/** Navigate to `path` and assert a non-error status, no uncaught page errors,
 *  and no console errors -- the runtime half of every smoke test in this repo. */
export async function gotoAndExpectNoRuntimeErrors(page: Page, path: string) {
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

  expect(pageErrors, `uncaught page errors on ${path}`).toEqual([]);
  expect(consoleErrors, `console errors on ${path}`).toEqual([]);
  return response;
}
