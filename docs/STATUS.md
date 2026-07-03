# STATUS — Glass Pitch

**Last updated:** 2026-07-03
**Overall state:** **v2 is LIVE at https://glasspitch.com.** The site is public,
reading the real FIFA World Cup 2026 knockouts from Supabase, with the full
hardening pass and the premium stack shipped. Premium runs in **Stripe test
mode** — gated routes are built, noindexed, and unlinked from the public nav
until the owner's launch gate below clears. The scheduler cron is **on**
(GitHub Actions, repo now public → unlimited minutes).

> Snapshot reflects `main` after the `feat/v2-launch` merge (v2 go-live,
> 2026-07-03). Source-of-truth specs: `docs/ARCHITECTURE.md` (carrying the
> 2026-07-03 v2 amendments), `docs/DESIGN.md`, `docs/SEEDING.md`, `CLAUDE.md`.

---

## ✅ Live production state (2026-07-03)

- **Site:** https://glasspitch.com (+ www) on Vercel, project `glasspitch`
  (team `venture2`), custom domain verified, all public routes static/ISR.
- **Data:** WC 2026 (league 1, season 2026) — 94 fixtures, 48 teams live;
  the 2022 dev seed was torn down via `teardown_season()` before the cutover.
- **The ledger is live:** first real predictions published for the Round-of-16
  window (7 fixtures within the 72h fetch window at cutover), locking at their
  kickoffs — the first at 2026-07-03 18:00 UTC (Australia v Egypt). Elo logged
  silently alongside; `prediction_detail` insights stored for premium.
- **DB:** migrations 0001→0004 applied live. Grant-layer read-only for
  anon/authenticated, ledger DELETE guard + scored-row freeze, `job_runs`
  observability, premium tables (profiles/subscriptions/stripe_events/
  fixture_insights) with subscriber-only RLS via `is_premium()`. Security
  advisor: zero warnings (two deliberate INFO notes on deny-all tables).
- **Scheduler:** all six crons enabled — fetch_fixtures 6h, fetch_predictions
  daily 06:15, fetch_insights 6h@:45, lock 10m, score 20m, keepalive monthly.
  Per-job failure alerting opens/reuses a GitHub issue; every run writes a
  `job_runs` row.
- **Stripe (test mode):** product `glasspitch-premium` (£4/mo, £29/yr),
  webhook endpoint live at `/api/stripe/webhook` (signature-verified,
  idempotent, retry-on-failure semantics).
- **Tests:** 169 pytest + 11 integration (real Postgres in CI) + 116
  Playwright/axe. Gate review (checks-reviewer): PASS; its three warnings
  (auth open-redirect, webhook silent-drop, double-chance phrasing in stored
  insights) were fixed pre-launch.

---

## 🚦 Owner launch gate — premium live-mode flip

Premium stays in test mode until ALL of these clear (ARCHITECTURE.md §13):

1. **Stripe restricted-business vetting** — "sports forecasting" is on
   Stripe's restricted list; get their written OK (position: statistics/
   analysis, no odds, no tips, losses published — the ledger is the exhibit).
2. **Professional legal sign-off** — the disclaimer copy, `/privacy`,
   `/terms`, `/refunds` drafts (all live, each footnoted "draft pending
   professional review"), and the no-Gambling-Commission-licence confirmation.
3. **Eyeball the responsible-gambling resources** — live at
   `/responsible-gambling`: National Gambling Helpline 0808 8020 133
   (verified on gamcare.org.uk at build time), GAMSTOP, GambleAware.
4. **ICO registration** before promoting sign-ups (accounts hold email +
   billing metadata once real users exist).
5. **Supabase Auth config (dashboard):** allow-list
   `https://glasspitch.com/auth/callback` and `/auth/confirm` as redirect
   URLs; add a production SMTP provider (Resend/Postmark) before real
   sign-up volume. Until then magic-link auth works only at Supabase's
   built-in trickle rate — fine for owner testing.
6. Flip: swap Stripe test keys → live keys in Vercel env, link the auth
   affordance into the nav, remove the noindex on `/premium`.

## 🟡 Known post-launch items

- **Vercel GitHub app not connected** (`vercel git connect` needs the app
  install — one click by the owner). Until then deploys are CLI-driven
  (`npx vercel deploy --prod`); pushes do NOT auto-deploy.
- **Sentry** (web + jobs DSNs) still unwired — pipeline failure alerting
  exists via GitHub issues + `job_runs`; error monitoring on the web layer is
  the gap. Vercel Web Analytics can be enabled in the dashboard (cookieless).
- `middleware.ts` → `proxy` rename (Next 16 deprecation warning, non-blocking).
- Local `jobs/.venv` runs Python 3.14 vs CI's pinned 3.12 (rebuild for parity).
- `src/lib/database.types.ts` deliberately omits jobs-only objects
  (`job_runs`, `is_premium`, `teardown_season`) — web never touches them.
- Club-football scale work (multi-league schema: `UNIQUE(api_league_id,
  season)`, team slug collisions, provider seam for football-data.org) is
  designed in the audit but deferred until after the World Cup.

## 🔭 Deferred (unchanged)

- Email capture/newsletter; "Beat the model" game (DESIGN.md §6 reserve);
  Golden Boot race + PWA manifest (DESIGN.md home-spec extras); editorial
  content; promoting the in-house Elo (decided by the ledger, §9/§16).

---

## 🔑 Key facts (operational truths for a new session)

- **Golden rule (§5, amended 2026-07-03):** the website only ever reads from
  Supabase; the Python jobs are the only football-data writers and the only
  football-API callers; the **Stripe webhook route is the only billing-data
  writer**. No visitor request ever calls the football API.
- **Premium gates depth content only** — the full prediction set and the
  complete scored ledger stay free forever. `predictions.tier` is not the
  gating mechanism; premium data lives in `fixture_insights` behind
  subscriber-only RLS.
- **Key boundary:** web uses the publishable key (RLS read-only);
  jobs + the webhook writer use the secret key (server-only). Vercel prod
  env carries 9 vars incl. Stripe test keys; GitHub Actions carries
  SUPABASE_URL / SUPABASE_SECRET_KEY / API_FOOTBALL_KEY.
- **API-Football:** Pro plan (7,500 req/day, renews monthly). `/fixtures`
  rejects an explicit `page` param — page 1 omits it (fixed live 2026-07-03).
- **The public record starts 2026-07-03.** Never present anything earlier as
  the live record; web reads are season-floored via NEXT_PUBLIC_MIN_SEASON
  (default 2026) as defence in depth.
