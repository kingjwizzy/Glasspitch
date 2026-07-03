import 'server-only';

// Golden Boot (top scorers) read layer (ARCHITECTURE.md §5, §7, §8, §11;
// DESIGN.md §4 home item 5 — previously unbuilt).
//
// Reads `top_scorers`, a table the backend-jobs lane populates on the same
// cadence as fixtures/predictions; anon-readable like every other football
// table (§5 golden rule — read-only, publishable key, never a football-API
// call on the request path). The table is expected to be EMPTY until that
// job first runs, so every read degrades to [] rather than throwing: this is
// a decorative, secondary surface (unlike the ledger/homepage), so a failed
// or empty read simply hides the home-page section or shows the full page's
// honest empty state — it never blocks or fails the page (§5 failure
// handling).
//
// Season-guarded like every other read that surfaces "the record" (§5):
// rather than embedding `leagues` (which would require guessing the
// top_scorers→leagues FK constraint name the backend-jobs lane assigns — see
// database.types.ts's file header note), this resolves the current-season
// league ids first and filters on `league_id IN (...)`. That keeps the query
// correct even if the eventual FK constraint name differs from our guess.

import { getSupabaseClient } from '@/lib/supabaseClient';
import { MIN_SEASON } from '@/lib/constants';
import { withTimeout } from './shared';

export interface TopScorerView {
  rank: number;
  playerName: string;
  teamName: string;
  nationality: string;
  goals: number;
  assists: number;
  penalties: number;
}

interface RawTopScorerRow {
  rank: number;
  player_name: string;
  team_name: string;
  nationality: string;
  goals: number;
  assists: number;
  penalties: number;
}

function mapRow(r: RawTopScorerRow): TopScorerView {
  return {
    rank: r.rank,
    playerName: r.player_name,
    teamName: r.team_name,
    nationality: r.nationality,
    goals: r.goals,
    assists: r.assists,
    penalties: r.penalties,
  };
}

async function load(limit: number): Promise<TopScorerView[]> {
  try {
    const sb = getSupabaseClient();

    // Step 1: current-season league ids (§5 season guard). Bounded — the
    // number of tracked leagues is small even at club-football scale.
    const { data: leagueRows, error: leagueErr } = await sb
      .from('leagues')
      .select('id')
      .gte('season', MIN_SEASON)
      .limit(1000);
    if (leagueErr) return [];
    const leagueIds = (leagueRows ?? []).map((l) => l.id);
    if (leagueIds.length === 0) return [];

    // Step 2: top scorers for those leagues, ranked. Bounded by `limit` (the
    // caller passes 5 or 15 — never an unbounded select).
    const { data, error } = await sb
      .from('top_scorers')
      .select('rank, player_name, team_name, nationality, goals, assists, penalties')
      .in('league_id', leagueIds)
      .order('rank', { ascending: true })
      .limit(limit);
    if (error) return [];
    return ((data ?? []) as RawTopScorerRow[]).map(mapRow);
  } catch {
    return [];
  }
}

/** Top 5 — the home page's Golden Boot race strip (DESIGN.md §4 item 5). */
export async function getGoldenBootTop5(): Promise<TopScorerView[]> {
  return withTimeout(load(5), 5000, []);
}

/** Top 15 — the full /stats/golden-boot page. */
export async function getGoldenBootTop15(): Promise<TopScorerView[]> {
  return withTimeout(load(15), 6000, []);
}
