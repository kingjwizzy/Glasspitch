# DESIGN.md — Glass Pitch design system

> Read alongside ARCHITECTURE.md. That file governs how the app is *built*; this governs how it *looks, feels, and keeps people coming back*. When building or restyling any page, read both — and use the uploaded UI/UX skill.

---

## 1. North star

The name says it: **glass** (you see straight through it) + **pitch**. The brand's whole identity is **transparency** — we publish a locked, scored, losses-included record when every tipster hides theirs. So the design's job is to *look* as honest as the product is: clarity over decoration, nothing buried, the misses shown as proudly as the hits.

The signature element is therefore **visible honesty**: the "how our calls landed" strip (green ✓ / red ✗) lives on the home page, and the ledger is a first-class, beautifully-made page — not a footnote. That, plus a subtle layered-"glass" surface treatment, is what makes Glass Pitch recognisable.

Deliberately avoided: the generic "near-black background + one neon-green accent" look (a known AI-design default). We use a green-*tinted* charcoal (not pure black), a considered pitch-green (not acid neon), and a colour-blind-safe blue/amber system for the data itself — so the green stays a brand note, not the whole personality.

---

## 2. Colour system

Dark-first (sports/data products live in dark mode; it suits evening matchday use). Every value is a token — theme the whole site from these, never hardcode.

**Surfaces & text**
- `--bg` `#0E1311` — page; deep floodlit-pitch charcoal (green-tinted, not black)
- `--surface` `#161D1A` — raised cards (the "glass" layer)
- `--surface-2` `#1E2723` — higher elevation / hover
- `--line` `rgba(255,255,255,0.08)` — hairline dividers (named `--line` in the implementation)
- `--text` `#EAF0EC` — primary
- `--text-dim` `#9DA8A2` — secondary
- `--text-faint` `#6B746F` — hints / labels

**Brand**
- `--green` `#35B27A` — brand accent, primary actions, links, "hit". A considered pitch-green, not neon. (Lighten to `#46C28A` for small text/links if a pairing dips below 4.5:1.)

**Data — probabilities (colour-blind-safe by design)**
- `--home` `#4C9AFF` (blue) · `--draw` `#8A938F` (grey) · `--away` `#F2A33C` (amber)

Why blue/grey/amber, not green/grey/red: red↔green is the single worst pair for colour vision deficiency (~1 in 12 men), and this audience skews male. Blue + amber is the safest contrasting pair there is, so the *meaning-carrying data* uses it.

**Results / status (semantic)**
- hit ✓ `--green` `#35B27A` · miss ✗ `--miss` `#F2555A` · live `--live` `#F2555A`

**Hard rule — colour is never the only signal.** Every probability shows its % label; every W/D/L chip shows the letter; every hit/miss shows a ✓/✗ icon. The design must still parse in greyscale. Verify every text/background pair at WCAG AA (4.5:1).

---

## 3. Typography

Three deliberate roles (load via next/font, minimal weights):
- Display — **Archivo** (a heavier/expanded cut, used with restraint): sporty-editorial headlines and section titles.
- Body / UI — **Hanken Grotesk**: warm, highly readable; all running text and controls.
- Data — **IBM Plex Mono** (tabular figures): scorelines, percentages, Brier/log-loss, ledger numbers. Numbers as an aligned mono is the "we take our numbers seriously" signature — used sparingly, for data only.

Scale (mobile): display 22–28 / h2 18 / h3 16 / body 16 (line-height 1.6) / small 13 / micro 11. Mostly two weights (regular + medium). **Sentence case everywhere** — never Title Case, never ALL CAPS.

---

## 4. Layout & key screens

Mobile-first, single column, generous breathing room. Tap targets ≥ 44px.

**Home** (the shop window — matchday energy, top to bottom):
1. Matchday / live — any in-play match with a LIVE badge + minute, the live score, and *our locked pre-match call* underneath (watch the prediction play out). "Also today" lists remaining kickoffs.
2. Upcoming — next fixtures, each a tappable row: teams, kickoff, a slim home/draw/away bar.
3. What we're watching — 1–2 featured matchups with a one-line hook (usually the model's tightest call). Honest framing, never "guaranteed".
4. How recent calls landed — finished matches, the probability we assigned, a green ✓ / red ✗. Misses beside hits. This is the signature.
5. Golden Boot race — top scorers (name · nation · goals). Text + numbers only (no photos/crests).
6. Record band — "N scored · losses shown → ledger".
7. Footer — disclaimer.

**Match page:** competition + kickoff → teams (plain text) → segmented H/D/A bar with labels + % → predicted score → recent form (W/D/L chips) → the written read → "third-party model" tag → disclaimer → ledger callout.

**Ledger (first-class):** running record incl. losses, mean Brier + mean log loss, a calibration table (predicted-probability buckets vs observed frequency), and a clear sample-size / confidence note. Reflects only real scored predictions; if empty, say so plainly. Make this page genuinely excellent — it's the trust engine.

**Components** (small, typed, reusable): Header, DisclaimerBanner, MatchCard, ProbabilityBar, FormChips, ResultBadge (✓/✗), ScoreLine, LedgerTable, CalibrationTable, SectionHeader, AdSlot (renders nothing — reserved).

---

## 5. Motion

Deliberate and quiet (scattered animation is an AI-design tell): a gentle pulse on the LIVE dot, a subtle score tick, soft section fade-in on scroll. Everything respects `prefers-reduced-motion`.

---

## 6. Engagement & retention — the honest way

Stickiness here comes from substance, not tricks. The strongest, on-brand loops:
- **Matchday liveness** — fresh every day there's football; a reason to open.
- **The record as the hook** — people return to see whether our calls landed. The honesty *is* the retention.
- **Results & followed-team alerts** — opt-in only, never spammy.
- **Beat the model** (the big one) — a free, virtual-points prediction game: predict outcomes, earn points, climb a leaderboard, and track your *own* record against the model's. Non-gambling (no money, no prizes — keeps you the right side of ARCHITECTURE.md §13), genuinely sticky, and perfectly on-brand: everyone keeps an honest record, not just us. (v2 — reserve for it now.)
- **Shareable result cards** — "I beat the model this week."
- **Speed** — a fast, installable (PWA-lite) site is itself retention.

**Paywall & upgrade CTAs (v2, 2026-07-03):** the upgrade surface obeys the responsible-design rule absolutely. State plainly what premium contains, the price, and that **the ledger and all predictions stay free**; never imply paying improves the predictions. No urgency, no countdowns, no guilt copy ("only serious fans…"), no interstitials or overlays blocking free content, no more than one quiet upgrade affordance per page. Cancelling must be as easy as subscribing (Stripe Customer Portal, linked plainly).

**Responsible-design rule (non-negotiable):** this is a gambling-*adjacent* product, so engagement must never tip into manipulation — no fake urgency, no dark patterns, no variable-reward dopamine traps, no notification spam, nothing engineered to be compulsive. That's an ethical line (some of the audience are vulnerable to gambling harm) *and* a strategic one (a brand whose entire pitch is honesty cannot use sleazy retention mechanics, and manipulative engagement around gambling draws regulatory and ad-platform fire). Sticky through usefulness and trust — full stop.

---

## 7. Accessibility & quality floor

Non-negotiable: responsive down to small mobile; visible keyboard focus; `prefers-reduced-motion` respected; semantic HTML and sensible heading order; alt text; colour never the sole carrier of meaning (§2); WCAG AA contrast on every text/background pair. Test the palette through a colour-vision-deficiency simulator before shipping.

---

## 8. Frontend architecture (build it right)

- **React Server Components + App Router**: fetch on the server, ship minimal client JS.
- **Rendering**: SSG/ISR for content; match pages revalidate frequently around kickoff, the ledger periodically. **Never call the football API per visitor** — read from Supabase (publishable key, RLS read-only). Matches ARCHITECTURE.md §5.
- **Core Web Vitals budget**: LCP < 2.5s, CLS ≈ 0, INP < 200ms. next/font (self-hosted, no layout shift), next/image, reserve space for dynamic blocks.
- **Tokens in one place**: the colour + type tokens above live in the Tailwind theme / CSS variables, so the whole site themes from them and a future light theme (or rebrand) is a token change, not a rewrite.
- **Streaming + Suspense** for perceived speed; lazy-load below the fold; prefetch links.
- **PWA-lite**: web manifest, installable, fast repeat loads.

---

## 9. Copy & voice

Plain, active, sentence case, honest. A control says what it does ("See the ledger", not "Submit"). Empty states invite action ("No scored predictions yet — check back after kickoff"); errors give direction, not mood. Never hype, never "guaranteed", never imply beating the market (ARCHITECTURE.md §9/§13). The voice is a sharp, honest analyst — confident about the process, humble about the uncertainty.
