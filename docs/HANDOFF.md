# HANDOFF — Glass Pitch (launch sessions, 2026-07-03 → 04)

**Purpose:** everything a fresh Claude Code session (or human) needs to
continue this project with zero context loss. Reading order for a new
session: `CLAUDE.md` → `docs/ARCHITECTURE.md` → this file → `docs/STATUS.md`
(current state) → `docs/ROADMAP.md` (strategy + queue).

---

## 1. What happened (compressed timeline)

**2026-07-03 (launch day).** Started from a feature-complete but unlaunched
v1 (fake 2022 seed data, no deploys, premium off). In one continuous run:
- 139-agent audit of the whole repo → 123 verified findings → all addressed.
- v2 build: DB hardening (migration 0003), premium stack (0004: profiles/
  subscriptions/stripe_events/fixture_insights, @supabase/ssr auth, Stripe
  checkout/webhook/portal in test mode), legal pages.
- Live cutover: wiped 2022 seed via `teardown_season()`, fetched real WC
  2026 data on the new API-Football **Pro** plan, repo → public, all
  scheduler crons on, Vercel project created + glasspitch.com attached.
  First locked prediction that evening; first scored receipt that night.
- v3 build: homepage redesign ("receipts under floodlight") + national
  flags, Golden Boot (0005), Beat the Model pools + probability snapshots
  (0006), WC Chances Monte Carlo + ledger hash chain + email tables (0007),
  /matches /leagues /methodology /board /chances /play, share/OG kit,
  original SVG illustration pack, PWA, Vercel Analytics.
- Four research rounds (competitor design, monetization, ledger-independent
  revenue, audience/retention) → `docs/ROADMAP.md`.

**2026-07-04.** Stripe approved live payments ("sports forecasting"
restricted-business review cleared — evidence pack in
`docs/STRIPE-VETTING.md`). Repriced to **£6/mo · £39/yr** (owner decision;
old £4/£29 test prices archived). Owner completed: Vercel Pro, live keys →
Vercel (sensitive/write-only), live webhook + signing secret, live Customer
Portal. Claude flipped `NEXT_PUBLIC_PREMIUM_LIVE=1` → **gold "Go Premium"
header CTA live, /premium indexable, real payments on.** Final gate passed
after fixing its findings; post-launch hardening audit run (see STATUS for
its outcome).

## 2. Infrastructure map (who/what/where)

| Thing | Where | Notes |
|---|---|---|
| Domain | glasspitch.com — Namecheap | A @→76.76.21.21, CNAME www→cname.vercel-dns.com; email forwarding: support@glasspitch.com → owner Gmail |
| Hosting | Vercel **Pro**, team `venture2`, project `glasspitch` | GitHub app installed → push to main auto-deploys. 9+ prod env vars incl. Stripe live keys (sensitive = write-only; CLI cannot read back — dashboard shows "Updated" age, `vercel env ls` shows *created* age: don't repeat the launch-night false alarm) |
| Database | Supabase **Pro**, org `biwpenhkajguerltotfy`, project `vrcnbvijanpxrqwndnyl` (eu-central-2) | Migrations 0001–0007 applied live; apply via MCP `apply_migration` (needs owner-authorized session) |
| Repo | github.com/kingjwizzy/Glasspitch — **public** | Actions secrets: SUPABASE_URL, SUPABASE_SECRET_KEY, API_FOOTBALL_KEY. History verified secret-free before flip |
| Football data | API-Football **Pro** (7,500 req/day, renews ~3rd monthly) | Key in jobs/.env + Actions secrets. `/fixtures` rejects a `page` param on page 1 |
| Payments | Stripe LIVE — product `Glass Pitch Premium`, £6/mo `price_1TpGIxELUAiNtxuoGvR8hHXu`, £39/yr `price_1TpGIxELUAiNtxuocN6fK7YI` | Webhook: glasspitch.com/api/stripe/webhook (4 subscription events). Statement descriptor GLASSPITCH.COM. Test-mode objects still exist for staging |
| Auth | Supabase Auth, magic link | Site URL + redirect allow-list configured (glasspitch.com/auth/callback + /auth/confirm). **No custom SMTP yet** — built-in mailer is trickle-rate; add Resend before promoting sign-ups |
| Email capture | Built, dormant | Activates when owner sets EMAIL_CAPTURE_ENABLED=1 + RESEND_API_KEY |
| Scheduler | GitHub Actions, 11 jobs | fetch_fixtures */15 · lock */10 · score + score_user_predictions */20 · fetch_insights 6h · topscorers, snapshots, chances ×2, ledger_integrity daily · keepalive monthly. Failure → auto-opened GitHub issue; every run writes a `job_runs` row |

## 3. Decision log (owner, binding)

- Ledger is NOT the sole draw; may be de-emphasized/hidden later (recording
  never stops); monetization must not depend on it.
- §5 writer amendments: Stripe webhook (billing) · user game picks
  (owner-scoped RLS, pre-kickoff only) · email-capture route. FPL API
  approved as second jobs source (August).
- Pricing £6/mo · £39/yr ("Founding season" lock, no urgency copy ever).
- National flags sanctioned; club crests stay banned (kit-color chips +
  monograms in August); player photos banned pending Wikimedia-CC legal
  answer (question is with owner's legal contact).
- Premium gates depth only; all predictions + full ledger stay free.
- Ads stay off. No affiliates/odds ever.

## 4. Runbooks

- **Deploy:** push to main (auto) or `npx vercel deploy --prod --yes --scope venture2`.
- **Run a job manually:** `source jobs/.venv/bin/activate && python -m jobs.<name>` (repo root; add `--dry-run` to preview).
- **Apply a migration live:** MCP `apply_migration` with the file verbatim,
  then `get_advisors`, then regenerate `src/lib/database.types.ts`.
- **Working-tree vs live schema drift** (job crashes on missing column):
  run the committed code from a throwaway worktree: `git worktree add <tmp> HEAD`.
- **Flip a feature flag:** `printf '<v>' | npx vercel env add <NAME> production --scope venture2` then redeploy (env changes need a deploy).
- **Verify ledger integrity:** `ledger_checkpoints` table (public) — chain
  recomputation procedure documented in `jobs/ledger_integrity.py`.
- **Health check:** `job_runs` table + `gh run list --workflow=scheduler.yml`.

## 5. Incidents & lessons (don't relearn these)

1. **Scroll-reveal invisibility (P1, fixed):** CSS view()-timeline + `both`
   fill left 5/7 homepage sections at opacity 0 for real users. Rule:
   content visibility must never depend on an animation timeline firing.
   e2e now asserts section visibility, not mere presence.
2. **Frozen matchday statuses (fixed):** 6h status polling froze "live"
   states for hours. Now */15. Live in-play scores still aren't stored —
   that's the W7 watcher feature, not a bug.
3. **`vercel env ls` shows created-at, not updated-at** — cost 30 min of
   false alarm on flip night. Dashboard shows the truth.
4. **Supabase CLI churn:** `status -o json` omits keys when [auth] disabled;
   field names vary by release. ci.yml handles both; auth must stay enabled
   in supabase/config.toml (integration tests create real users).
5. **First receipt convention:** on tied probabilities (45/45) the headline
   call tie-breaks to home and the site scores itself a MISS — the strict
   framing is deliberate brand policy. Keep displays consistent with it.
6. **API quirks:** penalties leave fulltime score drawn (`winner_team_id`
   is bracket truth); `advice`/`win_or_draw`/`under_over`/`winner.comment`
   are betting vocabulary — never stored (compliance tests assert absence).

## 6. Next session's queue

1. **W7 (designed, unbuilt):** 60s matchday live-score watcher (long-running
   Actions job + live-score columns + signed on-demand revalidation route),
   /bracket knockout tree page (data already stored), StreamCard H/A chips.
2. **Traction plan execution** (ROADMAP §3) — time-critical through the WC
   final Jul 19: receipt cadence needs @glasspitch handles (owner),
   Show HN Jul 7, press wave at semis.
3. **Owner queue:** Resend key (email capture), X/Bluesky accounts,
   Wikimedia photo answer, Search Console, Sentry DSNs.
4. **August:** club-football expansion (multi-league schema, provider seam,
   kit identity, xPoints spike) — all specced in ROADMAP §4.

*Written 2026-07-04 at the close of the launch sessions. The session memory
(auto-memory) mirrors this file's operational facts.*
