# STATUS — Glass Pitch

**Last updated:** 2026-07-04 (launch night +1).
**Overall state:** **v3 is LIVE at https://glasspitch.com** — the full product:
redesigned flag-rich homepage with the World Cup Chances circles, Beat the
Model pools (/play), Gameweek Board + Ticker (/board), share/OG receipt
cards, original illustration pack, £6/£39 premium (Stripe **approved for
live payments**; final wiring in progress tonight), and a scored, hash-chain-
verifiable public ledger. The pipeline runs itself on GitHub Actions.

> Sources of truth: `docs/ARCHITECTURE.md` (v2+v3 amendments), `docs/DESIGN.md`,
> `docs/ROADMAP.md` (strategy + build queue), `docs/SEEDING.md`,
> `docs/STRIPE-VETTING.md` (submitted; approval received 2026-07-04).

---

## ✅ Live production state

- **Site:** glasspitch.com (+www), Vercel **Pro**, project `glasspitch`
  (team `venture2`), GitHub auto-deploys on push to main.
- **Data:** WC 2026 live — 94 fixtures with rounds + winner flags (penalty
  shootouts handled via `winner_team_id`), 48 teams, Golden Boot top-15,
  probability snapshots, 18-nation tournament chances (10k Monte Carlo,
  2× daily). Status polling every 15 min (frozen-status incident 2026-07-03
  fixed same night).
- **Ledger:** first calls scored (first receipt honestly a miss on a 45/45
  coin-flip); nightly private JSON backups to Storage + public SHA-256 hash
  chain in `ledger_checkpoints` — third parties can verify the record.
- **DB:** migrations 0001→0007 applied + verified live. Writers: jobs
  (football data) · Stripe webhook (billing) · owner-scoped user game picks
  · email-capture route (dormant until Resend key). Grant-layer +
  RLS + trigger enforcement throughout; advisors clean (2 documented
  SECURITY DEFINER WARNs on pool RPCs, intentional).
- **Jobs (11):** fetch_fixtures (15m), fetch_predictions (daily),
  fetch_insights (6h), fetch_topscorers (daily), lock (10m), score (20m),
  score_user_predictions (20m), snapshot_probabilities (daily),
  simulate_chances (2×daily), ledger_integrity (nightly), keepalive
  (monthly). Per-job failure alerting via GitHub issues + job_runs rows.
- **Premium (£6/mo · £39/yr):** Stripe LIVE approval received. Test-mode
  stack fully verified; live product+prices exist, live env vars in Vercel
  (sensitive/write-only). Remaining to flip: owner creates the live webhook
  endpoint (+ whsec → Vercel) and saves the live Customer Portal config,
  then set NEXT_PUBLIC_PREMIUM_LIVE=1 → gold header CTA + /premium
  indexability switch on, owner does a real-card test + self-refund.
- **Tests:** 272 pytest + 23 integration (real Postgres in CI) + 252
  Playwright/axe. Final gate (2026-07-04): invariant audit fully clean;
  its 2 CI findings + repricing stragglers fixed same hour.

## 🚦 Owner queue (nothing blocks the site; premium flip items first)

1. Live webhook endpoint + whsec → Vercel; live Customer Portal save (exact
   steps given in-session) → then Claude flips premium live.
2. Real-card £6 test purchase → self-refund (the go-live proof).
3. Resend account + RESEND_API_KEY + EMAIL_CAPTURE_ENABLED=1 → email capture
   activates itself (double-opt-in ready, GDPR-delete unsubscribe).
4. @glasspitch on X + Bluesky → receipt-posting cadence per ROADMAP §3.
5. Wikimedia player-photo legal answer (Golden Boot faces) — flags meanwhile.
6. Google Search Console + sitemap submit; Sentry DSNs when convenient.

## 🟡 Known items / fast-follows

- StreamCard (homepage) lacks the H/A chips FixtureRow gained (consistency).
- openMatch service-role read: add internal open-match-id re-derivation
  (gate suggestion S1, defense-in-depth).
- Merge the two user_predictions SELECT policies (perf, S2); opponent FK
  index if hot (S3).
- W7 queued: live in-play scores (60s matchday watcher + on-demand
  revalidation + live-score columns), /bracket knockout tree page,
  UpcomingFixtures chip consistency. Then August: club-football expansion
  (multi-league schema, provider seam, kit-color identity, xPoints spike).
- Ads remain OFF permanently-ish (brand + policy). Ledger stance: stays; may
  be de-emphasized per owner direction (recording never stops regardless).

## 🔑 Key facts (operational truths for a new session)

- Golden rule + amendments: web reads only; jobs are sole football-data
  writers + sole API callers; Ledger immutable (UPDATE+DELETE guards, scored
  rows re-frozen); sanctioned narrow writers: Stripe webhook (billing),
  user game picks (owner-scoped RLS, pre-kickoff only), email route.
- Pricing £6/£39 everywhere (checkout env, copy, docs, e2e). Old £4/£29
  Stripe test prices archived.
- API-Football Pro (7,500/day; ~110 req/day used at current cadence).
  /fixtures rejects a `page` param; topscorers lag the live feed slightly.
- Supabase Pro, org `biwpenhkajguerltotfy`, project `vrcnbvijanpxrqwndnyl`.
  Vercel Pro, team `venture2`. Repo public: kingjwizzy/Glasspitch.
- The public record started 2026-07-03; season floor NEXT_PUBLIC_MIN_SEASON
  guards it; hash chain anchors it.
