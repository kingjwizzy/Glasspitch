import 'server-only';

// Read layer for the "Beat the Model" game (/play — ARCHITECTURE.md §5 v3
// game-picks amendment). Every function here takes the CALLER'S per-request,
// cookie-bound Supabase client (lib/supabase/server.ts) — still the
// publishable key, still under RLS. The database is the security boundary:
//   - `pools` / `pool_members` are visible only to owners/members;
//   - `user_predictions` rows are visible only to their owner, plus to
//     pool-mates ONCE the fixture has locked (anti-copying) — the queries
//     below never try to out-clever that; they render whatever RLS returns.
// Writes happen only in src/app/play/actions.ts, through the same
// RLS-scoped client — never the service key, never a proxy route.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { MIN_SEASON } from '@/lib/constants';
import type { PredictionStatus } from '@/lib/types';
import { VOID_STATUSES } from '@/lib/types';
import { DISPLAY_SOURCE, one } from './shared';

type Client = SupabaseClient<Database>;

/** How far ahead /play offers open fixtures (this week's round, roughly). */
const OPEN_WINDOW_DAYS = 8;

// ── open fixtures to pick ────────────────────────────────────────────────────

export interface ModelCall {
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  predicted_home_goals: number;
  predicted_away_goals: number;
}

export interface OpenPickFixture {
  id: number;
  kickoff_utc: string;
  league: string;
  home: string;
  away: string;
  /** The displayed third-party model call — revealed in the UI only AFTER the
   *  visitor commits their own pick (anti-anchoring), or null if none yet. */
  model: ModelCall | null;
}

interface RawOpenFixture {
  id: number;
  kickoff_utc: string;
  status: string;
  home_team: { name: string } | { name: string }[] | null;
  away_team: { name: string } | { name: string }[] | null;
  league: { name: string; season: number } | { name: string; season: number }[] | null;
  predictions:
    | Array<{
        source: string;
        status: string;
        prob_home: number;
        prob_draw: number;
        prob_away: number;
        predicted_home_goals: number;
        predicted_away_goals: number;
      }>
    | null;
}

/**
 * Upcoming fixtures still open for picks: kickoff strictly in the future
 * (mirroring the DB trigger's own `kickoff_utc <= now()` close rule), within
 * the next OPEN_WINDOW_DAYS. Degrades to [] on any error — /play then shows
 * an honest "no open fixtures" state.
 */
export async function getOpenPickFixtures(
  supabase: Client,
  nowIso: string,
): Promise<OpenPickFixture[]> {
  const windowEnd = new Date(
    new Date(nowIso).getTime() + OPEN_WINDOW_DAYS * 24 * 3600 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from('fixtures')
    .select(
      `id, kickoff_utc, status,
       home_team:teams!fixtures_home_team_id_fkey(name),
       away_team:teams!fixtures_away_team_id_fkey(name),
       league:leagues!fixtures_league_id_fkey!inner(name, season),
       predictions(source, status, prob_home, prob_draw, prob_away,
         predicted_home_goals, predicted_away_goals)`,
    )
    .gte('league.season', MIN_SEASON)
    .eq('status', 'scheduled')
    .gt('kickoff_utc', nowIso)
    .lte('kickoff_utc', windowEnd)
    .order('kickoff_utc', { ascending: true })
    .limit(24);

  if (error) {
    console.error('getOpenPickFixtures: read failed', error.message);
    return [];
  }

  return ((data ?? []) as unknown as RawOpenFixture[]).map((raw) => {
    const model =
      (raw.predictions ?? []).find(
        (p) =>
          p.source === DISPLAY_SOURCE &&
          !VOID_STATUSES.includes(p.status as PredictionStatus),
      ) ?? null;
    return {
      id: raw.id,
      kickoff_utc: raw.kickoff_utc,
      league: one(raw.league)?.name ?? '',
      home: one(raw.home_team)?.name ?? 'Home',
      away: one(raw.away_team)?.name ?? 'Away',
      model: model
        ? {
            prob_home: model.prob_home,
            prob_draw: model.prob_draw,
            prob_away: model.prob_away,
            predicted_home_goals: model.predicted_home_goals,
            predicted_away_goals: model.predicted_away_goals,
          }
        : null,
    };
  });
}

// ── my picks ─────────────────────────────────────────────────────────────────

export interface MyPick {
  fixture_id: number;
  prob_home: number;
  prob_draw: number;
  prob_away: number;
}

/** The signed-in user's own picks, keyed by fixture id. The explicit
 *  `.eq('user_id', …)` matters: RLS ALSO returns pool-mates' locked picks, and
 *  this map must only ever contain the viewer's own. */
export async function getMyPicks(
  supabase: Client,
  userId: string,
): Promise<Map<number, MyPick>> {
  const { data, error } = await supabase
    .from('user_predictions')
    .select('fixture_id, prob_home, prob_draw, prob_away')
    .eq('user_id', userId);

  if (error) {
    console.error('getMyPicks: read failed', error.message);
    return new Map();
  }
  return new Map((data ?? []).map((r) => [r.fixture_id, r as MyPick]));
}

// ── pools ────────────────────────────────────────────────────────────────────

export interface PoolSummary {
  id: string;
  name: string;
  invite_code: string;
  isOwner: boolean;
  memberCount: number | null;
}

/** Pools the user owns or belongs to (that is exactly what RLS returns). */
export async function getMyPools(
  supabase: Client,
  userId: string,
): Promise<PoolSummary[]> {
  const { data, error } = await supabase
    .from('pools')
    .select('id, name, invite_code, owner_user_id, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('getMyPools: read failed', error.message);
    return [];
  }
  const pools = data ?? [];
  if (pools.length === 0) return [];

  const counts = new Map<string, number>();
  const { data: members, error: mErr } = await supabase
    .from('pool_members')
    .select('pool_id')
    .in(
      'pool_id',
      pools.map((p) => p.id),
    );
  if (!mErr) {
    for (const m of members ?? []) {
      counts.set(m.pool_id, (counts.get(m.pool_id) ?? 0) + 1);
    }
  }

  return pools.map((p) => ({
    id: p.id,
    name: p.name,
    invite_code: p.invite_code,
    isOwner: p.owner_user_id === userId,
    memberCount: mErr ? null : (counts.get(p.id) ?? 0),
  }));
}

export interface PoolMemberView {
  user_id: string;
  display_name: string;
  joined_at: string;
}

export interface PoolPickView {
  user_id: string;
  fixture_id: number;
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  brier_score: number | null;
  scored_at: string | null;
}

export interface PoolFixtureView {
  id: number;
  kickoff_utc: string;
  status: string;
  home: string;
  away: string;
  final_home_goals: number | null;
  final_away_goals: number | null;
  /** The displayed model's probabilities + Brier for the same fixture, when
   *  scored — the "beat the model" yardstick. */
  model: { prob_home: number; prob_draw: number; prob_away: number; brier_score: number | null } | null;
}

export interface PoolDetail {
  id: string;
  name: string;
  invite_code: string;
  owner_user_id: string;
  created_at: string;
  members: PoolMemberView[];
  /** Every pick RLS lets this viewer see for this pool's members: all their
   *  own rows, plus other members' rows for locked fixtures only. */
  picks: PoolPickView[];
  /** Fixtures referenced by `picks`, keyed by id. */
  fixtures: Map<number, PoolFixtureView>;
}

interface RawPoolFixture {
  id: number;
  kickoff_utc: string;
  status: string;
  final_home_goals: number | null;
  final_away_goals: number | null;
  home_team: { name: string } | { name: string }[] | null;
  away_team: { name: string } | { name: string }[] | null;
  predictions:
    | Array<{
        source: string;
        status: string;
        prob_home: number;
        prob_draw: number;
        prob_away: number;
        brier_score: number | null;
      }>
    | null;
}

/**
 * A pool the viewer can see (owner or member — otherwise RLS returns nothing
 * and this resolves null → 404), with members, visible picks and the fixtures
 * those picks reference.
 */
export async function getPoolDetail(
  supabase: Client,
  poolId: string,
): Promise<PoolDetail | null> {
  const { data: pool, error } = await supabase
    .from('pools')
    .select('id, name, invite_code, owner_user_id, created_at')
    .eq('id', poolId)
    .maybeSingle();

  if (error) {
    console.error('getPoolDetail: pool read failed', error.message);
    return null;
  }
  if (!pool) return null;

  const { data: members, error: mErr } = await supabase
    .from('pool_members')
    .select('user_id, display_name, joined_at')
    .eq('pool_id', poolId)
    .order('joined_at', { ascending: true });
  if (mErr) {
    console.error('getPoolDetail: members read failed', mErr.message);
  }

  const memberIds = (members ?? []).map((m) => m.user_id);
  let picks: PoolPickView[] = [];
  const fixtures = new Map<number, PoolFixtureView>();

  if (memberIds.length > 0) {
    const { data: pickRows, error: pErr } = await supabase
      .from('user_predictions')
      .select('user_id, fixture_id, prob_home, prob_draw, prob_away, brier_score, scored_at')
      .in('user_id', memberIds)
      .limit(2000);
    if (pErr) {
      console.error('getPoolDetail: picks read failed', pErr.message);
    } else {
      picks = (pickRows ?? []) as PoolPickView[];
    }

    const fixtureIds = [...new Set(picks.map((p) => p.fixture_id))];
    if (fixtureIds.length > 0) {
      const { data: fixtureRows, error: fErr } = await supabase
        .from('fixtures')
        .select(
          `id, kickoff_utc, status, final_home_goals, final_away_goals,
           home_team:teams!fixtures_home_team_id_fkey(name),
           away_team:teams!fixtures_away_team_id_fkey(name),
           predictions(source, status, prob_home, prob_draw, prob_away, brier_score)`,
        )
        .in('id', fixtureIds);
      if (fErr) {
        console.error('getPoolDetail: fixtures read failed', fErr.message);
      }
      for (const raw of (fixtureRows ?? []) as unknown as RawPoolFixture[]) {
        const model =
          (raw.predictions ?? []).find(
            (p) =>
              p.source === DISPLAY_SOURCE &&
              !VOID_STATUSES.includes(p.status as PredictionStatus),
          ) ?? null;
        fixtures.set(raw.id, {
          id: raw.id,
          kickoff_utc: raw.kickoff_utc,
          status: raw.status,
          home: one(raw.home_team)?.name ?? 'Home',
          away: one(raw.away_team)?.name ?? 'Away',
          final_home_goals: raw.final_home_goals,
          final_away_goals: raw.final_away_goals,
          model: model
            ? {
                prob_home: model.prob_home,
                prob_draw: model.prob_draw,
                prob_away: model.prob_away,
                brier_score: model.brier_score,
              }
            : null,
        });
      }
    }
  }

  return {
    id: pool.id,
    name: pool.name,
    invite_code: pool.invite_code,
    owner_user_id: pool.owner_user_id,
    created_at: pool.created_at,
    members: (members ?? []) as PoolMemberView[],
    picks,
    fixtures,
  };
}
