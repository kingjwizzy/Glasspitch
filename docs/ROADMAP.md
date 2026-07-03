# ROADMAP — Glass Pitch

**Last updated:** 2026-07-03 (launch day). Owner-approved strategy and build
sequence. Sits alongside `ARCHITECTURE.md` (system invariants), `DESIGN.md`
(design system), `STATUS.md` (current state). Grounded in four research
rounds run on launch day: homepage/competitor design, monetization &
business models, ledger-independent revenue features, and channel/traction
research (all with live web evidence).

---

## 1. Strategic direction (owner decisions, 2026-07-03)

- **The ledger is not the product's sole draw.** Utility and fun carry
  acquisition/retention; the ledger stays (for now) as the trust layer. The
  owner may later remove the public ledger surface if it underperforms; if
  hidden, recording continues internally so it can return gap-free alongside
  a smarter model. Research note: every comparable that successfully charges
  sells a multi-season track record — keeping the ledger alive through
  2026/27 preserves that option at near-zero cost.
- **§5 writer amendments approved:** (a) the Stripe webhook route writes
  billing tables (live since v2); (b) **users may write their own game
  picks** (Beat the Model pools) via a dedicated, RLS-owner-scoped writer
  path — football data and the ledger remain jobs-only; (c) **the official
  FPL API is approved as a second jobs-layer data source** (jobs remain the
  only external callers; ToS reviewed at implementation).
- **Premium stays test-mode through the World Cup** — deliberately. The WC
  window's job is audience + record accrual. Live flip gates: Stripe
  restricted-business OK + owner's completed legal/ICO work (done) +
  Vercel Pro (Hobby plan is non-commercial).
- **Club crests stay banned** (trademark/copyright risk for a monetized,
  gambling-adjacent product). National **flags are sanctioned** (public-
  domain symbols) — shipping now. Club era uses a kit-color + monogram
  identity system; licensed imagery reconsidered only on revenue + counsel.

## 2. The revenue stack — "the honest numbers for your football week"

Three layers, one SKU (£4/mo · £29/yr "Founding season 2026-27" with a
plain permanent price-lock; no urgency/scarcity copy ever — DESIGN §6):

| Layer | What | When |
|---|---|---|
| **Free daily habit** | **Gameweek Board** — team clean-sheet/goals probabilities + day-over-day movers, nightly job | Build now; shines from August |
| **Paid utility arc** | **Probability Fixture Ticker** (Elo-based fixture difficulty; FFScout gates this at £50/yr) → **xPoints engine** (per-player FPL expected points — the market's proven flagship payable at £3.50–10/mo) | Ticker: days of work, sell into the Jul/Aug FPL season-pass buying window. xPoints: flagship by ~Oct |
| **Fun / viral loop** | **Beat the Model pools** — Super 6 cadence (6 fixtures, one weekly deadline), private leagues, invite links, **prize-free** (keeps it outside Gambling Commission licensing; Superbru: 2.87M users, growth "almost entirely viral"). **Receipts** share cards as the wrapper | Pools: WC quarterfinals if feasible, definitely club-season opener. Phase 2: captain-pays £15/season big-pool pass |
| **B2B sliver** | Premium CSV of OUR derived data (Elo, probabilities) now → RapidAPI Elo endpoint later (proven $15–30/mo band; marketplace billing sidesteps Stripe timing). Never resell API-Football's feed | CSV: shipped. API: after legal sign-off, ~£100–600/mo year-one realistic |

**Premium packaging moves (approved direction):** raw scored-ledger CSV
becomes FREE (the proof asset should be maximally auditable — that IS the
marketing); premium keeps depth/tools/convenience. Add an "open match of
the day" — one match page per matchday with premium depth visible free
(conversion by demonstrated usefulness — the only mechanic DESIGN §6
permits). /premium shows the record's live age + n and links the cancel
flow prominently — honesty as the conversion device.

**Rejected (with reasons):** live in-play win probabilities (most
betting-flavored artifact possible); B2B tipster-verification (puts the
anti-tipster brand inside the tipster supply chain; endangers Stripe
vetting); paid streak-repair or any loss-aversion lever; platform ad
revenue on prediction content (YouTube actively squeezing the category;
AdSense labels us "Gambling & betting 18+" with a bookmaker-dominated
bidder pool — brand conflict; Mediavine/Raptive exclude the class);
full fantasy game (crowded, high effort); daily stats puzzle (fun,
compliant — PARKED, not rejected).

**Honest economics:** free→paid ~3% at best; monthly churn ~5.8% (annual
halves it). Meaningful premium revenue needs ~10k engaged emails, which
only club-season coverage builds. No revenue projection before the record
has age is honest.

## 3. Traction — the World Cup window (time-critical)

R16 Jul 4–7 · QFs Jul 9–11 · SFs Jul 14–15 · **Final Jul 19** (the 2022
final set Google's all-time search record — attention compounds to the 19th).
Market the **mechanism** (locked at kickoff, immutable, scored, misses
shown) — the record itself is honestly days old.

- **W1 (now):** ship the share kit (receipt cards + per-match/per-result
  dynamic OG images); open @glasspitch on X + Bluesky; receipt cadence —
  locked call pre-match, scored card within ~1h of full-time, **hit or miss
  at identical prominence**, never break the streak. r/soccer: comment-only
  native participation with probability graphics where they genuinely add
  context (zero link-posting).
- **W2:** Show HN (Tue Jul 7): "a football prediction ledger that can't be
  edited after kickoff (Postgres trigger, Brier-scored, misses included)" —
  lead with engineering. QFs: pre-lock prediction thread + email capture
  switch-on ("get the scored record after each matchday", double opt-in).
  Press wave to the "supercomputer" genre desks (Mirror/Star/Metro/
  talkSPORT/GiveMeSport/FourFourTwo) offering semifinal/final forecasts —
  differentiator: ours is provable.
- **W3:** r/dataisbeautiful [OC] calibration piece (Jul 17); locked final
  prediction early; receipt within the hour of the final; "the model's road
  through the World Cup" postmortem — **misses first**, n≈16 caveats plain.
- **W4+ (the Jul 19–Aug 15 bridge):** WC postmortem PR to data-journalism
  desks; email list is the only owned channel across the dead zone; pivot
  content to FPL preseason (ticker + board launch content); club-football
  cutover.
- **Channel rules discovered:** TikTok + X ads effectively blocked for the
  category; Google/Meta technically clear but classifier-fragile (defer
  until there's a conversion target); Reddit ads gray/cheap (micro-test
  later); newsletter sponsorships have no policy gate (~$12–30 CPM, Paved/
  beehiiv) — the one paid channel that fits now-ish; earned press is the
  primary channel.

## 4. Build queue (sequenced)

1. **W4 (in flight):** homepage redesign ("receipts under floodlight") +
   national flags + signup end-cap.
2. **W5 (backend now / frontend after W4):** Beat the Model pools
   (migration: pools/user_predictions, owner-scoped RLS writes; scoring job
   reuses Brier machinery; UI after W4) + Gameweek Board snapshot job +
   Probability Fixture Ticker data.
3. **Share kit:** receipt cards + dynamic per-result OG images (traction W1
   dependency — highest urgency alongside W4/W5).
4. **Email capture** (Resend + double opt-in + privacy-notice update).
5. **Ledger integrity ops:** nightly pg_dump to private storage + published
   SHA-256 hash chain over scored rows (audit gap: zero backups of an
   irreplaceable asset beyond Supabase Pro dailies).
6. **August — club-football expansion:** multi-league schema
   (UNIQUE(api_league_id, season), slug collisions), provider seam,
   kit-color identity system, xPoints modelling spike.
7. **World Cup Chances circles (owner concept, 2026-07-03):** Monte Carlo
   simulation of the remaining bracket (jobs layer, from the existing match
   model + Elo) → per-nation tournament win probability, stored per day →
   homepage centerpiece: nation circle-flags sized by their chance of
   winning it all, shrinking/growing after every full-time, + a /chances
   page with the day-over-day story. Entirely flag-based (compliant), fully
   accountable (simulations logged like everything else). Build: jobs sim
   right after W5 lands; UI right after W4.
8. **Player imagery decision (owner + legal contact):** Wikimedia Commons
   CC-licensed player photos with attribution for the Golden Boot 15 —
   copyright-cleared; personality-rights caveat to be run past the owner's
   legal contact (one question: CC identification photos next to stats).
   Fallback per player: nation flag + team-color initial disc. Agency-
   licensed photography remains the revenue-gated path.
9. **Visual pass (research complete):** original vector illustration pack
   (hero scene, empty states, golden boot motif, match atmosphere blocks),
   ambient CSS pitch motifs, data-art backdrops; verdict: dark stays,
   EVOLVE with voltage — never lighten; followed-team pinning via
   localStorage; matchday-eve email + .ics feeds; no streaks, no comments.

## 5. Owner console/admin queue

- Stripe restricted-business evidence pack + submission (~1h; positioning:
  statistics/analysis publisher — no odds, no tips, no bet facilitation,
  losses published).
- Vercel Pro upgrade before premium-live (Hobby ToS is non-commercial).
- Resend (or Postmark) account when email capture ships.
- X + Bluesky account creation (@glasspitch) for the receipt cadence.
- Sentry DSNs (web + jobs) when convenient.
