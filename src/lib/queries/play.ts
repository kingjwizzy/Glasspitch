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
import type { MatchResult, PredictionStatus } from '@/lib/types';
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

// ── settled picks (the reveal) ──────────────────────────────────────────────

export interface SettledPickModel {
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  brier_score: number | null;
}

export interface SettledPick {
  /** user_predictions.id (uuid) — the localStorage "seen" key. */
  id: string;
  fixture_id: number;
  kickoff_utc: string;
  status: string;
  home: string;
  away: string;
  final_home_goals: number;
  final_away_goals: number;
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  result: MatchResult;
  brier_score: number;
  scored_at: string;
  /** The model's call for the SAME fixture — the SAME displayed source +
   *  void-status exclusion the pool leaderboard's `beatModel` flag uses
   *  (play/pools/[id]/page.tsx), so "beat the model" means one consistent
   *  thing everywhere on the site. Null when the model has no scored call for
   *  this fixture (not published yet, or a void prediction). */
  model: SettledPickModel | null;
}

interface RawSettledPickFixture {
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

interface RawSettledPick {
  id: string;
  fixture_id: number;
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  result: string | null;
  brier_score: number | null;
  scored_at: string | null;
  fixture: RawSettledPickFixture | RawSettledPickFixture[] | null;
}

function isMatchResult(v: string | null): v is MatchResult {
  return v === 'home' || v === 'draw' || v === 'away';
}

/**
 * The signed-in visitor's OWN settled "Beat the Model" picks — fixture
 * finished, this pick scored (`scored_at` non-null) — newest-scored first.
 * This is what feeds the reveal. No schema change: `result` is the actual
 * outcome text ('home'/'draw'/'away') written by
 * jobs/score_user_predictions.py, which derives it via the exact same
 * jobs/scoring.py `result_from_goals` the model's own ledger uses.
 *
 * The explicit `.eq('user_id', …)` matters for the same reason it does in
 * `getMyPicks`: RLS also surfaces pool-mates' picks once a fixture locks, and
 * this list must only ever contain the viewer's own settled calls.
 *
 * Degrades to [] on any read failure, and silently skips any row missing a
 * final score / result / brier (shouldn't happen — the scoring job writes
 * all three together — but a malformed row must never crash this secondary
 * surface, only the primary ledger read throws). The reveal then shows an
 * honest empty state, never invented data.
 */
export async function getMySettledPicks(
  supabase: Client,
  userId: string,
): Promise<SettledPick[]> {
  const { data, error } = await supabase
    .from('user_predictions')
    .select(
      `id, fixture_id, prob_home, prob_draw, prob_away, result, brier_score, scored_at,
       fixture:fixtures!user_predictions_fixture_id_fkey(
         kickoff_utc, status, final_home_goals, final_away_goals,
         home_team:teams!fixtures_home_team_id_fkey(name),
         away_team:teams!fixtures_away_team_id_fkey(name),
         predictions(source, status, prob_home, prob_draw, prob_away, brier_score)
       )`,
    )
    .eq('user_id', userId)
    .not('scored_at', 'is', null)
    .order('scored_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('getMySettledPicks: read failed', error.message);
    return [];
  }

  const out: SettledPick[] = [];
  for (const raw of (data ?? []) as unknown as RawSettledPick[]) {
    const fixture = one(raw.fixture);
    if (
      !fixture ||
      fixture.final_home_goals === null ||
      fixture.final_away_goals === null ||
      raw.brier_score === null ||
      raw.scored_at === null ||
      !isMatchResult(raw.result)
    ) {
      continue;
    }
    const model =
      (fixture.predictions ?? []).find(
        (p) =>
          p.source === DISPLAY_SOURCE &&
          !VOID_STATUSES.includes(p.status as PredictionStatus),
      ) ?? null;
    out.push({
      id: raw.id,
      fixture_id: raw.fixture_id,
      kickoff_utc: fixture.kickoff_utc,
      status: fixture.status,
      home: one(fixture.home_team)?.name ?? 'Home',
      away: one(fixture.away_team)?.name ?? 'Away',
      final_home_goals: fixture.final_home_goals,
      final_away_goals: fixture.final_away_goals,
      prob_home: raw.prob_home,
      prob_draw: raw.prob_draw,
      prob_away: raw.prob_away,
      result: raw.result,
      brier_score: raw.brier_score,
      scored_at: raw.scored_at,
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
  return out;
}

// ── my record vs the model (RAMBO wave 2 improvement #5) ───────────────────

export interface MyRecordVsModel {
  /** Every one of the visitor's own scored picks — misses count too. */
  scored: number;
  /** Mean Brier over ALL of `scored` (null only when `scored === 0`). */
  meanBrier: number | null;
  /** The subset of `scored` where the model ALSO has a scored call for the
   *  same fixture (apples to apples — the same restriction the pool
   *  leaderboard's "Model, same picks" column uses). */
  comparable: number;
  /** The model's mean Brier over exactly the `comparable` subset (null when
   *  `comparable === 0`). */
  modelMeanBrier: number | null;
  /** `modelMeanBrier - meanBrier` over the comparable subset — positive means
   *  the visitor is ahead of the model (lower Brier is sharper). Null when
   *  there is nothing comparable yet. Deliberately NOT computed from
   *  `meanBrier` (all scored picks) against `modelMeanBrier` (comparable
   *  subset only) — mixing denominators would silently misstate the margin. */
  margin: number | null;
}

/**
 * A pure aggregate over the visitor's OWN settled picks (from
 * `getMySettledPicks`) — no new DB read. This is a PRIVATE, per-user summary
 * for /play ("Your record vs the model"), shown for any signed-in user with
 * scored picks regardless of their public-leaderboard opt-in: opting into
 * /leaderboard controls whether this record is ALSO published under a chosen
 * display name; it has no bearing on whether the visitor can see their own
 * record here.
 */
export function buildMyRecordVsModel(settled: SettledPick[]): MyRecordVsModel {
  const scored = settled.length;
  const meanBrier =
    scored > 0 ? settled.reduce((s, p) => s + p.brier_score, 0) / scored : null;

  const comparablePairs = settled
    .map((p) => p.model?.brier_score ?? null)
    .filter((b): b is number => b !== null);
  const comparable = comparablePairs.length;
  const modelMeanBrier =
    comparable > 0 ? comparablePairs.reduce((s, b) => s + b, 0) / comparable : null;

  // The margin must compare the SAME subset both ways — recompute the
  // visitor's own mean over exactly the comparable picks, not `meanBrier`
  // (which may include picks the model never scored).
  const comparableMine = settled
    .filter((p) => p.model?.brier_score !== null && p.model?.brier_score !== undefined)
    .map((p) => p.brier_score);
  const comparableMeanMine =
    comparableMine.length > 0
      ? comparableMine.reduce((s, b) => s + b, 0) / comparableMine.length
      : null;
  const margin =
    modelMeanBrier !== null && comparableMeanMine !== null
      ? modelMeanBrier - comparableMeanMine
      : null;

  return { scored, meanBrier, comparable, modelMeanBrier, margin };
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
