import 'server-only';

// Ledger (track-record) read layer (ARCHITECTURE.md §5, §10, §11).
//
// The ledger is the product's transparency moat: every locked-then-scored
// prediction, wins AND losses, with the proper scores (mean Brier + mean log
// loss) and a calibration table. Like every web read it goes through the
// publishable key under read-only RLS and NEVER calls the football API on the
// request path (§5 golden rule); the two layers meet only at the database.
//
// Only rows that are `status = 'scored'` AND `source = 'api-football'` count:
// `unlocked_void` and `void_cancelled` are excluded for integrity (§10) by the
// very fact that neither is ever `scored`, and the in-house `inhouse-elo`
// model is logged but NEVER displayed (§9). The per-row `brier_score` / `log_loss`
// are read straight from the columns the scoring job persisted — the website does
// not recompute them; it only means them and buckets the probabilities.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { MIN_SEASON } from '@/lib/constants';
import type { Database } from '@/lib/database.types';
import type { MatchResult } from '@/lib/types';
import { predictedPick } from '@/lib/format';
import { DISPLAY_SOURCE, one, paginate, previewAllowed, withTimeoutOrThrow } from './shared';
import { previewLedgerRows } from './ledger.preview';

export { DISPLAY_SOURCE };

/** Number of fixed-width probability buckets for the reliability table. Ten
 *  deciles (0–10%, 10–20%, …) per the §10 example; fixed bins so empty bands
 *  stay visibly empty rather than being hidden — that honesty is on-brand. */
export const BUCKET_COUNT = 10;

/** One scored call in the public record (a ledger row). */
export interface LedgerRowView {
  /** prediction id (the ledger row, a uuid). */
  id: string;
  fixtureId: number;
  league: string;
  /** League slug — used by the v2 premium ledger's league filter (§4). */
  leagueSlug: string;
  home: string;
  away: string;
  kickoffUtc: string;
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  predicted_home_goals: number;
  predicted_away_goals: number;
  final_home_goals: number | null;
  final_away_goals: number | null;
  result: MatchResult | null;
  brier_score: number | null;
  log_loss: number | null;
  /** The outcome we leaned towards (argmax of the probabilities). */
  pick: MatchResult;
  /** Whether that pick matched the actual result (the ✓/✗). */
  hit: boolean;
}

/** Headline record over the scored set. Every mean is `null` until there is at
 *  least one scored prediction, so the page can say so plainly (§10). */
export interface LedgerSummary {
  count: number;
  meanBrier: number | null;
  meanLogLoss: number | null;
  hits: number;
  misses: number;
  hitRate: number | null;
}

/** One reliability-table band: a fixed predicted-probability range, how many
 *  probabilities fell in it, the mean we predicted, and how often it happened.
 *  `predictedAvg` / `observedRate` are `null` for an empty band — never NaN. */
export interface CalibrationBin {
  /** e.g. "10–20%". */
  label: string;
  /** Inclusive lower bound in [0, 1]. */
  lo: number;
  /** Exclusive upper bound in [0, 1] (inclusive for the last band). */
  hi: number;
  /** Count of (probability, outcome) points in this band. */
  n: number;
  /** Points in this band whose outcome actually happened. */
  hits: number;
  /** Mean predicted probability across the band, or null when empty. */
  predictedAvg: number | null;
  /** Observed frequency (hits / n), or null when empty. */
  observedRate: number | null;
}

export interface LedgerData {
  summary: LedgerSummary;
  rows: LedgerRowView[];
  calibration: CalibrationBin[];
}

const EMPTY: LedgerData = {
  summary: {
    count: 0,
    meanBrier: null,
    meanLogLoss: null,
    hits: 0,
    misses: 0,
    hitRate: null,
  },
  rows: [],
  calibration: [],
};

// ── raw row shapes (PostgREST returns to-one embeds as objects at runtime; the
// generated types sometimes widen them to arrays, so normalise with one()). ──

interface RawTeam {
  name: string;
}
interface RawLeague {
  name: string;
  slug: string;
  season: number;
}
interface RawLedgerFixture {
  id: number;
  kickoff_utc: string;
  home_team: RawTeam | RawTeam[] | null;
  away_team: RawTeam | RawTeam[] | null;
  league: RawLeague | RawLeague[] | null;
}
interface RawLedgerRow {
  id: string;
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  predicted_home_goals: number;
  predicted_away_goals: number;
  final_home_goals: number | null;
  final_away_goals: number | null;
  result: string | null;
  brier_score: number | null;
  log_loss: number | null;
  fixture: RawLedgerFixture | RawLedgerFixture[] | null;
}

// fixtures has TWO FKs into teams, so the embeds MUST be disambiguated by
// constraint name or PostgREST errors (same pattern as homepage.ts / match.ts).
// `!inner` on fixture AND league (rather than the default to-one left join) is
// required so `.gte('fixture.league.season', MIN_SEASON)` below actually
// EXCLUDES rows instead of merely nulling the embed (§5 season guard — defence
// in depth against pre-live-season dev-seed data ever rendering as the record).
const SCORED_SELECT = `
  id, prob_home, prob_draw, prob_away,
  predicted_home_goals, predicted_away_goals,
  final_home_goals, final_away_goals,
  result, brier_score, log_loss,
  fixture:fixtures!predictions_fixture_id_fkey!inner(
    id,
    kickoff_utc,
    home_team:teams!fixtures_home_team_id_fkey(name),
    away_team:teams!fixtures_away_team_id_fkey(name),
    league:leagues!fixtures_league_id_fkey!inner(name, slug, season)
  )
`;

function mapRow(r: RawLedgerRow): LedgerRowView {
  const fx = one(r.fixture);
  const home = one(fx?.home_team);
  const away = one(fx?.away_team);
  const league = one(fx?.league);
  const probs = { home: r.prob_home, draw: r.prob_draw, away: r.prob_away };
  const pick = predictedPick(probs);
  const result = (r.result as MatchResult | null) ?? null;
  return {
    id: r.id,
    fixtureId: fx?.id ?? 0,
    league: league?.name ?? '',
    leagueSlug: league?.slug ?? '',
    home: home?.name ?? 'Home',
    away: away?.name ?? 'Away',
    kickoffUtc: fx?.kickoff_utc ?? '',
    prob_home: r.prob_home,
    prob_draw: r.prob_draw,
    prob_away: r.prob_away,
    predicted_home_goals: r.predicted_home_goals,
    predicted_away_goals: r.predicted_away_goals,
    final_home_goals: r.final_home_goals,
    final_away_goals: r.final_away_goals,
    result,
    brier_score: r.brier_score,
    log_loss: r.log_loss,
    pick,
    hit: result !== null && pick === result,
  };
}

function mean(values: number[]): number | null {
  // Guard the empty set BEFORE dividing (jobs/scoring.py raises on empty; here we
  // degrade to null so the page can show "no record yet" rather than NaN — §10).
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

function buildSummary(rows: LedgerRowView[]): LedgerSummary {
  // count is the size of the set we actually averaged, so the headline mean and
  // the sample size it claims can never diverge (the homepage.ts invariant). load()
  // requires brier_score, log_loss AND result non-null, so briers.length ===
  // logLosses.length === count and both means rest on the same sample.
  const count = rows.length;
  const briers = rows
    .map((r) => r.brier_score)
    .filter((b): b is number => typeof b === 'number');
  const logLosses = rows
    .map((r) => r.log_loss)
    .filter((l): l is number => typeof l === 'number');
  const hits = rows.filter((r) => r.hit).length;
  return {
    count,
    meanBrier: mean(briers),
    meanLogLoss: mean(logLosses),
    hits,
    misses: count - hits,
    hitRate: count > 0 ? hits / count : null,
  };
}

/**
 * One-vs-rest calibration over fixed deciles (§10). Each scored match emits THREE
 * (probability, did-it-happen) points — `(p_home, result==='home')` and so on —
 * so N matches give 3N points. That is the only way a single tournament's sample
 * populates a reliability table at all; per-favourite-only would cluster ~64
 * points in one narrow band. Binning is total — every point lands in exactly one
 * band — so there is never an unbinned point and never a NaN.
 */
function buildCalibration(rows: LedgerRowView[]): CalibrationBin[] {
  const n = new Array<number>(BUCKET_COUNT).fill(0);
  const hits = new Array<number>(BUCKET_COUNT).fill(0);
  const sumP = new Array<number>(BUCKET_COUNT).fill(0);

  for (const r of rows) {
    if (r.result === null) continue;
    const points: Array<[number, boolean]> = [
      [r.prob_home, r.result === 'home'],
      [r.prob_draw, r.result === 'draw'],
      [r.prob_away, r.result === 'away'],
    ];
    for (const [p, happened] of points) {
      // min(floor(p*10), 9) so p = 1.0 lands in the last band; max(…, 0) guards
      // against any stray sub-zero probability.
      const idx = Math.min(
        Math.max(Math.floor(p * BUCKET_COUNT), 0),
        BUCKET_COUNT - 1,
      );
      n[idx] += 1;
      sumP[idx] += p;
      if (happened) hits[idx] += 1;
    }
  }

  return Array.from({ length: BUCKET_COUNT }, (_, i) => {
    const lo = i / BUCKET_COUNT;
    const hi = (i + 1) / BUCKET_COUNT;
    const count = n[i];
    return {
      label: `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`,
      lo,
      hi,
      n: count,
      hits: hits[i],
      predictedAvg: count > 0 ? sumP[i] / count : null,
      observedRate: count > 0 ? hits[i] / count : null,
    };
  });
}

/** Assemble the full page payload from a set of scored rows — the single compute
 *  path shared by the live read and the preview, so they can never diverge. */
function assemble(rows: LedgerRowView[]): LedgerData {
  return {
    summary: buildSummary(rows),
    rows,
    calibration: buildCalibration(rows),
  };
}

async function load(): Promise<LedgerData> {
  const sb = getSupabaseClient();

  // The all-time scored record. Hard-filtered to the displayed third-party model,
  // scored status (so elo-v1 and unlocked_void can never surface) AND the live
  // season floor (so pre-cutover dev-seed data can never render as the record —
  // §5 season guard), ordered newest-first, and bounded: the mean, the count and
  // the row list all come from the SAME set (an unbounded select is silently
  // row-capped by PostgREST, which would diverge the mean from the count it
  // claims). The limit is far above WC scale; a SQL aggregate RPC is the scale
  // path once the ledger outgrows it.
  //
  // Both per-row scores AND the result are required non-null, so every displayed
  // figure — mean Brier, mean log loss, the hit/miss split and the 3-per-match
  // calibration points — is computed over the SAME guaranteed set; the count can
  // never diverge from a mean it claims. The scoring job writes all three together,
  // so this filter excludes nothing today — it makes the invariant structural
  // rather than dependent on that job's behaviour.
  const res = await sb
    .from('predictions')
    .select(SCORED_SELECT)
    .eq('source', DISPLAY_SOURCE)
    .eq('status', 'scored')
    .not('brier_score', 'is', null)
    .not('log_loss', 'is', null)
    .not('result', 'is', null)
    .gte('fixture.league.season', MIN_SEASON)
    .order('scored_at', { ascending: false })
    .limit(5000);

  // supabase-js RESOLVES errors rather than throwing them — an unchecked
  // `res.error` is the primary failure route (a bad query, an expired key, RLS
  // misconfiguration, a network blip all land here, not in a catch block).
  // Throwing lets a failed ISR background revalidation keep serving the last
  // good cached page and retry next revalidation, instead of silently
  // replacing the trust engine with a false "no scored predictions yet" — the
  // one state this page must never show unless it is genuinely true.
  if (res.error) {
    throw new Error(`ledger read failed: ${res.error.message}`);
  }

  const rows = ((res.data as RawLedgerRow[] | null) ?? []).map(mapRow);
  return assemble(rows); // genuinely zero rows → EMPTY-shaped summary, honestly
}

/**
 * The single read the ledger page makes. Server-only.
 *
 * `PREVIEW_LEDGER` is a dev/preview escape hatch (NOT a NEXT_PUBLIC var, so it is
 * server-only, never reaches the client bundle, and requires the separate
 * `ALLOW_PREVIEW=1` flag — see `previewAllowed()` — so it can never activate on a
 * real deploy): `'empty'` renders the honest no-record state and `'1'` or
 * `'default'` render illustrative in-memory rows, so the page can be built and
 * screenshotted with no seeded database. It writes NOTHING — the empty state is a
 * READ-TIME toggle only, never produced by deleting, voiding or writing to the DB.
 *
 * A genuine DB failure THROWS (see `load()`) rather than being swallowed to
 * EMPTY — the caller (the page, ISR) is responsible for that behaviour.
 */
export async function getLedgerData(): Promise<LedgerData> {
  if (previewAllowed()) {
    const preview = process.env.PREVIEW_LEDGER;
    if (preview === 'empty') return EMPTY;
    if (preview === '1' || preview === 'default') return assemble(previewLedgerRows());
  }

  return withTimeoutOrThrow(load(), 6000);
}

// ── v2 premium: filtered + fully-paginated ledger reads ─────────────────────
// Used by /premium/ledger (league/result filters) and the CSV export route
// (ARCHITECTURE.md §4). This is NOT a premium DB gate — the underlying rows
// are the same free-forever ledger every visitor can already read on /ledger
// (§4 locked decision); what's premium is the filter UI and the bulk CSV
// export convenience, gated in the calling route via getViewer(), not RLS.
// Unlike getLedgerData()'s single bounded (limit 5000) select, this pages
// through EVERY scored row via `paginate()` so a genuinely complete CSV export
// can never silently truncate as the ledger grows past that bound.

export interface LedgerFilters {
  /** League slug, or omitted/undefined for every league. */
  league?: string;
  /** Match result, or omitted/undefined for every result. */
  result?: MatchResult;
}

export async function getFullLedgerRows(
  supabase: SupabaseClient<Database>,
  filters: LedgerFilters = {},
): Promise<LedgerRowView[]> {
  const rows = await paginate<RawLedgerRow>(async (from, to) => {
    let query = supabase
      .from('predictions')
      .select(SCORED_SELECT)
      .eq('source', DISPLAY_SOURCE)
      .eq('status', 'scored')
      .not('brier_score', 'is', null)
      .not('log_loss', 'is', null)
      .not('result', 'is', null)
      .gte('fixture.league.season', MIN_SEASON)
      .order('scored_at', { ascending: false })
      .range(from, to);

    if (filters.result) query = query.eq('result', filters.result);
    if (filters.league) query = query.eq('fixture.league.slug', filters.league);

    const { data, error } = await query;
    if (error) {
      console.error('getFullLedgerRows: read failed', error.message);
      return null;
    }
    return data as unknown as RawLedgerRow[];
  });

  return rows.map(mapRow);
}
