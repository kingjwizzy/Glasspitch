import { test, expect } from '@playwright/test';

// W4 homepage redesign ("Receipts under floodlight") — structural assertions
// for the POPULATED page, rendered by the shared webServer's preview hatch
// (PREVIEW_HOMEPAGE=1 + ALLOW_PREVIEW=1, playwright.config.ts): the hero band
// (featured match + ledger proof rail), the day-grouped matchday stream, the
// receipt rows, the record band with its guessing baseline, the single
// sign-up end-cap, and the CSS-only motion kit's reduced-motion behaviour.
//
// The preview fixtures are generated RELATIVE to render time
// (src/lib/queries/homepage.preview.ts), so nothing here pins an exact date,
// day-group title, or kickoff phrase — only the structures the spec demands.
// The complementary EMPTY structural state is covered by home-empty.spec.ts
// against the second webServer.

test.beforeEach(async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
});

// ── §1 Hero band: kicker + freshness stamp + featured match ────────────────
test('/ hero band leads with the kicker, freshness stamp, and featured match', async ({
  page,
}) => {
  // One-line kicker h1 + subline — the marketing paragraph is gone.
  // WC-window SEO (audit #10): the h1 is temporarily World-Cup-specific while
  // the tournament is live/imminent — revert to "Football analysis you can
  // check" once it reverts in source (see src/app/page.tsx's HOME_TITLE note).
  await expect(page.locator('h1')).toHaveText('World Cup 2026 predictions you can check');
  await expect(
    page.getByText('Every call locked at kickoff, scored either way.'),
  ).toBeVisible();
  // RAMBO wave 3 #3b: the calm subhead carries the compliance framing as a
  // brand line — "probabilities, not tips" — not a scary banner.
  await expect(page.getByText(/probabilities, not tips/)).toBeVisible();

  // The ISR freshness stamp: honest "as of" phrasing, never a live clock.
  await expect(
    page.getByText(/Updated \d{2}:\d{2} UTC · refreshes after every final whistle/),
  ).toBeVisible();

  const hero = page.locator('section[aria-labelledby="home-kicker"]');
  // The featured match is one full-card link to its match page, with the team
  // names as the card's heading (plain text, flags only decorative).
  const card = hero.locator('a[href^="/match/"]').filter({ has: page.locator('h2') });
  await expect(card).toHaveCount(1);
  await expect(card.locator('h2')).toBeVisible();
  await expect(card.getByText('Full analysis')).toBeVisible();

  // The kickoff-or-live-score shared slot: preview default is an upcoming
  // fixture, so the coarse kickoff phrase renders (never a ticking countdown).
  await expect(card.getByText(/^Kicks off /)).toBeVisible();

  // The probability trio is printed (H/D/A letter chip + the actual TEAM NAME
  // per figure, each dd a percentage) — W6: home/away reads as ambiguous at a
  // neutral-venue World Cup, so the trio names the real teams (Brazil v Spain
  // is the fixed default-preview hero fixture) with the letter chip only as a
  // secondary marker. The hero bar keeps the full three-outcome accessible
  // label (colour never the sole signal).
  await expect(card.locator('dt')).toHaveText([/Brazil/, /Draw/, /Spain/]);
  await expect(card.locator('dd')).toHaveText([
    /^(\d+|<1|>99)%$/,
    /^(\d+|<1|>99)%$/,
    /^(\d+|<1|>99)%$/,
  ]);
  await expect(card.locator('[role="img"][aria-label^="Win probability"]')).toHaveCount(
    1,
  );
  await expect(card.getByText('predicted score')).toBeVisible();
  await expect(card.getByText(/\d–\d/).first()).toBeVisible();

  // Provenance microline — every claim checkable.
  const provenance = card.getByText(/third-party model · published /);
  await expect(provenance).toBeVisible();
  await expect(provenance).toContainText('scored either way');

  // "Also today" — the one-line factual mono summary under the card.
  await expect(page.getByText(/^Also today: /)).toBeVisible();
});

// ── "How it works" strip (RAMBO wave 3 #7b) — promotes the lock → whistle →
// scored loop from empty-state-only decoration to an always-present, plainly
// labelled explanation, right after the hero band. ─────────────────────────
test('/ "How it works" strip states the three-step honesty loop', async ({ page }) => {
  const strip = page.locator('section[aria-labelledby="how-it-works-heading"]');
  await expect(strip.getByRole('heading', { name: 'How it works' })).toBeVisible();

  const steps = strip.locator('ol > li');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText('We publish before kickoff');
  await expect(steps.nth(1)).toContainText("It locks and can't be edited");
  await expect(steps.nth(2)).toContainText('We score it after full-time, misses included');
});

// ── §1 Proof rail: the record beside the featured match ────────────────────
test('/ proof rail shows the record, the ✓/✗ receipts strip, and the immutability claim', async ({
  page,
}) => {
  const hero = page.locator('section[aria-labelledby="home-kicker"]');

  // The rail announces itself to AT even though its h2 is visually hidden.
  await expect(page.getByRole('heading', { name: 'Our record at a glance' })).toHaveCount(
    1,
  );

  // Three stat tiles with sentence-case labels and real figures (preview data
  // guarantees a populated record — no em-dashes here).
  for (const label of ['predictions scored', 'mean Brier', 'most-likely outcome landed']) {
    await expect(hero.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(hero.getByText(/^\d+ of \d+$/)).toBeVisible();
  await expect(hero.getByText(/^0\.\d{3}$/)).toBeVisible();

  // The ✓/✗ chip strip: each chip links to its match page, names the call in
  // its accessible label, and carries the glyph (an svg) — misses shown at the
  // same weight as hits, so BOTH kinds must be present with preview data.
  const chips = hero.locator('a[aria-label*="correct call"], a[aria-label*="missed call"]');
  expect(await chips.count()).toBeGreaterThan(0);
  expect(await hero.locator('a[aria-label*="correct call"]').count()).toBeGreaterThan(0);
  expect(await hero.locator('a[aria-label*="missed call"]').count()).toBeGreaterThan(0);
  const chipCount = await chips.count();
  for (let i = 0; i < chipCount; i++) {
    const chip = chips.nth(i);
    await expect(chip).toHaveAttribute('href', /^\/match\//);
    await expect(chip.locator('svg')).toHaveCount(1);
  }

  // The immutability claim — softened from a bare assertion into a
  // verifiable hash-chain framing (audit fix): published/locked, then sealed
  // into a public SHA-256 hash chain, linking through to the methodology's
  // #hash-chain section rather than just asserting "trust us".
  await expect(hero.getByText(/sealed into a public/)).toBeVisible();
  await expect(hero.getByText(/tamper-evident, not just promised/)).toBeVisible();
  await expect(hero.getByRole('link', { name: 'SHA-256 hash chain' })).toHaveAttribute(
    'href',
    '/methodology#hash-chain',
  );
  await expect(hero.getByRole('link', { name: 'See the full ledger' })).toHaveAttribute(
    'href',
    '/ledger',
  );
});

// ── §2 Matchday stream: day groups, printed H/D/A lines, honest liveness ───
test('/ matchday stream groups fixtures by day with always-printed probability lines', async ({
  page,
}) => {
  const stream = page.locator('section[aria-labelledby="stream-heading"]');
  await expect(
    stream.getByRole('heading', { name: /Today.s matches|Upcoming matches/ }),
  ).toBeVisible();

  // Day groups beyond today render as h3 date headers.
  expect(await stream.locator('h3').count()).toBeGreaterThan(0);

  // Every fixture card is one full-card link; the slim row bar prints its
  // percentages as text ("H 54 · D 26 · A 20"), never colour alone.
  const cards = stream.locator('a[href^="/match/"]');
  expect(await cards.count()).toBeGreaterThan(0);
  expect(await stream.getByText(/H \d+ · D \d+ · A \d+/).count()).toBeGreaterThan(0);

  // Finished-today rows show "Full time" plus the honest ✓/✗ — with preview
  // data one hit and one miss are guaranteed, at identical weight.
  expect(await stream.getByText('Full time').count()).toBeGreaterThan(0);
  await expect(stream.getByRole('img', { name: 'Correct call' }).first()).toBeVisible();
  await expect(stream.getByRole('img', { name: 'Missed call' }).first()).toBeVisible();

  // Upcoming rows carry the quiet "analysis" content cue (never betting copy).
  expect(await stream.getByText('analysis', { exact: true }).count()).toBeGreaterThan(0);

  // The probability-literacy footnote links to /about.
  await expect(stream.getByRole('link', { name: 'score our misses too' })).toHaveAttribute(
    'href',
    '/about',
  );
});

// ── §3 What we're watching: 1–2 quiet featured matchups ────────────────────
test("/ what we're watching features the tightest calls as quiet cards", async ({
  page,
}) => {
  const watching = page.locator('section[aria-labelledby="watching-heading"]');
  await expect(
    watching.getByRole('heading', { name: /What we.re watching/ }),
  ).toBeVisible();

  // 1–2 cards, each a full-card link with an honest one-line read.
  const cards = watching.locator('a[href^="/match/"]');
  const cardCount = await cards.count();
  expect(cardCount).toBeGreaterThan(0);
  expect(cardCount).toBeLessThanOrEqual(2);
  await expect(cards.first().getByText('Read the full analysis')).toBeVisible();
});

// ── §4 Receipts: claim welded to outcome, misses at equal weight ────────────
test('/ receipts weld each locked call to its outcome with a provenance microline', async ({
  page,
}) => {
  const receipts = page.locator('section[aria-labelledby="recent-heading"]');
  await expect(
    receipts.getByRole('heading', { name: 'How recent calls landed' }),
  ).toBeVisible();
  await expect(receipts.getByText('judge for yourself')).toBeVisible();
  await expect(receipts.getByRole('link', { name: 'Full record' })).toHaveAttribute(
    'href',
    '/ledger',
  );

  // Receipt rows: each is a link to the locked match page.
  const rows = receipts.locator('ul > li');
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);
  expect(rowCount).toBeLessThanOrEqual(10);
  await expect(rows.first().locator('a[href^="/match/"]')).toHaveCount(1);

  // The claim: "we said <outcome> NN%" with the locked bar printing its line.
  expect(await receipts.getByText(/we said .+/).count()).toBeGreaterThan(0);
  expect(await receipts.getByText(/H \d+ · D \d+ · A \d+/).count()).toBeGreaterThan(0);

  // The stamp cell: final score + equal-weight ✓/✗ + "Full time". Preview data
  // includes honest misses, so both stamps must appear.
  expect(await receipts.getByText(/\d–\d/).count()).toBeGreaterThan(0);
  await expect(receipts.getByRole('img', { name: 'Correct call' }).first()).toBeVisible();
  await expect(receipts.getByRole('img', { name: 'Missed call' }).first()).toBeVisible();
  expect(await receipts.getByText('Full time').count()).toBeGreaterThan(0);

  // The one-line plain-prose read and the provenance microline.
  expect(await receipts.getByText(/A \d+% call (landed|missed|lost)/).count()).toBeGreaterThan(
    0,
  );
  expect(
    await receipts.getByText(/published .+ · locked at kickoff/).count(),
  ).toBeGreaterThan(0);
});

// ── §6 Record band: the accountability end-cap with the guessing baseline ──
test('/ record band states the record against the always-guessing baseline', async ({
  page,
}) => {
  const band = page.locator('section[aria-labelledby="record-heading"]');
  await expect(band.getByRole('heading', { name: 'The record so far' })).toBeVisible();

  // Stat trio with the sample size stated plainly (small-n honesty).
  for (const label of ['scored calls', 'mean Brier', 'mean log loss']) {
    await expect(band.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(band.getByText(/across \d+ scored calls?/)).toBeVisible();

  // The baseline strip: neutral markers, mono labels, the ⅓/⅓/⅓ = 0.667
  // comparison, and the calibration one-liner.
  await expect(band.getByText(/always guessing ⅓ \/ ⅓ \/ ⅓/)).toBeVisible();
  await expect(band.getByText('0.667', { exact: true })).toBeVisible();
  await expect(band.getByText('Glass Pitch', { exact: true })).toBeVisible();
  await expect(band.getByText(/Lower is better\./)).toBeVisible();

  await expect(band.getByRole('link', { name: 'See the ledger' })).toHaveAttribute(
    'href',
    '/ledger',
  );

  // The CSV download stays OFF the homepage until a free (non-premium) ledger
  // export route exists — pins the documented W4 deviation.
  await expect(band.getByRole('link', { name: /csv/i })).toHaveCount(0);
});

// ── §7 Sign-up end-cap: exactly ONE sign-up affordance in the page body ─────
test('/ has exactly one sign-up affordance — the end-cap card, no pressure copy', async ({
  page,
}) => {
  const main = page.locator('main');
  const endCap = page.locator('section[aria-labelledby="signup-heading"]');

  await expect(
    endCap.getByRole('heading', { name: 'Keep your own watch on the record' }),
  ).toBeVisible();
  await expect(
    endCap.getByText('The ledger and every prediction stay free.'),
  ).toBeVisible();

  // Exactly ONE primary sign-up affordance on the whole page, linking /login.
  const cta = page.getByRole('link', { name: 'Create a free account' });
  await expect(cta).toHaveCount(1);
  await expect(cta).toHaveAttribute('href', '/login');
  await expect(
    endCap.getByRole('link', { name: 'Already have one? Sign in' }),
  ).toHaveAttribute('href', '/login');

  // Every /login link inside the page BODY lives in this one end-cap (the
  // header's dim "Sign in" is navigation, outside <main>).
  await expect(main.locator('a[href="/login"]')).toHaveCount(2);
  await expect(endCap.locator('a[href="/login"]')).toHaveCount(2);

  // No email-capture form or modal/interstitial competes with the end-cap
  // itself. Audit-fix note: the page now DOES carry one quiet premium
  // mention elsewhere in the body (its own dedicated section, tested below)
  // — this end-cap specifically must stay free of it, so the two
  // affordances never compete for attention on the same card.
  await expect(main.locator('form')).toHaveCount(0);
  await expect(main.locator('input')).toHaveCount(0);
  // MobileNav's dialog overlay is always present in the DOM (so its
  // aria-controls keeps referencing a real element) but only ever VISIBLE
  // while open — nobody has opened it in this test, so filter to visible
  // dialogs rather than asserting zero dialog elements exist at all.
  await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0);
  await expect(endCap.locator('a[href="/premium"]')).toHaveCount(0);
  expect(await endCap.innerText()).not.toMatch(/premium/i);
});

// ── The one quiet premium mention in the body (audit #18; DESIGN.md §6: no
// more than one quiet upgrade affordance per page, no pressure copy) — its
// own section, separate from the sign-up end-cap above so the two
// affordances never compete. ───────────────────────────────────────────────
test('/ has exactly one quiet premium mention in the body, with no pressure copy', async ({
  page,
}) => {
  const main = page.locator('main');
  const section = page.locator('section[aria-labelledby="premium-heading"]');

  await expect(section.getByRole('heading', { name: 'Want more depth?' })).toBeVisible();
  await expect(
    section.getByText(/record above and every prediction stay free, always/),
  ).toBeVisible();
  await expect(section.getByRole('link', { name: /See what.s included/ })).toHaveAttribute(
    'href',
    '/premium',
  );

  // Exactly one premium link anywhere in the page body — DESIGN.md §6's "no
  // more than one quiet upgrade affordance per page" enforced directly.
  await expect(main.locator('a[href="/premium"]')).toHaveCount(1);

  const bodyText = (await main.innerText()).toLowerCase();
  expect(bodyText).not.toMatch(/hurry|only today|last chance|don['’]t miss/);
  expect(bodyText).not.toMatch(/limited time|act now|offer ends/);
});

// ── Motion kit: CSS-only, and fully inert under prefers-reduced-motion ─────
test('/ reduced-motion kill-switch disables the W4 motion kit entirely', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'load' });

  // The global kill-switch rule (globals.css) is still shipped in the
  // compiled stylesheet, alongside the opt-in no-preference wrapper.
  const media = await page.evaluate(() => {
    const found = { reduce: false, noPreference: false };
    const scan = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSMediaRule) {
          const t = rule.media.mediaText;
          if (/prefers-reduced-motion:\s*reduce/.test(t)) found.reduce = true;
          if (/prefers-reduced-motion:\s*no-preference/.test(t)) found.noPreference = true;
          scan(rule.cssRules);
        } else if (rule instanceof CSSSupportsRule) {
          scan(rule.cssRules);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        scan(sheet.cssRules);
      } catch {
        /* cross-origin sheet — none expected */
      }
    }
    return found;
  });
  expect(media.reduce, 'global reduced-motion kill-switch must ship').toBe(true);
  expect(media.noPreference, 'motion kit must be wrapped in no-preference').toBe(true);

  // Under reduce, the hero stagger runs NO animation and content sits at its
  // final, fully visible state (motion never carries meaning).
  //
  // Scoped to the hero section, not `.rise-in` unqualified: MobileNav's
  // hamburger panel (src/components/MobileNav.tsx) reuses the very same
  // `.rise-in` keyframe for its own entrance and sits earlier in DOM order
  // than the hero (it lives in the sitewide Header) — an unscoped `.first()`
  // would silently grab that closed, `display:none` panel instead of the
  // hero kicker this test actually means to exercise.
  const hero = page.locator('section[aria-labelledby="home-kicker"]');
  const kicker = hero.locator('.rise-in').first();
  expect(await kicker.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  expect(await kicker.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
});

test('/ hero stagger animates only when motion is allowed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/', { waitUntil: 'load' });
  // See the reduced-motion test above for why this is scoped to the hero
  // section rather than an unqualified `.rise-in` — MobileNav's closed,
  // `display:none` panel also carries the class and never completes its
  // (paused) animation, which previously made `.first()` flake/timeout here.
  const hero = page.locator('section[aria-labelledby="home-kicker"]');
  const kicker = hero.locator('.rise-in').first();
  expect(await kicker.evaluate((el) => getComputedStyle(el).animationName)).toBe(
    'rise-in',
  );
  // Once-on-load only: it settles at full opacity (fill-mode both).
  await expect
    .poll(async () => kicker.evaluate((el) => getComputedStyle(el).opacity))
    .toBe('1');
});
