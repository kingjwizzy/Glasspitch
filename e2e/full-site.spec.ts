import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  expectLandmarksAndCompliance,
  expectNoSeriousA11yViolations,
  gotoAndExpectNoRuntimeErrors,
} from './helpers';

// v3 "full site" round: the new growth/SEO surfaces (ARCHITECTURE.md §11) --
// /matches (the fixtures crawl hub), /leagues (the competition browse index),
// /methodology (the trust/SEO deep page) and /stats/golden-boot (the top
// scorers leaderboard, migration 0005) -- plus the Header's new "Matches" /
// "Leagues" nav links and static "Sign in" affordance now that legal sign-off
// and ICO registration let accounts be surfaced in the public UI.
//
// Mirrors legal.spec.ts's loop-plus-specifics shape and reuses e2e/helpers.ts
// rather than re-declaring smoke.spec.ts's local assertions a third time.
//
// /matches renders through its PREVIEW_MATCHES=1 hatch (playwright.config.ts
// webServer env) for deterministic day-grouping/probability-bar assertions --
// the same treatment /ledger, /match/[id], /team/[slug] and /league/[slug]
// already get in this suite. /leagues and /stats/golden-boot deliberately have
// NO preview hatch of their own (src/lib/queries/league.ts,
// src/lib/queries/goldenBoot.ts): both degrade to an honest empty state on ANY
// backing-store condition (DESIGN.md §9), so this spec accepts either a
// populated result or the documented empty-state copy rather than assuming
// the shared webServer's real Supabase project has rows -- migration 0005
// (top_scorers) had not been applied live as of this round (see STATUS.md /
// the backend-jobs report), so the honest empty state is what actually
// renders today.

const NEW_PAGES = ['/matches', '/leagues', '/methodology', '/stats/golden-boot'] as const;

for (const path of NEW_PAGES) {
  test(`${path} renders with no runtime errors`, async ({ page }) => {
    await gotoAndExpectNoRuntimeErrors(page, path);
  });

  test(`${path} has the shared landmarks, disclaimer, and only sanctioned images`, async ({
    page,
  }) => {
    await page.goto(path, { waitUntil: 'load' });
    await expectLandmarksAndCompliance(page);
  });

  test(`${path} has no serious or critical a11y violations`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' });
    await expectNoSeriousA11yViolations(page);
  });
}

// ── Header: "Matches" / "Leagues" nav links + a static "Sign in" affordance ──
// (v3 amendment: accounts may now be surfaced in the public UI, but the
// header itself must stay a plain, session-unaware server component -- a
// cached public page can never branch on auth state, so "Sign in" is always a
// static link to /login, which itself redirects an already-signed-in visitor
// to /account.)
//
// Audit fix #2 (CRITICAL): below md there is no room for eight inline links
// on a phone-width viewport (a 393px Pixel 5 clipped the row to "Home | Ma…"),
// so Header's inline `nav[aria-label="Primary"]` row is now `hidden md:flex`.
//
// RAMBO wave 3 #6 amendment: below md, the reachable affordance is no longer
// a single hamburger beside the header -- Home/Matches/Play/Track record were
// promoted into a persistent BottomTabBar (src/components/BottomTabBar.tsx),
// one thumb-tap away, and MobileNav (src/components/MobileNav.tsx) now renders
// ONLY the leftover OVERFLOW destinations (Chances/Leagues/Leaderboard/About)
// as the bar's 5th "More" slot. The two viewport projects therefore need two
// different routes to the same destinations -- split into a desktop test (the
// inline row, unchanged contract) and a mobile test that opens the "More"
// dialog and finds only the overflow set (the bottom-tab-bar's own contract is
// covered separately below).
test('primary nav (desktop) shows Matches, Chances, Leagues, Play, and a static Sign in link to /login', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'desktop-only: below md the inline row is hidden — see the mobile hamburger test below',
  );
  await page.goto('/', { waitUntil: 'load' });
  const primaryNav = page.locator('nav[aria-label="Primary"]');
  await expect(primaryNav).toBeVisible();
  await expect(primaryNav.getByRole('link', { name: 'Matches', exact: true })).toHaveAttribute(
    'href',
    '/matches',
  );
  await expect(primaryNav.getByRole('link', { name: 'Leagues', exact: true })).toHaveAttribute(
    'href',
    '/leagues',
  );
  // W6: "Chances" (the daily-simulated World Cup circles) and "Play" (the
  // prize-free Beat the Model game) joined the nav as QUIET links — same
  // visual weight as every other item, no badge/pulse/attention mechanics
  // (DESIGN.md §6), and the header stays a session-unaware server component.
  await expect(primaryNav.getByRole('link', { name: 'Chances', exact: true })).toHaveAttribute(
    'href',
    '/chances',
  );
  await expect(primaryNav.getByRole('link', { name: 'Play', exact: true })).toHaveAttribute(
    'href',
    '/play',
  );
  // RAMBO wave 2 #5: "Leaderboard" (the public, opt-in Beat the Model board)
  // joined the same quiet inline row.
  await expect(primaryNav.getByRole('link', { name: 'Leaderboard', exact: true })).toHaveAttribute(
    'href',
    '/leaderboard',
  );
  // "Sign in" sits just outside the <nav> landmark itself (Header.tsx) but is
  // still a plain static link, not a client-side auth affordance.
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute(
    'href',
    '/login',
  );
});

// The 4 OVERFLOW destinations MobileNav's "More" panel renders now that
// Home/Matches/Play/Track record live one thumb-tap away on the persistent
// BottomTabBar (RAMBO wave 3 #6). Mirrors Header's exported `NAV` filtered by
// `BOTTOM_TAB_HREFS` (src/components/MobileNav.tsx's own `OVERFLOW_NAV`), kept
// literal here rather than imported so this spec independently pins the
// contract rather than trusting the same source it's testing.
const MOBILE_OVERFLOW_NAV_LINKS = [
  { name: 'Chances', href: '/chances' },
  { name: 'Leagues', href: '/leagues' },
  { name: 'Leaderboard', href: '/leaderboard' },
  { name: 'About', href: '/about' },
] as const;

test('primary nav (mobile): the "More" panel reaches the 4 overflow destinations plus Sign in', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile',
    'mobile-only: exercises the below-md MobileNav "More" panel',
  );
  await page.goto('/', { waitUntil: 'load' });

  // The inline row stays in the DOM (aria-controls keeps pointing at a real
  // element) but is not visible at this viewport — the bottom bar's "More"
  // toggle is the reachable affordance for the overflow set instead.
  const primaryNav = page.locator('nav[aria-label="Primary"]');
  await expect(primaryNav).toBeHidden();

  // The toggle button is identified by its `aria-controls` link to the
  // panel's id, not by its accessible name: that name flips between "Open
  // menu" / "Close menu" as it opens and closes (MobileNav.tsx), AND once
  // open the panel's own dedicated close button also reads "Close menu" —
  // matching by name alone is either stale or ambiguous. The panel element
  // (a plain CSS attribute selector, so it resolves even while hidden/
  // pre-open, unlike getByRole which excludes hidden elements) carries the
  // real id `aria-controls` must reference.
  const panel = page.locator('[role="dialog"][aria-label="Primary navigation"]');
  const panelId = await panel.getAttribute('id');
  const toggle = page.locator(`button[aria-controls="${panelId}"]`);
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAccessibleName('Open menu');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // The toggle is now the bottom bar's own 5th slot, captioned "More"
  // (aria-hidden — see MobileNav.tsx's label/name-mismatch note, exercised
  // directly in the a11y test below).
  await expect(toggle).toContainText('More');

  // Closed: no dialog is actually visible yet (MobileNav's panel stays
  // parked in the DOM under `hidden`, out of the accessibility tree).
  await expect(page.getByRole('dialog', { name: 'Primary navigation' })).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAccessibleName('Close menu');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  const dialog = page.getByRole('dialog', { name: 'Primary navigation' });
  await expect(dialog).toBeVisible();

  // The 4 overflow destinations plus "Sign in" are reachable inside the open
  // panel — Home/Matches/Play/Track record are DELIBERATELY absent here: they
  // now live on the persistent bottom tab bar instead (see the dedicated test
  // below), so this panel must never duplicate them.
  for (const { name, href } of MOBILE_OVERFLOW_NAV_LINKS) {
    await expect(dialog.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  }
  for (const name of ['Home', 'Matches', 'Play', 'Track record'] as const) {
    await expect(
      dialog.getByRole('link', { name, exact: true }),
      `"${name}" moved to the bottom tab bar — the overflow panel must not duplicate it`,
    ).toHaveCount(0);
  }
  await expect(dialog.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute(
    'href',
    '/login',
  );
  // NEXT_PUBLIC_PREMIUM_LIVE is unset in this build, so "Go Premium" must not
  // appear yet (env-gated — see src/components/MobileNav.tsx).
  await expect(dialog.getByRole('link', { name: 'Go Premium' })).toHaveCount(0);

  // Every link in the open panel, including the last ("Sign in"), must
  // actually be reachable inside the viewport — not just present in the DOM.
  // KNOWN BUG (frontend-dev, not a test issue): MobileNav is now mounted as
  // BottomTabBar's 5th slot, and that bar's `<nav>` carries `backdrop-blur-sm`
  // — per the CSS Filter Effects spec, a `backdrop-filter` on an ancestor
  // becomes the CONTAINING BLOCK for descendant `position: fixed` elements,
  // exactly like `transform`/`filter`. MobileNav's overlay
  // (`<div class="fixed inset-0 ...">`) is now a descendant of that
  // bottom-anchored, ~56px-tall `<nav>` instead of the viewport, so the
  // overlay/backdrop/dialog are squeezed into that tiny box pinned to the
  // BOTTOM of the screen rather than covering the full viewport — the
  // previous mount point (inside the sticky, TOP-anchored Header, which also
  // carries backdrop-blur-sm) happened to hide this exact same quirk, because
  // that ancestor's top edge already coincided with the viewport's top edge.
  // Confirmed live (Pixel 5 viewport, 393×727): the panel's own bounding box
  // renders at roughly y≈683–995 — i.e. the bottom ~40% of its content,
  // including this "Sign in" link, sits BELOW the visible viewport with no
  // way to scroll it into view (the overlay is fixed to the tiny nav box, not
  // the page). This makes roughly half the "More" panel unreachable on a real
  // phone. Fix belongs in BottomTabBar.tsx/MobileNav.tsx (e.g. render the
  // overlay through a portal to `document.body`, or drop `backdrop-blur-sm`
  // from the bottom nav) — NOT here.
  for (const { name } of MOBILE_OVERFLOW_NAV_LINKS) {
    await expect(
      dialog.getByRole('link', { name, exact: true }),
      `"${name}" must be reachable inside the viewport, not merely present in the DOM`,
    ).toBeInViewport();
  }
  await expect(
    dialog.getByRole('link', { name: 'Sign in', exact: true }),
    '"Sign in" must be reachable inside the viewport, not merely present in the DOM',
  ).toBeInViewport();

  // A link click closes the panel and actually navigates.
  await dialog.getByRole('link', { name: 'About', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/about$/);

  // Re-open (same Header/MobileNav instance persists across the client
  // navigation — the root layout doesn't remount), then Esc closes it and
  // returns focus to the toggle. Checked as its own action (not chained onto
  // the link-click navigation above) so Next.js's own post-navigation focus
  // management can never be mistaken for — or mask — this component's own
  // close-and-restore-focus behaviour.
  await toggle.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(toggle).toBeFocused();
});

// ── Bottom tab bar (RAMBO wave 3 #6) — the persistent, thumb-reachable below-
// md primary reach for Home/Matches/Play/Track record, replacing "every
// destination is two taps deep behind a hamburger" (src/components/
// BottomTabBar.tsx). A SECOND, DISTINCTLY-LABELLED `<nav>` landmark from
// Header's own `nav[aria-label="Primary"]` — never the same reach mechanism
// at both viewports. ──────────────────────────────────────────────────────
test('bottom tab bar: mobile primary reach with 5 slots incl. "More" and an active-state tab; desktop keeps the header nav as the reach', async ({
  page,
}, testInfo) => {
  await page.goto('/', { waitUntil: 'load' });
  const bottomNav = page.locator('nav[aria-label="Bottom navigation"]');

  if (testInfo.project.name === 'mobile') {
    await expect(bottomNav).toBeVisible();

    const tabs = [
      { name: 'Home', href: '/' },
      { name: 'Matches', href: '/matches' },
      { name: 'Play', href: '/play' },
      { name: 'Track record', href: '/ledger' },
    ] as const;
    for (const { name, href } of tabs) {
      await expect(bottomNav.getByRole('link', { name, exact: true })).toHaveAttribute(
        'href',
        href,
      );
    }
    // 5 slots total: the 4 tabs above plus the "More" toggle (shares the same
    // "Open menu"/"Close menu" accessible name as the hamburger contract
    // exercised above).
    await expect(bottomNav.locator('> ul > li')).toHaveCount(5);
    const more = bottomNav.getByRole('button', { name: /open menu|close menu/i });
    await expect(more).toBeVisible();

    // Active-state: on "/", the Home tab carries aria-current="page" and NO
    // other tab does (BottomTabLink.tsx's isActive — exact match for "/",
    // prefix match for everything else).
    await expect(bottomNav.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const name of ['Matches', 'Play', 'Track record'] as const) {
      await expect(bottomNav.getByRole('link', { name, exact: true })).not.toHaveAttribute(
        'aria-current',
        'page',
      );
    }
  } else {
    // Desktop: the bottom bar is `md:hidden` — the header's inline nav is the
    // one and only primary reach, never a secondary/duplicate mechanism.
    await expect(bottomNav).toBeHidden();
    await expect(page.locator('nav[aria-label="Primary"]')).toBeVisible();
  }
});

test('bottom tab bar (mobile): two distinctly-labelled nav landmarks, no label/name mismatch on the "More" toggle', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile',
    'mobile-only: exercises the below-md landmark set',
  );
  await page.goto('/', { waitUntil: 'load' });

  // Every <nav> on the page carries its own aria-label, and no two share one
  // — Header's `nav[aria-label="Primary"]` (hidden, still attached) and
  // BottomTabBar's `nav[aria-label="Bottom navigation"]` (visible) must never
  // read as ambiguous, identically-labelled landmarks to a screen reader.
  const navs = page.locator('nav');
  const navCount = await navs.count();
  expect(navCount).toBeGreaterThanOrEqual(2);
  const labels = new Set<string>();
  for (let i = 0; i < navCount; i++) {
    const label = await navs.nth(i).getAttribute('aria-label');
    expect(label, `nav[${i}] must have an aria-label`).toBeTruthy();
    labels.add(label ?? '');
  }
  expect(labels.size, 'every nav landmark must have a distinct aria-label').toBe(navCount);

  // WCAG 2.5.3 Label in Name: the "More" toggle's visible caption is
  // aria-hidden (a redundant visual cue, not the accessible name — see
  // MobileNav.tsx's comment), so axe's dedicated rule is the direct,
  // automated check that this is never a genuine mismatch.
  const results = await new AxeBuilder({ page })
    .withRules(['label-content-name-mismatch'])
    .analyze();
  expect(results.violations).toEqual([]);
});

// ── /matches (populated via PREVIEW_MATCHES=1) ──────────────────────────────
test('/matches groups upcoming fixtures by day and lists recent results', async ({ page }) => {
  await page.goto('/matches', { waitUntil: 'load' });

  await expect(page.getByRole('heading', { name: 'Upcoming fixtures' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent results' })).toBeVisible();

  // Day-group sub-headings (h3) group the upcoming fixtures under the
  // "Upcoming fixtures" h2.
  const dayHeadings = page.locator('h3');
  expect(await dayHeadings.count()).toBeGreaterThan(0);

  // At least one probability bar renders for a published call, labelled with
  // all three outcomes (DESIGN.md §2: colour is never the sole signal).
  const probBars = page.locator('[role="img"][aria-label^="Win probability"]');
  const barCount = await probBars.count();
  expect(barCount, '/matches (populated) should render at least one probability bar').toBeGreaterThan(0);
  for (let i = 0; i < barCount; i++) {
    const label = await probBars.nth(i).getAttribute('aria-label');
    expect(label).toMatch(/Home \d+%, draw \d+%, away \d+%/);
  }

  // Recent results include a scored call: no "We backed"/betting vernacular.
  await expect(page.getByText(/We backed/)).toHaveCount(0);
});

test('/matches links through to /ledger for the full record', async ({ page }) => {
  await page.goto('/matches', { waitUntil: 'load' });
  await expect(page.getByRole('link', { name: 'Full record' })).toHaveAttribute('href', '/ledger');
});

// ── /leagues ─────────────────────────────────────────────────────────────
test('/leagues lists competitions with a fixture count, or shows the honest empty state', async ({
  page,
}) => {
  await page.goto('/leagues', { waitUntil: 'load' });
  await expect(page.getByRole('heading', { name: 'Leagues', exact: true, level: 1 })).toBeVisible();

  const emptyState = page.getByText('No competitions in our record yet.');
  const cards = page.locator('a[href^="/league/"]');
  const cardCount = await cards.count();
  if (cardCount === 0) {
    await expect(emptyState).toBeVisible();
  } else {
    await expect(cards.first()).toContainText(/fixture/);
    // Plain-text league name/country only -- no crest, mark, or logo image.
    await expect(cards.first().locator('img')).toHaveCount(0);
  }
});

// ── /methodology ─────────────────────────────────────────────────────────
test('/methodology states the exact Brier and log-loss formulas', async ({ page }) => {
  await page.goto('/methodology', { waitUntil: 'load' });
  await expect(page.getByRole('heading', { name: 'Methodology', level: 1 })).toBeVisible();
  await expect(page.getByText('BS = (p_home', { exact: false })).toBeVisible();
  await expect(page.getByText(/LL = .ln\(p_correct\)/)).toBeVisible();
});

test('/methodology links through to /ledger and /matches', async ({ page }) => {
  await page.goto('/methodology', { waitUntil: 'load' });
  // exact: true -- the "Audit any call yourself" section has a separate
  // "full ledger" link (not an exact "ledger" match) and Playwright's default
  // name matching is a case-insensitive substring match, so an unscoped
  // "ledger" would resolve too broadly. The audit-fix "Sealed with a hash
  // chain" section (#hash-chain) added a SECOND exact "ledger" link
  // alongside the original one -- both point at the same destination, so
  // assert every exact "ledger" link resolves to /ledger rather than picking
  // one arbitrarily (this only strengthens the check: now covers 2 links).
  const ledgerLinks = page.getByRole('link', { name: 'ledger', exact: true });
  expect(await ledgerLinks.count()).toBeGreaterThanOrEqual(2);
  const ledgerLinkCount = await ledgerLinks.count();
  for (let i = 0; i < ledgerLinkCount; i++) {
    await expect(ledgerLinks.nth(i)).toHaveAttribute('href', '/ledger');
  }
  await expect(page.getByRole('link', { name: 'matches list' })).toHaveAttribute(
    'href',
    '/matches',
  );
});

test('/about and /ledger link through to /methodology', async ({ page }) => {
  await page.goto('/about', { waitUntil: 'load' });
  await expect(
    page.locator('article').getByRole('link', { name: 'methodology', exact: true }),
  ).toHaveAttribute('href', '/methodology');

  await page.goto('/ledger', { waitUntil: 'load' });
  await expect(
    page.locator('article').getByRole('link', { name: 'methodology', exact: true }),
  ).toHaveAttribute('href', '/methodology');
});

// ── /stats/golden-boot -- either a populated top-15 table, or the honest
// empty state (see the file-header note: migration 0005 had not been applied
// live as of this round, so the honest empty state is what actually renders
// today; this spec is written to keep passing once the pipeline has run) ────
test('/stats/golden-boot renders a populated top-15 table or the honest empty state', async ({
  page,
}) => {
  await page.goto('/stats/golden-boot', { waitUntil: 'load' });
  await expect(page.getByRole('heading', { name: 'Golden Boot race', level: 1 })).toBeVisible();

  const table = page.locator('table');
  const emptyState = page.getByText(
    'Top-scorer standings appear once the data pipeline first runs.',
  );

  if ((await table.count()) > 0) {
    const rows = table.locator('tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
    expect(rowCount).toBeLessThanOrEqual(15);
    // Rank is a plain ordinal 1..N with no gaps.
    await expect(rows.first().locator('td').first()).toHaveText('1');
    // No photos or crests anywhere in the table (ARCHITECTURE.md §13). W6:
    // decorative NATIONAL FLAGS are sanctioned (public-domain national
    // symbols, same W4 sanction as team-name surfaces) — so every <img> must
    // be a vendored flag SVG, hidden from the tree, with the plain-text
    // nation still the identifier. Anything else (a photo, a crest) fails.
    const imgs = table.locator('img');
    const imgCount = await imgs.count();
    for (let i = 0; i < imgCount; i++) {
      await expect(imgs.nth(i)).toHaveAttribute('src', /^\/flags\/[a-z-]+\.svg$/);
      await expect(imgs.nth(i)).toHaveAttribute('alt', '');
      await expect(imgs.nth(i)).toHaveAttribute('aria-hidden', 'true');
    }
  } else {
    await expect(emptyState).toBeVisible();
  }
});

// Home page's new Golden Boot section (v3): either a populated top-5 race or
// the same honest empty state -- both read the same `top_scorers` table with
// no PREVIEW hatch of their own, so they always agree on which state renders.
test('home page Golden Boot section renders a populated race or the honest empty state', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'load' });
  const section = page.locator('section[aria-labelledby="golden-boot-heading"]');
  await expect(section).toBeVisible();
  await expect(section.getByRole('heading', { name: 'Golden Boot race' })).toBeVisible();
  await expect(section.getByRole('link', { name: 'Full standings' })).toHaveAttribute(
    'href',
    '/stats/golden-boot',
  );

  // W4: the empty state is now an aria-hidden em-dash SKELETON list plus the
  // honest copy — so a populated race is specifically a NON-hidden <ol>.
  const rows = section.locator('ol:not([aria-hidden="true"]) li');
  const rowCount = await rows.count();
  if (rowCount > 0) {
    expect(rowCount).toBeLessThanOrEqual(5);
    // W6: nationality flags are sanctioned in the Golden Boot race (owner
    // request — "flags now, faces eventually"), but only as decorative
    // vendored flag SVGs; any photo/crest <img> still fails (§13).
    const imgs = section.locator('img');
    const imgCount = await imgs.count();
    for (let i = 0; i < imgCount; i++) {
      await expect(imgs.nth(i)).toHaveAttribute('src', /^\/flags\/[a-z-]+\.svg$/);
      await expect(imgs.nth(i)).toHaveAttribute('alt', '');
      await expect(imgs.nth(i)).toHaveAttribute('aria-hidden', 'true');
    }
  } else {
    await expect(
      section.getByText('Top-scorer standings appear once the data pipeline first runs.'),
    ).toBeVisible();
  }
});
