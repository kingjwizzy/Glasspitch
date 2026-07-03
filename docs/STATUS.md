# STATUS — Glass Pitch

**Last updated:** 2026-07-03
**Overall state:** **v1 is feature-complete and fully merged to `main`.** Every planned
page is built and reading real data from Supabase (home, `/match/[id]`, `/team/[slug]`,
`/league/[slug]`, `/ledger`, `/about`, `/responsible-gambling`), the four-job pipeline and
schema are done, and the SEO pass has landed. What remains is **not building** — it is the
launch gate: a **paid API plan + the live-2026 cutover**, **responsible-gambling / legal
sign-off**, **turning the scheduler cron on**, plus test-hardening and minor polish.

> Snapshot reflects the **code on `main`** at `9ac292b` (Merge `feat/seo-polish`). All four
> former feature branches (`feat/scheduler`, `feat/home-page`, `feat/ledger-page`,
> `feat/team-league-pages`) and the SEO polish are **merged** — the "unmerged branches" and
> "Next up: ledger / team / league" sections of the previous snapshot are now **done**.
> Source-of-truth specs: `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/SEEDING.md`, `CLAUDE.md`.

---

## ✅ Done — built & merged on `main`

**Foundations & schema**
- DESIGN.md token system + global chrome (dark-first, colour-blind-safe data palette), the
  site-wide compliance disclaimer as a named landmark, header/footer.
- Supabase schema: `leagues` / `teams` / `fixtures` / `predictions` ledger, the kickoff
  **immutability trigger** (freezes `prob_*`/`predicted_*`/`model_version`/`source`/`published_at`
  + `locked_at`/`id`/`fixture_id`/`created_at` once `locked_at <= now()`), `prob_*` sum CHECK,
  and **RLS** (anon/authenticated select-only; service role the only writer). A second migration
  hardens both trigger functions with an empty `search_path`.
- Publishable (anon, RLS-bound) vs secret (service, bypasses RLS) key boundary; `supabaseAdmin`
  is server-only and guarded — never reachable from a client/RSC path.

**Jobs pipeline** — all four jobs + shared infra complete, **zero stubs**
- `fetch_fixtures`, `fetch_predictions` (third-party fetched **once ever** per fixture + a
  logged-only Elo), `lock_predictions` (kickoff lock; late → `unlocked_void`), `score_results`
  (Brier + log loss). Scoring maths verified **character-for-character** against §10.
- `apiclient` (auth, retry/backoff, per-run `MAX_REQUESTS_PER_RUN` budget guard), `db`
  (idempotent upserts keyed on `api_*` ids; UNIQUE-violation-only swallow), `elo`, `scoring`,
  `config` (`LIVE_SEASON` single source of truth), `util`, `cli`.
- All writes idempotent; jobs safe to re-run/overlap.

**Web pages** — every route built, all dynamic routes read real Supabase data (ISR, zero client JS)
- **`/`** — matchday home: hero, upcoming, "what we're watching", recent calls (✓/✗), record band.
- **`/match/[id]`** — on-demand ISR: one fixture + its locked `api-football` prediction, recent
  form, honest scored-result panel (actual vs predicted, Brier + log loss, misses shown plainly),
  and void / no-prediction / 404 states. Per-match metadata + `SportsEvent` JSON-LD.
- **`/team/[slug]`** & **`/league/[slug]`** — header, form, upcoming + recent fixtures, record
  stats; known slugs pre-rendered, unknown fall to on-demand ISR + honest 404s.
- **`/ledger`** — the trust engine: running record incl. losses, mean Brier + log loss,
  calibration table (10 deciles), every scored call newest-first, sample-size note.
- **`/about`** (static) and **`/responsible-gambling`** (static; links are still placeholders — see below).
- **SEO:** per-page OpenGraph, branded home title, cross-linked team names, `robots.ts`,
  `sitemap.ts` (static pages + team/league slugs).
- Elo and voided predictions are **never** surfaced; only `source='api-football'` is shown.

**Scheduler** — *`.github/workflows/scheduler.yml`*
- GitHub Actions jobs scheduler: cadence documented (fetch_fixtures 6h, fetch_predictions daily,
  lock 10m, score 20m), **cron commented out** (manual `workflow_dispatch` only until go-live),
  `permissions: contents: read`, per-job concurrency groups; DB-only jobs carry **no**
  `API_FOOTBALL_KEY`.

**Dev tooling & tests**
- `seed_predictions_dev` (back-dates dev predictions onto finished 2022 fixtures so the real
  lock/score jobs process them) and `reset_season` (FK-safe, season-scoped teardown), both with
  live-season interlocks; `docs/SEEDING.md` runbook.
- **106 pytest** tests (mocked — no network, no DB) covering apiclient / scoring / elo / util /
  all four jobs + both dev tools. **e2e:** Playwright + axe on the static pages (`/`, `/about`,
  `/ledger`, `/responsible-gambling`) at phone + desktop viewports, 0 serious/critical axe.

---

## 🚦 Launch gate — the critical path (mostly non-code)

1. **Live-2026 cutover** — gated on buying a **paid API-Football plan** (the free tier can't read
   season 2026). Plug-and-play per `docs/SEEDING.md`: new key, drop the `WC_*` env overrides
   (reverts to 2026 / league 1), **`reset_season --season 2022` first** (the `leagues.api_league_id`
   UNIQUE means seeding 2026 onto the old row would orphan 2022), then run the live pipeline.
   **No code edit.**
2. **Responsible-gambling + legal sign-off** — `/responsible-gambling` ships placeholder
   ("to be confirmed") support links and the disclaimer copy is developer-authored; both need
   **real resource links + compliance sign-off before public launch or monetisation**.
3. **Enable the scheduler** — uncomment the `schedule:` + four `- cron:` lines in `scheduler.yml`
   at go-live (each cron maps 1:1 to a job via its `if:` guard).

---

## 🟡 Close before the live cutover

- **Harden the dev seeder** — `seed_predictions_dev` gates on config identity
  (`SEASON == LIVE_SEASON`) but its write set (`finished_fixtures_ordered()`) is **not
  season-scoped**, unlike `reset_season`. Harmless today (single-season-per-DB, no live 2026 data),
  but scope the reader to `config.SEASON` so it physically cannot back-date predictions onto
  another season's fixtures once a mixed/live DB exists.

---

## 🧪 Test-hardening (feasible now, not merge-blocking)

- **`/match` · `/team` · `/league` e2e + axe** — the three DB-backed pages have no specs yet;
  doable now via the `PREVIEW_*` server-only hatch (renders populated states with no seeded DB).
  Only the static pages currently have specs.
- **Real-store integration tests** — no test runs against real Postgres; upsert idempotency, the
  immutability trigger, and the `prob_*` sum CHECK are asserted only against fakes.

---

## 🧹 Minor polish / hygiene

- **Default OG image** — `src/app/layout.tsx` still has a `TODO` for `app/opengraph-image.tsx`.
- **Per-match sitemap URLs** — `src/app/sitemap.ts` covers static + team/league slugs; per-match
  URLs are a documented `TODO` (needs the fixtures-id enumerator).
- **`fetch_fixtures` pagination** — before any multi-page fixture list (club football).
- **Sentry + analytics** (Plausible / GA4) on web + jobs.
- **Cleanups:** `scheduler.yml` budget comment is arithmetic'd on the old 64-match format
  (2026 = 104 matches / ~72 worst-case fetches — still < 100/day, conclusion holds);
  `db.finished_fixtures()` (unordered) is dead code; `score_results` re-queries every finished
  fixture each run (N+1, fine at WC scale); `ScoredResult`'s ledger link lacks the `min-h-11`
  tap-target; `PREVIEW_*` env vars aren't in `.env.local.example`.

---

## 🔭 v2 — deferred, not started (infra reserved)

- User accounts / logins / personal data.
- Premium paywall + ads (the `tier` field and reserved ad slots exist but are **off**).
- xG breakdowns, ledger filters / CSV export, editorial content, email capture,
  "Beat the model" game, promoting the in-house Elo to primary (decided by the ledger).

---

## 🔑 Key facts (operational truths for a new session)

- **Stack:** Next.js App Router (RSC/ISR) + Tailwind on Vercel; Supabase Postgres; Python
  scheduled jobs; GitHub Actions schedules the jobs. The two layers meet **only at the database**.
- **The golden rule (§5):** the website only ever **reads** from Supabase; the **jobs are the only
  DB writers and the only football-API callers**. No visitor request ever calls the football API.
- **Key boundary (§7/§12):** web uses the **publishable** key (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  anon, RLS read-only); jobs use the **secret/service** key (`SUPABASE_SECRET_KEY`, server-only,
  bypasses RLS). `supabaseAdmin` is guarded and never client-reachable. No secret is committed;
  `.env*` is gitignored (only `*.example` tracked). Real secrets live only in local gitignored
  `.env.local` / `jobs/.env`.
- **2022 = disposable DEV data** (`season=2022`). The real, locked-before-kickoff public record
  starts only on genuine **future 2026 fixtures** (paid plan). **Never present 2022 as the live
  record.** Only `source='api-football'` is shown; the in-house `inhouse-elo` is logged, never displayed.
- **`LIVE_SEASON`** is the single source of truth in `jobs/config.py`; `WC_SEASON` / `WC_LEAGUE_ID`
  env vars override it for a dev seed (default 2026 / league 1).
- **GitHub is the source of truth.** **Lane discipline:** `src/` (frontend) and `jobs/` +
  `supabase/migrations/` (backend) are disjoint ownership.
