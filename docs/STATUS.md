# STATUS — Glass Pitch

**Last updated:** 2026-06-26
**Overall state:** Foundations, the scheduled-jobs pipeline, the matchday home page and the
`/match/[id]` page are all built and verified. Two feature branches
(`feat/scheduler`, `feat/home-page`) are awaiting merge into `main`; a read-only
pre-merge code review found **0 critical / 1 important (pre-cutover, non-blocking) / rest minor**
and the branches merge cleanly (disjoint file sets). Still pre-launch: the ledger view,
live-2026 cutover (needs a paid API plan), and responsible-gambling/legal sign-off.

> Derived from the read-only pre-merge review of `main` + both branches on 2026-06-26.
> Where docs and code disagreed, this reflects the **code** (e.g. `README.md` is stale — see
> Backlog). Source-of-truth specs: `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/SEEDING.md`, `CLAUDE.md`.

---

## ✅ Done — built & verified

Verification this snapshot: frontend `tsc --noEmit` / `lint` / `build` green (`/match/[id]`
correctly dynamic/ISR); `pytest` **110 passed** (mocked — no DB writes, no live API);
`actionlint` clean on both workflows; Playwright e2e **18 passed** + axe 0 serious/critical on
the static pages and (manually, across 9 states) on the match page.

**Foundations & schema** — *on `main`*
- DESIGN.md token system + global chrome (dark-first, colour-blind-safe data palette).
- Supabase schema: `leagues` / `teams` / `fixtures` / `predictions` ledger, the kickoff
  **immutability trigger** (freezes `prob_*`/`predicted_*`/`model_version`/`source`/`published_at`
  + `locked_at`/`id`/`fixture_id`/`created_at` once `locked_at <= now()`), `prob_*` sum CHECK,
  and **RLS** (anon/authenticated select-only; service role the only writer). *Verified sound.*
- Publishable (anon, RLS-bound) vs secret (service, bypasses RLS) key boundary; `supabaseAdmin`
  is server-only and guarded — never reachable from a client/RSC path. *Verified sound.*

**Jobs pipeline** — *shared chain + `feat/scheduler`*
- `fetch_fixtures`, `fetch_predictions` (third-party fetched **once ever** per fixture + a
  logged-only Elo), `lock_predictions` (kickoff lock; late → `unlocked_void`), `score_results`
  (Brier + log loss). Scoring maths verified **character-for-character** against §10.
- `apiclient` (auth, retry/backoff, per-run `MAX_REQUESTS_PER_RUN` budget guard), `db`
  (idempotent upserts keyed on `api_*` ids; UNIQUE-violation-only swallow), `elo`, `scoring`.
- All writes idempotent; jobs safe to re-run/overlap. *Verified sound.*

**Home page** — *shared chain (on both branches)*
- Matchday home (`/`): hero, upcoming, "what we're watching", recent calls (✓/✗), record band,
  via a server-only Supabase read layer. Elo and voided predictions never surfaced.

**Match page** — *`feat/home-page` (UNMERGED)*
- Real `/match/[id]` (replaced the stub): server-rendered ISR read of one fixture + its locked
  `api-football` call, recent form, and the scored result panel (actual vs predicted, ✓/✗,
  Brier + log loss — misses shown as plainly as hits). Honest void / no-prediction / 404 states;
  per-match metadata + SportsEvent JSON-LD; zero client JS. *Verified sound (RSC/ISR, tokens,
  a11y, source/void handling).*

**Scheduler** — *`feat/scheduler` (UNMERGED)*
- GitHub Actions jobs scheduler: cadence documented (fetch_fixtures 6h, fetch_predictions daily,
  lock 10m, score 20m), **cron commented out** (manual `workflow_dispatch` only until go-live),
  `permissions: contents: read`, per-job concurrency groups, and the DB-only jobs carry **no**
  `API_FOOTBALL_KEY`. *Verified sound.*

**Dev tooling & tests** — *`feat/scheduler`*
- `seed_predictions_dev` (back-dates dev predictions onto finished 2022 fixtures so the real
  lock/score jobs process them) and `reset_season` (FK-safe, season-scoped teardown), both with
  live-season interlocks; `docs/SEEDING.md` runbook. 110 pytest covering apiclient/scoring/elo/all
  four jobs + the dev tooling.

---

## 🚧 In progress / unmerged

Both branches share base `origin/main` (`d9a79f4`) and a common chain through `e624142`
(DESIGN tokens, home read-layer + UI, e2e, dev-seeding). Their **unique** deltas are **disjoint**
in file set, so they cannot textually conflict in either merge order (verified via 3-way diff).

- **`feat/scheduler`** (`8ee6f97`, pushed) — `.github/workflows/scheduler.yml` + `jobs/`
  interlocks + `LIVE_SEASON` centralized in `config.py` + tests. Verified: pytest 110, actionlint
  clean. **Awaiting review/merge.**
- **`feat/home-page`** (`ed02888`, **local — 4 commits ahead of `origin/feat/home-page`, not pushed**)
  — the `/match/[id]` page + shared web helpers (`LivePill`, `LockStatusLine`, `ResultBadge`,
  `queries/{match,match.preview,shared}.ts`). Verified: tsc/lint/build green, axe 0. **Awaiting
  review/merge** (push the branch first).

**Recommended merge order** (disjoint, so order is for tidiness, not correctness):
1. `feat/scheduler` → `main` (infra/jobs only; establishes the `LIVE_SEASON` single-source).
2. `feat/home-page` → `main` (rebase onto the updated `main`; the 3 shared `src/` files that
   differ between tips are one-sided home-page edits that auto-resolve).
3. Run the combined gate on `main`: web `typecheck`/`lint`/`build`/`test:e2e`, jobs `pytest`,
   `actionlint` — then finalize.

`src/lib/database.types.ts` and `supabase/migrations` are **unchanged on both branches** — no
schema or generated-type drift.

---

## ⏭️ Next up

1. **Ledger / track-record page (`/ledger`)** — the next big visible piece and the brand's trust
   engine (running record incl. losses, mean Brier + log loss, calibration table, sample-size
   note). Currently a TODO stub; the scored data already exists to populate it.
2. **Live-2026 cutover** — gated on buying a **paid API-Football plan** (the free tier can't read
   season 2026). Plug-and-play per `docs/SEEDING.md`: new key, drop the `WC_*` env overrides
   (reverts to 2026/1), **tear down 2022 first**, then run the live pipeline. No code edit.
3. **Enable the scheduler** — uncomment the `schedule:` + four `- cron:` lines in
   `scheduler.yml` at go-live (each cron maps 1:1 to a job via its `if:` guard).

---

## 🔭 Backlog / deferred

- **Harden the dev seeder before cutover** *(the one 🟡)* — `seed_predictions_dev` gates on
  config identity (`SEASON == LIVE_SEASON`) but its write set (`finished_fixtures_ordered()`) is
  **not season-scoped**, unlike `reset_season`. Harmless today (no live 2026 data; single-season-
  per-DB), but scope the reader to `config.SEASON` so it physically can't back-date predictions
  onto another season's fixtures once a mixed/live DB exists.
- **`rls_auto_enable` advisor** (live DB) — pending DB-side hardening; needs a Management-API
  token + the DB to itself. Out of band, not a branch concern.
- **`/match` e2e + axe coverage** — feasible now with the `PREVIEW_MATCH=1` server-only hatch
  (renders all states with no seeded DB); currently only the static pages have specs.
- **Real-store integration tests** — no test runs against real Postgres; upsert idempotency, the
  immutability trigger, and the `prob_*` sum CHECK are asserted only against fakes.
- **`fetch_fixtures` pagination** — before club football (multi-page fixture lists).
- **Sentry + analytics** (Plausible/GA4) on web + jobs.
- **Responsible-gambling support links + legal sign-off** — `/responsible-gambling` ships
  placeholder ("to be confirmed") resources, and the disclaimer copy is developer-authored;
  both need real links / compliance sign-off **before public launch or monetisation**.
- **`README.md` refresh** — stale: cites `ARCHITECTURE.md` at the repo root (it's under `docs/`),
  omits `docs/DESIGN.md` / `docs/SEEDING.md`, and still calls the routes "TODO stubs" / lists
  files that no longer exist (`lib/types.ts`, `MatchCard`/`AdSlot` in the layout block).
- **Minor cleanups** — `scheduler.yml` budget comment is arithmetic'd on the old 64-match format
  (2026 is 104 matches / ~72 worst-case prediction fetches — still < 100/day, conclusion holds);
  `db.finished_fixtures()` (unordered) is dead code; `score_results` re-queries every finished
  fixture each run (N+1, fine at WC scale); `ScoredResult`'s ledger link lacks the `min-h-11`
  tap-target the rest of the codebase uses; `PREVIEW_*` env vars aren't in `.env.local.example`.
- **DB-backed route stubs** — `/ledger`, `/team/[slug]`, `/league/[slug]`, per-URL `sitemap`, and
  a default OG image remain TODO stubs (documented deferred work).

---

## 🔑 Key facts (operational truths for a new session)

- **Stack:** Next.js App Router (RSC/ISR) + Tailwind on Vercel; Supabase Postgres; Python
  scheduled jobs; GitHub Actions schedules the jobs. The two layers meet **only at the database**.
- **The golden rule (§5):** the website only ever **reads** from Supabase; the **jobs are the only
  DB writers and the only football-API callers**. No visitor request ever calls the football API.
  *Verified across `src/` — no per-request external call anywhere.*
- **Key boundary (§7/§12):** web uses the **publishable** key (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  anon, RLS read-only); jobs use the **secret/service** key (`SUPABASE_SECRET_KEY`, server-only,
  bypasses RLS). `supabaseAdmin` is guarded and never client-reachable. No secret is committed or
  in git history; `.env*` is gitignored (only `*.example` tracked). Real secrets live only in
  local gitignored `.env.local` / `jobs/.env` — rotate if any could be a production value.
- **2022 = disposable DEV data** (`season=2022`). The real, locked-before-kickoff public record
  starts only on genuine **future 2026 fixtures** (paid plan). **Never present 2022 as the live
  record.** Only `source='api-football'` is shown; the in-house `inhouse-elo` is logged, never displayed.
- **`LIVE_SEASON`** is the single source of truth in `jobs/config.py`; `WC_SEASON` / `WC_LEAGUE_ID`
  env vars override it for a dev seed (default 2026 / league 1).
- **Plug-and-play cutover:** set the paid `API_FOOTBALL_KEY`, remove the `WC_*` overrides,
  `reset_season --season 2022` **first** (the `leagues.api_league_id` UNIQUE means seeding 2026
  onto the old row would orphan 2022), then run the live pipeline — **no code edit, no commit**.
- **GitHub is the source of truth.** **Lane discipline:** `src/` (frontend) and `jobs/` +
  `supabase/migrations/` (backend) are disjoint ownership; that disjointness is exactly why the
  two branches merge without conflict.

---

## Part A review verdict

- 🔴 **Critical:** none.
- 🟡 **Important (1, not merge-blocking):** `seed_predictions_dev` write set isn't season-scoped —
  defense-in-depth gap on the immutable ledger; close before the live cutover (see Backlog).
- 🟢 **Minor:** ~15 hygiene/polish/deferred-test items (README staleness, stale budget comment,
  dead code, N+1, tap-target, missing `/match` e2e + integration tests, RG placeholder links,
  disclaimer sign-off, `rls_auto_enable`). None block merge.
- ✅ **Verified sound:** the integrity/compliance/security backbone — golden rule; Brier/log-loss
  maths vs §10; the immutability trigger + RLS; lock/score/fetch correctness; void & Elo never
  surfaced; site-wide disclaimer + third-party label + no betting language + plain-text team names;
  the secret-key boundary + no committed secrets; job idempotency; scheduler least-privilege with
  cron disabled; the branches' disjoint merge surface and frozen schema/type contract.
- **Merge verdict:** **safe to merge as-is.** Order: `feat/scheduler` → `main`, then rebase
  `feat/home-page` → `main`, then run the combined gate. Address the one 🟡 before the live cutover,
  not before merge.
