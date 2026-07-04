import 'server-only';

// Home page read layer (ARCHITECTURE.md §5, §8, §11).
//
// The website only ever READS, from Supabase, with the publishable key under
// read-only RLS — it never calls the football API on the request path (§5
// golden rule). Every prediction surfaced to a visitor is the third-party model
// (`source = 'api-football'`); the in-house `elo-v1` is logged but NEVER shown
// (§9). All reads degrade to empty: a failed/empty query hides a block, it never
// throws and never blocks the page (§5 failure handling).

import { getSupabaseClient } from '@/lib/supabaseClient';
import { MIN_SEASON } from '@/lib/constants';
import type { FixtureStatus, MatchResult, PredictionStatus } from '@/lib/types';
import { VOID_STATUSES } from '@/lib/types';
import { favoured } from '@/lib/format';
import { DISPLAY_SOURCE, one, previewAllowed, withTimeoutOrThrow } from './shared';
import { previewHomepageData } from './homepage.preview';

export { DISPLAY_SOURCE };

export interface PredictionView {
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  predicted_home_goals: number;
  predicted_away_goals: number;
  status: PredictionStatus;
  locked_at: string;
  /** When the call went on the record — the hero's provenance microline. */
  published_at: string;
}

export interface FixtureView {
  id: number;
  kickoff_utc: string;
  status: FixtureStatus;
  league: string;
  home: string;
  away: string;
  homeSlug: string;
  awaySlug: string;
  final_home_goals: number | null;
  final_away_goals: number | null;
  /** Live-match clock columns (RAMBO wave 3 #1) — nullable until the fetch
   *  sweep has touched this fixture since kickoff; render defensively
   *  (`lib/format.ts`'s `liveMinuteLabel()`), never assume they're populated
   *  just because `status === 'live'`. */
  status_short: string | null;
  elapsed_minute: number | null;
  elapsed_extra_minute: number | null;
  /** The displayed third-party prediction, if one exists yet. */
  prediction: PredictionView | null;
}

export interface RecentCallView {
  /** prediction id (the ledger row). */
  id: string;
  fixtureId: number;
  league: string;
  home: string;
  away: string;
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  final_home_goals: number | null;
  final_away_goals: number | null;
  result: MatchResult | null;
  brier_score: number | null;
  /** When the call went on the record — the receipts' provenance microline. */
  published_at: string;
  /** The outcome we'd have picked (argmax of the probabilities). */
  pick: MatchResult;
  /** Whether that pick matched the actual result (the ✓/✗). */
  hit: boolean;
}

/** Headline record aggregates. Every figure is computed over the SAME bounded,
 *  season-floored set of scored rows, so the mean and the sample size it
 *  claims can never diverge (§10). */
export interface RecordView {
  meanBrier: number | null;
  meanLogLoss: number | null;
  count: number;
  /** How many of those scored calls saw the most-likely outcome land. */
  hits: number;
}

export interface HomepageData {
  hero: FixtureView | null;
  /** Every in-play fixture (the hero may be live[0]). */
  live: FixtureView[];
  upcoming: FixtureView[];
  /** Fixtures finished earlier today (UTC) — the "also today" count and the
   *  matchday stream's finished rows. */
  finishedToday: FixtureView[];
  watching: FixtureView[];
  recentCalls: RecentCallView[];
  record: RecordView;
}

const EMPTY: HomepageData = {
  hero: null,
  live: [],
  upcoming: [],
  finishedToday: [],
  watching: [],
  recentCalls: [],
  record: { meanBrier: null, meanLogLoss: null, count: 0, hits: 0 },
};

// ── raw row shapes (PostgREST returns to-one embeds as objects at runtime; the
// generated types sometimes widen them to arrays, so normalise with one()). ──

interface RawTeam {
  name: string;
  slug: string;
}
interface RawLeague {
  name: string;
  season: number;
}
interface RawPrediction {
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  predicted_home_goals: number;
  predicted_away_goals: number;
  status: string;
  locked_at: string;
  published_at: string;
  source: string;
}
interface RawFixture {
  id: number;
  kickoff_utc: string;
  status: string;
  final_home_goals: number | null;
  final_away_goals: number | null;
  status_short: string | null;
  elapsed_minute: number | null;
  elapsed_extra_minute: number | null;
  home_team: RawTeam | RawTeam[] | null;
  away_team: RawTeam | RawTeam[] | null;
  league: RawLeague | RawLeague[] | null;
  predictions: RawPrediction[] | null;
}
interface RawScored {
  id: string;
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  result: string | null;
  brier_score: number | null;
  published_at: string;
  final_home_goals: number | null;
  final_away_goals: number | null;
  fixture: RawScoredFixture | RawScoredFixture[] | null;
}
interface RawScoredFixture {
  id: number;
  home_team: RawTeam | RawTeam[] | null;
  away_team: RawTeam | RawTeam[] | null;
  league: RawLeague | RawLeague[] | null;
}

// fixtures has TWO FKs into teams, so the embeds MUST be disambiguated by
// constraint name or PostgREST errors. predictions is embedded un-filtered (a
// fixture has at most two: api-football + elo-v1) and the displayed one is
// picked in JS — avoids the embedded-filter / inner-join footguns. `!inner` on
// the league embed (rather than the default to-one left join) is required so
// `.gte('league.season', MIN_SEASON)` below actually EXCLUDES rows instead of
// merely nulling the embed (§5 season guard).
const FIXTURE_SELECT = `
  id, kickoff_utc, status, final_home_goals, final_away_goals,
  status_short, elapsed_minute, elapsed_extra_minute,
  home_team:teams!fixtures_home_team_id_fkey(name, slug),
  away_team:teams!fixtures_away_team_id_fkey(name, slug),
  league:leagues!fixtures_league_id_fkey!inner(name, season),
  predictions(prob_home, prob_draw, prob_away, predicted_home_goals, predicted_away_goals, status, locked_at, published_at, source)
`;

const SCORED_SELECT = `
  id, prob_home, prob_draw, prob_away, result, brier_score, published_at, final_home_goals, final_away_goals,
  fixture:fixtures!predictions_fixture_id_fkey!inner(
    id,
    home_team:teams!fixtures_home_team_id_fkey(name),
    away_team:teams!fixtures_away_team_id_fkey(name),
    league:leagues!fixtures_league_id_fkey!inner(name, season)
  )
`;

function mapFixture(r: RawFixture): FixtureView {
  const home = one(r.home_team);
  const away = one(r.away_team);
  const league = one(r.league);
  // Exclude unlocked_void/void_cancelled: a prediction published after kickoff,
  // or one whose fixture was cancelled post-lock, is voided for integrity (§10)
  // and must never be presented to a visitor as our call.
  const pred =
    (r.predictions ?? []).find(
      (p) =>
        p.source === DISPLAY_SOURCE &&
        !VOID_STATUSES.includes(p.status as PredictionStatus),
    ) ?? null;
  return {
    id: r.id,
    kickoff_utc: r.kickoff_utc,
    status: r.status as FixtureStatus,
    league: league?.name ?? '',
    home: home?.name ?? 'Home',
    away: away?.name ?? 'Away',
    homeSlug: home?.slug ?? '',
    awaySlug: away?.slug ?? '',
    final_home_goals: r.final_home_goals,
    final_away_goals: r.final_away_goals,
    status_short: r.status_short,
    elapsed_minute: r.elapsed_minute,
    elapsed_extra_minute: r.elapsed_extra_minute,
    prediction: pred
      ? {
          prob_home: pred.prob_home,
          prob_draw: pred.prob_draw,
          prob_away: pred.prob_away,
          predicted_home_goals: pred.predicted_home_goals,
          predicted_away_goals: pred.predicted_away_goals,
          status: pred.status as PredictionStatus,
          locked_at: pred.locked_at,
          published_at: pred.published_at,
        }
      : null,
  };
}

function mapScored(r: RawScored): RecentCallView {
  const fx = one(r.fixture);
  const home = one(fx?.home_team);
  const away = one(fx?.away_team);
  const league = one(fx?.league);
  const probs = { home: r.prob_home, draw: r.prob_draw, away: r.prob_away };
  const pick = favoured(probs).key;
  const result = (r.result as MatchResult | null) ?? null;
  return {
    id: r.id,
    fixtureId: fx?.id ?? 0,
    league: league?.name ?? '',
    home: home?.name ?? 'Home',
    away: away?.name ?? 'Away',
    prob_home: r.prob_home,
    prob_draw: r.prob_draw,
    prob_away: r.prob_away,
    final_home_goals: r.final_home_goals,
    final_away_goals: r.final_away_goals,
    result,
    brier_score: r.brier_score,
    published_at: r.published_at,
    pick,
    hit: result !== null && pick === result,
  };
}

async function load(): Promise<HomepageData> {
  const sb = getSupabaseClient();
  const now = new Date();
  const nowIso = now.toISOString();
  // Start of the current UTC day — the "finished today" window (the matchday
  // stream's full-time rows and the "also today" counts).
  const startOfTodayIso = `${nowIso.slice(0, 10)}T00:00:00.000Z`;

  const [liveRes, upcomingRes, finishedTodayRes, scoredRes, recordRes] = await Promise.all([
    sb
      .from('fixtures')
      .select(FIXTURE_SELECT)
      .eq('status', 'live')
      .gte('league.season', MIN_SEASON)
      .order('kickoff_utc', { ascending: true })
      .limit(5),
    sb
      .from('fixtures')
      .select(FIXTURE_SELECT)
      .eq('status', 'scheduled')
      .gte('kickoff_utc', nowIso)
      .gte('league.season', MIN_SEASON)
      .order('kickoff_utc', { ascending: true })
      .limit(8),
    sb
      .from('fixtures')
      .select(FIXTURE_SELECT)
      .eq('status', 'finished')
      .gte('kickoff_utc', startOfTodayIso)
      .gte('league.season', MIN_SEASON)
      .order('kickoff_utc', { ascending: true })
      .limit(12),
    sb
      .from('predictions')
      .select(SCORED_SELECT)
      .eq('source', DISPLAY_SOURCE)
      .eq('status', 'scored')
      .gte('fixture.league.season', MIN_SEASON)
      .order('scored_at', { ascending: false })
      .limit(10),
    // No DB aggregate view exists yet (§7) — fetch the scored rows and reduce.
    // Ordered + bounded so every aggregate (mean Brier, mean log loss, hit
    // count) comes from the SAME set: an unbounded select is silently
    // row-capped by PostgREST, which would diverge the means from an exact
    // count. For v1's single tournament this window is the full record;
    // /ledger is the all-time authority and a SQL aggregate RPC is the scale
    // path once the ledger outgrows the window. The fixture/league embed
    // exists ONLY to apply the §5 season guard — its columns are never read.
    sb
      .from('predictions')
      .select(
        'brier_score, log_loss, prob_home, prob_draw, prob_away, result, fixture:fixtures!predictions_fixture_id_fkey!inner(league:leagues!fixtures_league_id_fkey!inner(season))',
      )
      .eq('source', DISPLAY_SOURCE)
      .eq('status', 'scored')
      .not('brier_score', 'is', null)
      .gte('fixture.league.season', MIN_SEASON)
      .order('scored_at', { ascending: false })
      .limit(1000),
  ]);

  // supabase-js RESOLVES errors rather than throwing — an unchecked `res.error`
  // is the primary failure route. Throw so a failed ISR background
  // revalidation keeps serving the last good cached page and retries, instead
  // of silently replacing the homepage's live/record surfaces with a false
  // empty state.
  for (const res of [liveRes, upcomingRes, finishedTodayRes, scoredRes, recordRes]) {
    if (res.error) {
      throw new Error(`homepage read failed: ${res.error.message}`);
    }
  }

  const live = ((liveRes.data as RawFixture[] | null) ?? []).map(mapFixture);
  const upcomingAll = ((upcomingRes.data as RawFixture[] | null) ?? []).map(mapFixture);
  const finishedToday = ((finishedTodayRes.data as RawFixture[] | null) ?? []).map(mapFixture);
  const recentCalls = ((scoredRes.data as RawScored[] | null) ?? []).map(mapScored);

  const hero = live[0] ?? upcomingAll[0] ?? null;
  const upcoming = upcomingAll.filter((f) => f.id !== hero?.id).slice(0, 6);

  // "What we're watching" — the model's tightest upcoming calls (small gap
  // between the top two outcomes), which are the most interesting reads.
  const watching = upcoming
    .filter((f) => f.prediction)
    .map((f) => ({
      f,
      spread:
        Math.max(f.prediction!.prob_home, f.prediction!.prob_draw, f.prediction!.prob_away) -
        [f.prediction!.prob_home, f.prediction!.prob_draw, f.prediction!.prob_away].sort(
          (a, b) => b - a,
        )[1],
    }))
    .sort((a, b) => a.spread - b.spread)
    .slice(0, 3)
    .map((x) => x.f);

  interface RecordRow {
    brier_score: number | null;
    log_loss: number | null;
    prob_home: number;
    prob_draw: number;
    prob_away: number;
    result: string | null;
  }
  // One identical set for every headline figure: scored rows with a Brier
  // score (the query's .not-null filter). Count, hits, mean Brier and mean log
  // loss are all reduced from it, so no figure can claim a different sample.
  const recordRows = ((recordRes.data as unknown as RecordRow[] | null) ?? []).filter(
    (r): r is RecordRow & { brier_score: number } => typeof r.brier_score === 'number',
  );
  const count = recordRows.length;
  const meanBrier =
    count > 0 ? recordRows.reduce((s, r) => s + r.brier_score, 0) / count : null;
  const logLosses = recordRows
    .map((r) => r.log_loss)
    .filter((l): l is number => typeof l === 'number');
  const meanLogLoss =
    logLosses.length > 0
      ? logLosses.reduce((s, l) => s + l, 0) / logLosses.length
      : null;
  // "Most-likely outcome landed X of Y" — argmax pick vs recorded result.
  const hits = recordRows.filter(
    (r) =>
      r.result !== null &&
      favoured({ home: r.prob_home, draw: r.prob_draw, away: r.prob_away }).key ===
        (r.result as MatchResult),
  ).length;

  return {
    hero,
    live,
    upcoming,
    finishedToday,
    watching,
    recentCalls,
    record: { meanBrier, meanLogLoss, count, hits },
  };
}

/**
 * The single read the home page makes. Server-only.
 *
 * `PREVIEW_HOMEPAGE` is a dev/preview escape hatch (NOT a NEXT_PUBLIC var, so it
 * is server-only and never reaches the client bundle, and requires the
 * separate `ALLOW_PREVIEW=1` flag — see `previewAllowed()` — so it can never
 * activate on a real deploy): it returns representative in-memory fixtures so
 * the page can be rendered and screenshotted with no seeded database. It
 * writes nothing.
 *
 * A genuine DB failure THROWS (see `load()`) rather than being swallowed to
 * EMPTY — the caller (the page, ISR) is responsible for that behaviour.
 */
export async function getHomepageData(): Promise<HomepageData> {
  if (previewAllowed()) {
    const preview = process.env.PREVIEW_HOMEPAGE;
    if (preview === '1' || preview === 'default') return previewHomepageData('default');
    if (preview === 'live') return previewHomepageData('live');
    if (preview === 'empty') return EMPTY;
  }

  return withTimeoutOrThrow(load(), 6000);
}
