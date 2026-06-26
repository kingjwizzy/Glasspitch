// Site-wide constants and compliance copy.
//
// The disclaimer / "analysis not advice" language is surfaced verbatim
// (ARCHITECTURE.md §9, §13). Do not edit the legal text without sign-off — it
// is baked into the global layout so it appears on every page by default.

export const SITE_NAME = 'Glass Pitch';

// Persistent compliance banner text — rendered on EVERY page by the root
// layout (ARCHITECTURE.md §13). Exact wording is intentional.
export const DISCLAIMER =
  'Analysis and probabilities only — not betting advice. 18+. Please gamble responsibly.';

// Fuller analysis-not-advice statement for prediction/match views (§9).
export const ANALYSIS_NOT_ADVICE =
  'Analysis and probabilities only — not betting advice. Outcomes are uncertain; we do not guarantee results and we do not claim to beat the market.';

export const RESPONSIBLE_GAMBLING = '18+. Please gamble responsibly.';

// Third-party model labelling required on every match page (§9).
export const THIRD_PARTY_LABEL =
  'Probabilities from a third-party model; context, not a guarantee.';

// Public base URL for metadata, Open Graph, sitemap and robots. Falls back to
// localhost when NEXT_PUBLIC_SITE_URL is unset OR empty — `||` (not `??`) so a
// present-but-empty env value also falls back, avoiding new URL('') (§4, §5, §11).
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
