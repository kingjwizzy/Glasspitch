# Glass Pitch

A free, mobile-first **football analysis** site. For each match it shows
home/draw/away probabilities, a predicted score, recent form, and a short
plain-language read of the matchup — framed as **analysis and probability, not a
guarantee and not regulated betting advice**.

The identity and the moat is **radical transparency**: a permanent, public
**prediction ledger**. Every prediction is timestamped, **locked at kickoff**,
scored properly after full-time (Brier score, log loss, calibration), and the
misses stay visible forever.

> `docs/ARCHITECTURE.md` is the single source of truth for this project; read it
> first, and do not let the build drift from its invariants. `docs/DESIGN.md` is
> the source of truth for colours, tokens, type, and voice. `docs/STATUS.md` is
> the live snapshot of what is built vs. outstanding, and `docs/SEEDING.md` is the
> live-cutover runbook.

## The golden rule

**The scheduled Python jobs talk to the football API; the website only ever
talks to our own database.** No third-party API call is ever triggered by a
visitor. The web layer and the Python layer meet **only** at the Supabase
database (docs/ARCHITECTURE.md §5, §6).

```
API-Football ──▶ Python jobs ──▶ Supabase (write) ──▶ Next.js (read) ──▶ visitor
```

## Stack

- **Web:** Next.js (App Router) + TypeScript + Tailwind CSS, deployed on Vercel.
- **Database:** Supabase Postgres (single source of truth; Row Level Security).
- **Jobs / model / scoring:** Python, scheduled (cron). See [`jobs/`](./jobs).

## Project layout

```
src/
  app/                     App Router routes (see below) + sitemap.ts, robots.ts
  components/              Hand-built RSC + Tailwind: Header, Footer,
                           DisclaimerBanner, ProbabilityBar, MatchCard, ledger/
                           and match/ and home/ presentational components, AdSlot
                           (built-ready, renders nothing in v1)
  lib/                     supabaseClient (anon, read-only), supabaseAdmin
                           (service-role, server-only, guarded), queries/ (the
                           server-only read layer), types.ts, format.ts, constants.ts
jobs/                      Python scheduled jobs (the only DB writers) — see jobs/README.md
supabase/migrations/       Schema, the ledger immutability trigger, RLS
e2e/                       Playwright smoke + axe specs
docs/                      ARCHITECTURE.md, DESIGN.md, STATUS.md, SEEDING.md
```

### Routes (docs/ARCHITECTURE.md §11)

| Route | Purpose |
|---|---|
| `/` | Home: featured upcoming matches, link to the ledger |
| `/match/[id]` | Match page: H/D/A %, predicted score, form, written read |
| `/team/[slug]` | Team page: upcoming + recent fixtures, form |
| `/league/[slug]` | League page: fixtures list |
| `/ledger` | Full public track record incl. losses, Brier, calibration, sample size |
| `/about` | What this is, methodology, "analysis not advice" positioning |
| `/responsible-gambling` | 18+, signposting to support resources |
| `/sitemap.xml`, `/robots.txt` | SEO (generated) |

All routes are built and read live from Supabase (ISR, zero client JS); the
in-house Elo and any voided predictions are never surfaced. The one remaining
placeholder is `/responsible-gambling`, whose support links await
launch-time confirmation and legal sign-off. See `docs/STATUS.md` for the full
built-vs-outstanding breakdown.

## Local setup — web

```bash
npm install
cp .env.local.example .env.local   # then fill in the values (never commit .env.local)
npm run dev                        # http://localhost:3000
```

Other scripts: `npm run build`, `npm run start`, `npm run lint`.

### Environment variables (`.env.local`)

| Variable | Public? | What it is |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | Supabase publishable key, `sb_publishable_…` (read-only via RLS) |
| `SUPABASE_SECRET_KEY` | **secret** | Supabase secret key, `sb_secret_…` (server-only; bypasses RLS) |
| `API_FOOTBALL_KEY` | **secret** | API-Football key |
| `NEXT_PUBLIC_SITE_URL` | public | Deployed base URL (metadata/OG/sitemap) |

Secrets live only in the environment — never in the client bundle or the repo
(docs/ARCHITECTURE.md §12). All `.env*` files are git-ignored except the `*.example`
templates.

## Local setup — jobs

See [`jobs/README.md`](./jobs/README.md). The four-job pipeline, the scoring
maths, and both dev tools are implemented and unit-tested (106 pytest tests,
mocked — no network, no DB):

```bash
cd jobs
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest tests -q
```

## Database

Schema, the prediction-ledger immutability trigger, and Row Level Security are
defined per docs/ARCHITECTURE.md §7 and applied to the Supabase project via the
Supabase MCP. The anon/public role is read-only; only the service role (the
Python jobs) may write.

## Compliance

This is a football **analysis** product, not a gambling operator and not betting
advice (docs/ARCHITECTURE.md §13). The disclaimer *"Analysis and probabilities only —
not betting advice. 18+. Please gamble responsibly."* is baked into the base
layout and appears on every page. Plain-text team names only — no crests,
badges, player photos, or official tournament marks.
