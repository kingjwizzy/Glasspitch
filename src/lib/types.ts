// TypeScript types mirroring the Supabase Postgres schema (ARCHITECTURE.md §7).
//
// The Python scheduled jobs are the ONLY writers; the web app reads these
// shapes (§5, §6). Keep this file in sync with the SQL migration. Generated
// database types can also be produced via the Supabase MCP / CLI, but these
// hand-written types are the canonical contract the UI codes against.

export type FixtureStatus = 'scheduled' | 'live' | 'finished' | 'postponed';

// `void_cancelled` (v2, 2026-07-03): a fixture-level cancellation/abandonment
// discovered post-lock (distinct from `unlocked_void`, which is a prediction
// that missed the kickoff lock). Both are non-displayable, excluded-from-the-
// record statuses — every exclusion filter that already excludes
// `unlocked_void` must also exclude `void_cancelled` (see homepage.ts,
// fixtures.ts, match.ts; `ledger.ts`'s `.eq('status','scored')` already
// structurally excludes both). Requires the corresponding `predictions.status`
// CHECK constraint to be widened by a backend-jobs migration before a job can
// ever actually write this value — tracked as a pending coordination item.
export type PredictionStatus =
  | 'published'
  | 'locked'
  | 'scored'
  | 'unlocked_void'
  | 'void_cancelled';

/** Statuses that must never be presented to a visitor as "our call" (§9, §10). */
export const VOID_STATUSES: readonly PredictionStatus[] = [
  'unlocked_void',
  'void_cancelled',
];

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

// ── v2 premium tables (ARCHITECTURE.md §7, 2026-07-03 amendment) ───────────
// Written by the Stripe webhook route (service-role client, the sanctioned
// billing writer — §5) or, for `profiles`, upserted by the user's own
// authenticated client on first sign-in. The web app otherwise only ever
// reads these, same as the football tables (§5 golden rule still holds: no
// visitor request ever calls a third-party API; the football jobs and the
// Stripe webhook are the only two writers, and they can never touch each
// other's tables).

export interface Profile {
  /** = auth.users.id (uuid). */
  id: string;
  created_at: string;
  is_18_plus: boolean;
  marketing_opt_in: boolean;
}

/** Mirrors the Stripe Subscription object's `status` values that matter here. */
export type SubscriptionStatus =
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused';

export interface Subscription {
  id: string;
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: SubscriptionStatus;
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export type PremiumPlan = 'monthly' | 'annual';

export type FixtureInsightKind = 'prediction_detail' | 'post_match_stats';

/** Premium depth content — RLS-gated to active subscribers only; never read
 *  through the anon publishable client (ARCHITECTURE.md §7). */
export interface FixtureInsight {
  fixture_id: number;
  kind: FixtureInsightKind;
  payload: Record<string, unknown>;
  source: string;
  fetched_at: string;
}
