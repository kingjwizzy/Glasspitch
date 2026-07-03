# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Glass Pitch — a free, mobile-first **football analysis** site. Per-match H/D/A
probabilities, predicted score, form, and a plain-language read; the moat is a
permanent, public, immutable **prediction ledger** that scores wins *and* losses
(Brier, log loss, calibration). Framed as analysis, **not betting advice**.

**`docs/ARCHITECTURE.md` is the single source of truth — read it first.**
`docs/DESIGN.md` is the source of truth for colours, tokens, type, and voice.
Do not let the build drift from their invariants; no skill may override them.

## The golden rule (non-negotiable, ARCHITECTURE.md §5)

**The scheduled Python jobs talk to the football API and are the only DB writers;
the website only ever reads from Supabase.** No third-party API call is ever
triggered by a visitor. The two layers meet *only* at the Postgres database.

*v2 amendment (2026-07-03):* the sole sanctioned exception is the **Stripe webhook
route handler** — server-only, signature-verified, idempotent via `stripe_events` —
which writes **billing/account tables only** (`profiles`, `subscriptions`,
`stripe_events`). Football-data tables remain writable by the jobs alone
(enforced by table grants, not convention).

```
API-Football ──▶ Python jobs ──▶ Supabase (write) ──▶ Next.js (read) ──▶ visitor
```

This decoupling is why the web framework is replaceable but the data layer is not.

## Repo shape

- `src/` — Next.js App Router web layer (read-only consumer of the DB).
  - `app/` — routes: `/`, `/match/[id]`, `/team/[slug]`, `/league/[slug]`,
    `/ledger`, `/about`, `/responsible-gambling`, plus generated `sitemap.ts` /
    `robots.ts`. DB-backed dynamic routes are still TODO stubs citing ARCHITECTURE.md §§.
  - `lib/` — `supabaseClient.ts` (publishable key, read-only, RLS-enforced; safe in
    the browser) vs `supabaseAdmin.ts` (**secret key, server-only, bypasses RLS** —
    has a module-load guard that throws if imported client-side). `database.types.ts`
    is the generated Supabase type map.
- `jobs/` — Python scheduled jobs; **the only writers** (see jobs section below).
- `supabase/migrations/` — schema, the ledger immutability trigger, and RLS.
- `e2e/` — Playwright smoke + a11y specs.
- `docs/ARCHITECTURE.md`, `docs/DESIGN.md` — sources of truth.

## Commands — web

```bash
npm install
cp .env.local.example .env.local   # fill in values; never commit .env.local
npm run dev                        # http://localhost:3000
npm run build                      # next build
npm run lint                       # eslint
npm run typecheck                  # tsc --noEmit  (no emit; CI gate)
npm run test:e2e                   # playwright test
```

E2E runs against a **production build** (`next build && next start`), not the dev
server — dev-server console noise would break the "no console errors" assertion.
The webServer is auto-started by `playwright.config.ts`; every spec runs at both a
phone (Pixel 5) and desktop viewport. Current specs only cover the static,
DB-free pages (`/`, `/about`, `/ledger`, `/responsible-gambling`); dynamic
DB-backed routes are deferred until there's a seeded local Supabase.

```bash
npx playwright test e2e/smoke.spec.ts                 # one spec file
npx playwright test -g "no serious or critical a11y"  # tests matching a title
```

## Commands — jobs (Python)

**Always run jobs and tests as modules from the repo root** (`pytest.ini` sets
`pythonpath = .` so the `jobs` package imports cleanly).

```bash
python3 -m venv jobs/.venv && source jobs/.venv/bin/activate
pip install -r jobs/requirements-dev.txt   # runtime + pytest (requirements.txt = runtime only)
cp jobs/.env.example jobs/.env             # fill in values; never commit

python -m pytest                                          # all unit tests (no network/DB)
python -m pytest jobs/tests/test_scoring.py               # one file
python -m pytest jobs/tests/test_scoring.py::test_brier   # one test
python -m pytest -v                                       # verbose

python -m jobs.fetch_fixtures --dry-run    # preview: fetch+parse+log, no DB write
python -m jobs.fetch_fixtures              # live; add -v for debug logging
```

`--dry-run` does everything **except write to the DB** — but it **still calls the
football API** and counts against the daily budget. Tests use mocked API
responses + an in-memory store, so they hit no network and no database.

## How the jobs pipeline works (ARCHITECTURE.md §8)

Four jobs, each a module with `run(*, dry_run=...)` wired through `cli.py`:

1. `fetch_fixtures` (**daily**) — upsert leagues/teams/fixtures keyed on `api_*` ids.
2. `fetch_predictions` (**daily**) — fetch each fixture's third-party prediction
   **exactly once, ever**, store it `published`, and log an in-house Elo prediction
   alongside (`elo-v1`, never displayed).
3. `lock_predictions` (**every ~10–15 min**) — at kickoff, `published` → `locked`;
   anything published *after* kickoff → `unlocked_void` (integrity over coverage —
   excluded from the scored record).
4. `score_results` (**around match end**) — finished fixtures: copy final score, set
   result, compute Brier + log loss, set `scored`.

Shared infra: `config.py` (tracked leagues — `[1]` = FIFA World Cup, season 2026;
API base URL + auth header with a one-line RapidAPI switch; `MAX_REQUESTS_PER_RUN`),
`apiclient.py` (auth, retry/backoff, request counting + per-run budget guard),
`db.py` (`SupabaseStore`, idempotent upserts keyed on `api_*` ids), `util.py`,
`scoring.py`, `elo.py`. All writes are idempotent; re-running any job is safe.

**Rate budget:** free tier = 100 req/day. Staying under it is a property of the
*fetch-once* design, not the guard. `MAX_REQUESTS_PER_RUN` (default 100) is a
per-run ceiling only — jobs are separate processes, so it does **not** account
across runs. The website never calls the API.

## Invariants that must not be broken

- **Web never calls the football API; only the Python jobs write to the DB.** (§5)
- **The ledger is immutable after kickoff.** A DB trigger rejects updates to
  `prob_*`, `predicted_*`, `model_version`, `source`, `published_at` once
  `locked_at <= now()`; only scoring fields may still be written. `prob_*` must sum
  to ~1.0 (CHECK). Don't weaken these. (§7, §10)
- **RLS:** anon/publishable role is read-only; only the service/secret role writes.
  `SUPABASE_SECRET_KEY` and `API_FOOTBALL_KEY` are server-only — never in the client
  bundle or the repo. `.env*` is git-ignored except `*.example` templates. (§7, §12)
- **Compliance is baked in, not bolted on:** the "analysis, not betting advice / 18+
  / gamble responsibly" disclaimer is in the base layout and on every page. **No** team
  crests, player photos, badges, or official tournament marks — **plain-text team
  names only**. No odds comparison, no affiliate / "bet now" links. (§13)
- **Monetisation (v2, 2026-07-03): premium is ON** — Stripe, **test mode** until
  restricted-business vetting + legal sign-off clear, then live keys. The **full
  scored ledger and every prediction stay free forever**; premium gates only depth
  content (insights/xG, ledger CSV/filters) held in subscriber-RLS tables.
  `predictions.tier` is *not* the gating mechanism. Accounts exist via Supabase
  Auth with minimal personal data; ICO registration before public sign-up
  promotion. **Ads stay off.** (§4, §13)

## Skill routing

At the start of any task, work out which installed skills apply and use them.
Prefer the most specific; don't stack overlapping skills.

Frontend / UI (components, pages, styling, layout, accessibility, charts):
- ui-ux-pro-max — UI/UX decisions: layout, interaction states, a11y, typography, chart choice.
- ui-styling — implementing those components in Tailwind + shadcn/ui (shadcn adopted for
  interactive primitives only — see docs/ARCHITECTURE.md §6).
- Source of truth is docs/DESIGN.md — its colours, tokens, type, and voice. Use these
  skills to BUILD that system; never to invent a new palette, theme, or token set.

Data / backend (Supabase, SQL, schema):
- supabase — anything touching Supabase: client reads (supabase-js / @supabase/ssr),
  auth, RLS, migrations, Edge Functions.
- supabase-postgres-best-practices — writing, reviewing, or optimising SQL, schema, indexes.

Asset / marketing work (ONLY when explicitly doing it — not during normal app building):
- brand — brand voice, messaging, style guides.
- design / design-system — logos, corporate identity, token systems
  (defer to docs/DESIGN.md for this project's tokens).
- slides — building a pitch deck / presentation.
- banner-design — social, ad, or hero banners.

Defaults: frontend work → ui-ux-pro-max + ui-styling. Data work → supabase.
For the review/commit pass you may invoke the built-in code-review / verify workflows.

Hard rule: no design or asset skill may override docs/DESIGN.md or docs/ARCHITECTURE.md.

shadcn/ui is **scoped**: accessible interactive primitives only (Dialog, Dropdown,
Popover, Tabs, Combobox, Toast). Presentational/content components (MatchCard,
ProbabilityBar, tables, badges) stay hand-built RSC + Tailwind to keep the SEO
surface zero-client-JS. Every shadcn component is restyled to DESIGN.md tokens. (§6)

## Agent roster (delegated specialists)

Four project subagents live in `.claude/agents/` (each file holds the full brief). They are
**on-demand specialists** the main session delegates to — each runs in its own fresh context
and reports back; they are *not* always-on parallel workers. Tool access is least-privilege,
and file ownership is **disjoint** so they never collide.

| Agent | Owns (writes) | Model | Fires when |
|---|---|---|---|
| `frontend-dev` | `src/` | sonnet | UI: pages, components, Tailwind, scoped shadcn primitives, a11y, SEO. Read-only Supabase; no DB writes. |
| `backend-jobs` | `jobs/` (non-test), `supabase/migrations/` | sonnet | Python jobs, scoring/Elo, schema/migrations/RLS — **the only DB writer**. |
| `checks-reviewer` | nothing (**READ-ONLY**) | opus | Gate a diff: full CI suite + `/code-review` + `/security-review` + invariant audit. Never edits. |
| `test-engineer` | `jobs/tests/`, `e2e/` | sonnet | Authoring/running pytest + Playwright/axe specs. |

**Standard pipeline:** `backend-jobs` (schema) → `frontend-dev` (types + UI) → `test-engineer`
(coverage) → `checks-reviewer` (acceptance). The reviewer returns Critical/Warning/Suggestion
findings; the builders apply the fixes. Run `/gate` as a shortcut for the reviewer pass.

Two agents may run in parallel only on **disjoint files** (the safe pair is `frontend-dev` +
`backend-jobs`); `checks-reviewer` and `test-engineer` run *after* the builders. Editing an
agent file on disk needs a session restart to take effect; the `/agents` UI applies edits
immediately.
