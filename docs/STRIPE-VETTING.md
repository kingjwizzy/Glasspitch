# Stripe restricted-business review — evidence pack

Prepared 2026-07-03 for the owner to submit with Stripe's business
verification / in reply to any restricted-business questionnaire. Goal:
written confirmation that Glass Pitch may process subscriptions with live
keys. Position consistently everywhere: **statistics & analysis publisher**.

## One-paragraph description (use verbatim in "business description")

> Glass Pitch (glasspitch.com) is a football statistics and analysis
> publication. We publish match probabilities, expected-goals data and
> statistical breakdowns, framed explicitly as analysis — not betting
> advice. We publish no odds, no betting tips, carry no bookmaker
> advertising or affiliate links, and do not take, place, route or
> facilitate bets of any kind. Subscriptions (£6/month or £39/year) unlock
> deeper statistical content only — expected-goals breakdowns, pre-match
> statistical comparisons and data exports. Every prediction and our
> complete accuracy record remain free; uniquely, our track record is
> database-enforced: predictions lock immutably at kickoff and are scored
> publicly after full time — including our misses — with a published
> SHA-256 hash chain so third parties can verify nothing is ever rewritten.

## Anticipated questions → answers

- **Do you provide gambling services or betting tips?** No. We publish
  statistical analysis. No odds are displayed anywhere; no tips or stakes
  are suggested; the site's every page carries "analysis, not betting
  advice; 18+; gamble responsibly" with links to GamCare, GAMSTOP and
  GambleAware.
- **Is this "sports forecasting or odds-making"?** We publish probabilities
  as statistical context, comparable to FiveThirtyEight-style sports
  analytics journalism. We never sell picks: paid content is depth
  statistics (xG, comparisons, CSV export) — the forecasts themselves are
  free to everyone, permanently, with our misses published as prominently
  as our hits (see glasspitch.com/ledger and /methodology).
- **What exactly do subscribers pay for?** xG/statistical depth panels,
  data exports, and analysis tools. Not predictions, not tips, not access
  to "winning" picks.
- **Age controls?** 18+ attestation checkbox at account creation, stored
  per profile; responsible-gambling signposting sitewide.
- **Regulatory status?** Not a gambling operator under the Gambling Act
  2005 (no betting is taken, held, routed or facilitated); ICO-registered
  data controller; UK GDPR-compliant privacy/terms/refunds published.

## Evidence links to include

- https://glasspitch.com/methodology — how locking/scoring works
- https://glasspitch.com/ledger — the public record incl. losses
- https://glasspitch.com/responsible-gambling — support signposting
- https://glasspitch.com/premium — what is (and isn't) paid
- https://glasspitch.com/terms · /privacy · /refunds

## Flip checklist (the moment written approval arrives)

1. Owner: Vercel Pro upgrade (Hobby is non-commercial).
2. Owner: toggle Stripe to live mode; Claude creates live product + prices
   + webhook endpoint and swaps the three Vercel env vars.
3. Claude: end-to-end live-mode test with a real card + immediate refund;
   surface premium in nav; remove /premium noindex; announce quietly.
