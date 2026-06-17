// TypeScript types mirroring the Supabase Postgres schema (ARCHITECTURE.md §7).
//
// The Python scheduled jobs are the ONLY writers; the web app reads these
// shapes (§5, §6). Keep this file in sync with the SQL migration. Generated
// database types can also be produced via the Supabase MCP / CLI, but these
// hand-written types are the canonical contract the UI codes against.

export type FixtureStatus = 'scheduled' | 'live' | 'finished' | 'postponed';

export type PredictionStatus =
  | 'published'
  | 'locked'
  | 'scored'
  | 'unlocked_void';

export type PredictionSource = 'api-football' | 'inhouse-elo';

export type MatchResult = 'home' | 'draw' | 'away';

// Monetisation-ready gating field (ARCHITECTURE.md §4, §7). 'free' at launch;
// premium is built-ready but OFF in v1.
export type PredictionTier = 'free' | 'premium';

export interface League {
  id: number;
  api_league_id: number;
  name: string;
  slug: string;
  country: string;
  season: number;
}

export interface Team {
  id: number;
  api_team_id: number;
  /** Plain text only — no crests/badges (ARCHITECTURE.md §13). */
  name: string;
  slug: string;
  league_id: number;
}

export interface Fixture {
  id: number;
  api_fixture_id: number;
  league_id: number;
  home_team_id: number;
  away_team_id: number;
  /** ISO 8601 timestamptz in UTC. */
  kickoff_utc: string;
  status: FixtureStatus;
  final_home_goals: number | null;
  final_away_goals: number | null;
  created_at: string;
  updated_at: string;
}

// The prediction ledger — this is the product (ARCHITECTURE.md §7, §10).
// A row is locked at kickoff and immutable thereafter; only the scoring fields
// are written post full-time by the Python scoring job.
export interface Prediction {
  /** uuid. */
  id: string;
  fixture_id: number;
  /** e.g. 'api-football-v1', 'elo-v1'. */
  model_version: string;
  source: PredictionSource;
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  predicted_home_goals: number;
  predicted_away_goals: number;
  published_at: string;
  /** = kickoff; the row is immutable once locked_at <= now(). */
  locked_at: string;
  status: PredictionStatus;
  tier: PredictionTier;

  // --- scoring fields (written post full-time; nullable until scored) ---
  final_home_goals: number | null;
  final_away_goals: number | null;
  result: MatchResult | null;
  brier_score: number | null;
  log_loss: number | null;
  scored_at: string | null;

  created_at: string;
}

// Convenience composite shapes the UI assembles from joins.
export interface FixtureWithTeams extends Fixture {
  home_team: Team;
  away_team: Team;
  league: League;
}

export interface MatchView extends FixtureWithTeams {
  /** The primary displayed prediction (third-party, labelled — §9), if any. */
  prediction: Prediction | null;
}
