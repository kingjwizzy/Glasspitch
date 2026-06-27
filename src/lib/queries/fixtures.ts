import 'server-only';

// Shared fixture-row read primitives used by both the team and league pages
// (ARCHITECTURE.md §5, §7, §8, §11). Separating them here avoids duplication and
// keeps team.ts / league.ts focused on their own entity loading.
//
// The website only ever READS, with the publishable key under read-only RLS, and
// never calls the football API on the request path (§5 golden rule). Only the
// third-party `api-football` source is surfaced (§9); the in-house `inhouse-elo`
// is logged but NEVER shown. Voided predictions (unlocked_void) are excluded for
// integrity (§10).

import type { FixtureStatus, MatchResult, PredictionStatus } from '@/lib/types';
import { favoured } from '@/lib/format';
import { DISPLAY_SOURCE, one } from './shared';

/** One fixture row as presented on team / league pages. */
export interface FixtureRowView {
  id: number;
  kickoff_utc: string;
  status: FixtureStatus;
  league: string;
  leagueSlug: string;
  home: string;
  away: string;
  homeSlug: string;
  awaySlug: string;
  final_home_goals: number | null;
  final_away_goals: number | null;
  /** The third-party displayed prediction, or null when none exists or it was
   *  voided (unlocked_void). `brier_score` is present once `status='scored'`. */
  prediction: {
    prob_home: number;
    prob_draw: number;
    prob_away: number;
    predicted_home_goals: number;
    predicted_away_goals: number;
    status: PredictionStatus;
    /** = kickoff; the row is immutable once locked_at <= now() (§7). */
    locked_at: string;
    brier_score: number | null;
  } | null;
  /** Actual outcome derived from the fixture's own final scores when the fixture
   *  is finished and both goal columns are non-null, otherwise null. */
  actualResult: MatchResult | null;
  /** The outcome the model favoured (argmax of probs), or null when no
   *  displayed prediction exists. */
  pick: MatchResult | null;
  /** true/false once the fixture finishes and we have a pick; null otherwise. */
  hit: boolean | null;
}

// fixtures has TWO FKs into teams, so the embeds MUST be disambiguated by
// constraint name or PostgREST errors. predictions is embedded un-filtered (a
// fixture has at most two rows: api-football + elo-v1) and the displayed one is
// picked in JS — avoids the embedded-filter / inner-join footguns (§9).
export const FIXTURE_ROW_SELECT = `
  id, kickoff_utc, status, final_home_goals, final_away_goals,
  home_team:teams!fixtures_home_team_id_fkey(name, slug),
  away_team:teams!fixtures_away_team_id_fkey(name, slug),
  league:leagues!fixtures_league_id_fkey(name, slug),
  predictions(prob_home, prob_draw, prob_away, predicted_home_goals, predicted_away_goals,
    status, source, locked_at, result, brier_score)
`;

// ── raw row shapes (PostgREST returns to-one embeds as objects at runtime; the
// generated types sometimes widen them to arrays, so normalise with one()). ──

interface RawTeam {
  name: string;
  slug: string;
}
interface RawLeague {
  name: string;
  slug: string;
}
interface RawRowPrediction {
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  predicted_home_goals: number;
  predicted_away_goals: number;
  status: string;
  source: string;
  locked_at: string;
  result: string | null;
  brier_score: number | null;
}

/** Exported so that team.ts / league.ts can type the PostgREST cast safely. */
export interface RawFixtureRow {
  id: number;
  kickoff_utc: string;
  status: string;
  final_home_goals: number | null;
  final_away_goals: number | null;
  home_team: RawTeam | RawTeam[] | null;
  away_team: RawTeam | RawTeam[] | null;
  league: RawLeague | RawLeague[] | null;
  predictions: RawRowPrediction[] | null;
}

/** Map one raw PostgREST row to a typed FixtureRowView. */
export function mapFixtureRow(raw: RawFixtureRow): FixtureRowView {
  const home = one(raw.home_team);
  const away = one(raw.away_team);
  const league = one(raw.league);

  // Exclude unlocked_void (integrity — §10) and the hidden in-house Elo (§9).
  const rawPred =
    (raw.predictions ?? []).find(
      (p) => p.source === DISPLAY_SOURCE && p.status !== 'unlocked_void',
    ) ?? null;

  const prediction = rawPred
    ? {
        prob_home: rawPred.prob_home,
        prob_draw: rawPred.prob_draw,
        prob_away: rawPred.prob_away,
        predicted_home_goals: rawPred.predicted_home_goals,
        predicted_away_goals: rawPred.predicted_away_goals,
        status: rawPred.status as PredictionStatus,
        locked_at: rawPred.locked_at,
        brier_score: rawPred.brier_score,
      }
    : null;

  // Actual result is derived from the fixture's own final scores — the scoring
  // job writes `result` to the prediction row, but we re-derive it from the
  // source of truth (the fixture's goals) to stay consistent (§7, §10).
  const isFinished = raw.status === 'finished';
  const hg = raw.final_home_goals;
  const ag = raw.final_away_goals;
  const actualResult: MatchResult | null =
    isFinished && hg !== null && ag !== null
      ? hg > ag
        ? 'home'
        : ag > hg
          ? 'away'
          : 'draw'
      : null;

  const pick: MatchResult | null = prediction
    ? favoured({
        home: prediction.prob_home,
        draw: prediction.prob_draw,
        away: prediction.prob_away,
      }).key
    : null;

  // The ✓/✗ verdict is shown ONLY for a `scored` prediction that has a recorded
  // result — the same criterion the ledger uses (§10). This keeps a row's badge
  // from ever disagreeing with the headline record, and stops a finished-but-not-
  // yet-scored fixture (status flipped before the score job copies the goals)
  // from being falsely branded a miss.
  const hit: boolean | null =
    prediction !== null &&
    prediction.status === 'scored' &&
    actualResult !== null &&
    pick !== null
      ? pick === actualResult
      : null;

  return {
    id: raw.id,
    kickoff_utc: raw.kickoff_utc,
    status: raw.status as FixtureStatus,
    league: league?.name ?? '',
    leagueSlug: league?.slug ?? '',
    home: home?.name ?? 'Home',
    away: away?.name ?? 'Away',
    homeSlug: home?.slug ?? '',
    awaySlug: away?.slug ?? '',
    final_home_goals: raw.final_home_goals,
    final_away_goals: raw.final_away_goals,
    prediction,
    actualResult,
    pick,
    hit,
  };
}

/**
 * Partition a list of FixtureRowViews into upcoming and recent.
 *
 * A fixture is a "recent result" only once it is `finished` — sorted DESC by
 * kickoff (most-recent first). Everything else (scheduled, live, postponed, or a
 * scheduled fixture whose kickoff has passed but whose lock/score job has not run
 * yet) is "upcoming" — sorted ASC by kickoff — and renders with its pre-match
 * call. Splitting on status (not a kickoff-vs-now comparison) means a live or
 * unplayed match is never shown under "Recent results" as a result with no score,
 * and avoids any fragile timestamp-format/timezone comparison.
 */
export function partitionFixtures(rows: FixtureRowView[]): {
  upcoming: FixtureRowView[];
  recent: FixtureRowView[];
} {
  const upcoming: FixtureRowView[] = [];
  const recent: FixtureRowView[] = [];

  for (const r of rows) {
    if (r.status === 'finished') recent.push(r);
    else upcoming.push(r);
  }

  upcoming.sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
  recent.sort((a, b) => b.kickoff_utc.localeCompare(a.kickoff_utc));

  return { upcoming, recent };
}

/** Headline "our record over scored calls" aggregate. Every mean rests on the
 *  SAME set the counts describe (§10), so the displayed mean Brier can never
 *  claim a different sample than the call count beside it. */
export interface ScoredRecord {
  scored: number;
  hits: number;
  meanBrier: number | null;
}

/**
 * The single source of truth for the team/league "record" band, shared by both
 * read layers AND their previews so all four can never drift from the ledger's
 * scored-record rule (§10). A row counts only when its displayed prediction is
 * `scored` with a resolved hit and a Brier score — exactly the rows the ledger
 * scores — so `scored`, `hits` and `meanBrier` are computed over one identical
 * set. Returns null when there are no scored calls, so the page can omit the band.
 */
export function buildScoredRecord(rows: FixtureRowView[]): ScoredRecord | null {
  const scoredRows = rows.filter(
    (r) =>
      r.hit !== null &&
      r.prediction !== null &&
      r.prediction.status === 'scored' &&
      r.prediction.brier_score !== null,
  );
  if (scoredRows.length === 0) return null;

  const hits = scoredRows.filter((r) => r.hit === true).length;
  const meanBrier =
    scoredRows.reduce((s, r) => s + (r.prediction!.brier_score as number), 0) /
    scoredRows.length;

  return { scored: scoredRows.length, hits, meanBrier };
}
