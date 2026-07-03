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
// localhost in dev/test, but a REAL production deploy that forgets the env var
// must never silently emit localhost into canonical/OG/sitemap/robots/JSON-LD
// (§4, §5, §11) — so a genuine production build with nothing set is a hard
// build-time failure, not a silent poison.
//
// `ALLOW_PREVIEW=1` is the same flag that unlocks the server-only PREVIEW_*
// fixture hatches (see queries/shared.ts) and is set by this repo's own e2e
// suite, which deliberately runs a production build (`next build && next
// start` — playwright.config.ts) potentially without NEXT_PUBLIC_SITE_URL
// filled into a contributor's .env.local. Treating that as "not a real
// production deploy" lets local e2e keep falling back to localhost while a
// genuine Vercel/production deploy still fails loudly. CI's own web/e2e jobs
// set NEXT_PUBLIC_SITE_URL explicitly either way (.github/workflows/ci.yml),
// so this fallback path is never actually exercised there.
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit;

  const isPreviewBuild = process.env.ALLOW_PREVIEW === '1';
  const isProductionDeploy =
    !isPreviewBuild &&
    (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production');

  if (isProductionDeploy) {
    const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    if (vercelUrl) return `https://${vercelUrl}`;
    throw new Error(
      'NEXT_PUBLIC_SITE_URL is not set in production, and no ' +
        'VERCEL_PROJECT_PRODUCTION_URL fallback is available. Canonical URLs, ' +
        'Open Graph, the sitemap and robots.txt all depend on it — set ' +
        'NEXT_PUBLIC_SITE_URL before deploying (ARCHITECTURE.md §11).',
    );
  }

  return 'http://localhost:3000';
}

export const SITE_URL = resolveSiteUrl();

// Season floor for every web read that surfaces predictions/fixtures as "the
// record" (ledger, homepage, team/league fixture lists, match lookups, the
// sitemap's match URLs). Defence in depth against the DB's dev-seed data
// (back-dated fixtures/predictions from a season before the live tournament)
// ever rendering as the genuine public record if a cutover step is missed —
// see docs/SEEDING.md and jobs/config.py's LIVE_SEASON, which this mirrors.
const parsedMinSeason = Number.parseInt(process.env.NEXT_PUBLIC_MIN_SEASON ?? '', 10);
export const MIN_SEASON =
  Number.isFinite(parsedMinSeason) && parsedMinSeason > 0 ? parsedMinSeason : 2026;
