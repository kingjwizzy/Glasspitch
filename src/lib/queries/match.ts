import 'server-only';
import { cache } from 'react';

// Match page read layer (ARCHITECTURE.md §5, §7, §8, §11).
//
// Loads ONE fixture by id with its third-party prediction and both teams'
// recent form. Read-only, publishable key, RLS-enforced — it never calls the
// football API on the request path (§5 golden rule) and never writes. Every
// prediction surfaced is the third-party model (`source = 'api-football'`); the
// in-house Elo is logged but NEVER shown (§9). Reads degrade gracefully: a
// missing fixture is a genuine 404, a transient DB failure throws (so ISR retries
// and crawlers are not told the page is gone), and the non-critical form reads
// fall back to empty without ever blocking the page (§5 failure handling).

import { getSupabaseClient } from '@/lib/supabaseClient';
import type { FixtureStatus, MatchResult, PredictionStatus } from '@/lib/types';
import { DISPLAY_SOURCE, one, withTimeout } from './shared';
import { previewMatchData } from './match.preview';

/** The third-party prediction as shown on the match page. */
export interface MatchPrediction {
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  predicted_home_goals: number;
  predicted_away_goals: number;
  status: PredictionStatus;
  /** = kickoff; the row is immutable once locked_at <= now() (§7). */
  locked_at: string;
  // Scoring fields — present once `status === 'scored'` (§10), else null.
  result: MatchResult | null;
  brier_score: number | null;
  log_loss: number | null;
  final_home_goals: number | null;
  final_away_goals: number | null;
}

/** One past result from a single team's perspective (for the form strip). */
export interface FormResult {
  outcome: 'W' | 'D' | 'L';
  /** Goals for / against, from this team's perspective. */
  gf: number;
  ga: number;
  opponent: string;
  /** True if this team played at home in that fixture. */
  home: boolean;
  fixtureId: number;
  kickoff_utc: string;
}

export interface MatchData {
  id: number;
  league: string;
  kickoff_utc: string;
  status: FixtureStatus;
  home: string;
  away: string;
  homeSlug: string;
  awaySlug: string;
  final_home_goals: number | null;
  final_away_goals: number | null;
  /** The third-party prediction, or null when none is published OR it was
   *  voided (a voided prediction is NEVER presented as our call — §9, §10). */
  prediction: MatchPrediction | null;
  /** True when a prediction existed but was voided for integrity (§10) — lets
   *  the page be honest that the call is excluded rather than silently absent. */
  predictionVoided: boolean;
  /** Each team's most recent finished results, oldest → newest. */
  homeForm: FormResult[];
  awayForm: FormResult[];
}

const FORM_LIMIT = 5;

// fixtures has TWO FKs into teams, so the embeds MUST be disambiguated by
// constraint name or PostgREST errors. Predictions are embedded un-filtered (a
// fixture has at most two: api-football + elo-v1) and the displayed one is
// picked in JS, which avoids the embedded-filter / inner-join footguns.
const MATCH_SELECT = `
  id, kickoff_utc, status, final_home_goals, final_away_goals,
  home_team_id, away_team_id,
  home_team:teams!fixtures_home_team_id_fkey(name, slug),
  away_team:teams!fixtures_away_team_id_fkey(name, slug),
  league:leagues!fixtures_league_id_fkey(name),
  predictions(prob_home, prob_draw, prob_away, predicted_home_goals, predicted_away_goals,
    status, source, locked_at, result, brier_score, log_loss, final_home_goals, final_away_goals)
`;

const FORM_SELECT = `
  id, kickoff_utc, home_team_id, away_team_id, final_home_goals, final_away_goals,
  home_team:teams!fixtures_home_team_id_fkey(name),
  away_team:teams!fixtures_away_team_id_fkey(name)
`;

interface RawTeam {
  name: string;
  slug?: string;
}
interface RawPrediction {
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
  log_loss: number | null;
  final_home_goals: number | null;
  final_away_goals: number | null;
}
interface RawMatchFixture {
  id: number;
  kickoff_utc: string;
  status: string;
  final_home_goals: number | null;
  final_away_goals: number | null;
  home_team_id: number;
  away_team_id: number;
  home_team: RawTeam | RawTeam[] | null;
  away_team: RawTeam | RawTeam[] | null;
  league: { name: string } | { name: string }[] | null;
  predictions: RawPrediction[] | null;
}
interface RawFormFixture {
  id: number;
  kickoff_utc: string;
  home_team_id: number;
  away_team_id: number;
  final_home_goals: number | null;
  final_away_goals: number | null;
  home_team: RawTeam | RawTeam[] | null;
  away_team: RawTeam | RawTeam[] | null;
}

// Sentinel distinguishing "the fixture genuinely does not exist" (→ 404) from
// "we could not reach the DB this time" (→ throw, so ISR retries and the URL is
// not deindexed as gone).
type FixtureLoad = RawMatchFixture | 'missing' | 'error';

async function loadFixture(id: number): Promise<FixtureLoad> {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('fixtures')
      .select(MATCH_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) return 'error';
    if (!data) return 'missing';
    return data as unknown as RawMatchFixture;
  } catch {
    return 'error';
  }
}

async function loadForm(teamId: number, beforeIso: string): Promise<FormResult[]> {
  const sb = getSupabaseClient();
  const { data } = await sb
    .from('fixtures')
    .select(FORM_SELECT)
    .eq('status', 'finished')
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .lt('kickoff_utc', beforeIso)
    .order('kickoff_utc', { ascending: false })
    .limit(FORM_LIMIT);

  const rows = (data as unknown as RawFormFixture[] | null) ?? [];
  const results: FormResult[] = [];
  for (const r of rows) {
    if (r.final_home_goals === null || r.final_away_goals === null) continue;
    const isHome = r.home_team_id === teamId;
    const gf = isHome ? r.final_home_goals : r.final_away_goals;
    const ga = isHome ? r.final_away_goals : r.final_home_goals;
    const opponent = (isHome ? one(r.away_team) : one(r.home_team))?.name ?? 'Unknown';
    results.push({
      outcome: gf > ga ? 'W' : gf < ga ? 'L' : 'D',
      gf,
      ga,
      opponent,
      home: isHome,
      fixtureId: r.id,
      kickoff_utc: r.kickoff_utc,
    });
  }
  // Query is newest-first; present oldest → newest so the rightmost chip is the
  // most recent match (the usual reading of a form strip).
  return results.reverse();
}

function mapPrediction(p: RawPrediction): MatchPrediction {
  return {
    prob_home: p.prob_home,
    prob_draw: p.prob_draw,
    prob_away: p.prob_away,
    predicted_home_goals: p.predicted_home_goals,
    predicted_away_goals: p.predicted_away_goals,
    status: p.status as PredictionStatus,
    locked_at: p.locked_at,
    result: (p.result as MatchResult | null) ?? null,
    brier_score: p.brier_score,
    log_loss: p.log_loss,
    final_home_goals: p.final_home_goals,
    final_away_goals: p.final_away_goals,
  };
}

async function load(id: number): Promise<MatchData | null> {
  const fixture = await withTimeout(loadFixture(id), 6000, 'error');
  if (fixture === 'missing') return null; // genuine 404
  if (fixture === 'error') {
    // Transient — surface as a server error so ISR retries; never a false 404.
    throw new Error(`match read failed for fixture ${id}`);
  }

  const home = one(fixture.home_team);
  const away = one(fixture.away_team);
  const league = one(fixture.league);

  // The single displayed model is the third-party one (§9). A voided prediction
  // is never shown as our call — we only note that it was voided (§10).
  const raw = (fixture.predictions ?? []).find((p) => p.source === DISPLAY_SOURCE) ?? null;
  const predictionVoided = raw?.status === 'unlocked_void';
  const prediction = raw && !predictionVoided ? mapPrediction(raw) : null;

  // Form is best-effort context — never let it block or fail the page (§5).
  const [homeForm, awayForm] = await Promise.all([
    withTimeout(loadForm(fixture.home_team_id, fixture.kickoff_utc), 5000, []),
    withTimeout(loadForm(fixture.away_team_id, fixture.kickoff_utc), 5000, []),
  ]);

  return {
    id: fixture.id,
    league: league?.name ?? '',
    kickoff_utc: fixture.kickoff_utc,
    status: fixture.status as FixtureStatus,
    home: home?.name ?? 'Home',
    away: away?.name ?? 'Away',
    homeSlug: home?.slug ?? '',
    awaySlug: away?.slug ?? '',
    final_home_goals: fixture.final_home_goals,
    final_away_goals: fixture.final_away_goals,
    prediction,
    predictionVoided,
    homeForm,
    awayForm,
  };
}

/**
 * Load one match for the page and its metadata. Wrapped in React `cache()` so
 * `generateMetadata` and the page body share a single DB read per request.
 *
 * `PREVIEW_MATCH` is a server-only dev/preview escape hatch (NOT a NEXT_PUBLIC
 * var, never set in production): it returns representative in-memory fixtures so
 * every prediction state (published / locked / scored / voided / none) can be
 * rendered and screenshotted with no seeded database. It writes nothing.
 */
export const getMatchData = cache(
  async (id: number): Promise<MatchData | null> => {
    if (!Number.isInteger(id) || id <= 0) return null;
    if (process.env.PREVIEW_MATCH) return previewMatchData(id);
    return load(id);
  },
);
