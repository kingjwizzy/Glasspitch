import 'server-only';

// Read layer for World Cup Chances (homepage circles + /chances) —
// ROADMAP.md §4 item 7 (owner concept), ARCHITECTURE.md §5 v3. Reads
// `tournament_chances` (anon-readable, written nightly by
// jobs/simulate_chances.py — a DB-only Monte Carlo simulation) through the
// plain publishable-key singleton: these are PUBLIC, cached ISR pages, so
// they must never touch cookies or a session-aware client.
//
// The table ships with migration 0007 and may not exist / may be empty until
// the concurrent backend lands and the sim first runs — every read here
// degrades to the honest empty shape (never throws), so the pages render
// their structural "appears after tonight's first simulation run" state.
//
// Contract (0007, fixed): one row per SURVIVING team per snapshot_date — a
// team eliminated by an already-finished knockout match simply gets no row
// that day. "Eliminated" is therefore DERIVED: present on an earlier
// snapshot inside our window, absent from the latest.

import { getSupabaseClient } from '@/lib/supabaseClient';
import { one, withTimeout } from './shared';

export interface TeamChance {
  teamId: number;
  team: string;
  /** Probability of winning the tournament, 0..1 (CHECK-constrained). */
  pWin: number;
  pFinal: number | null;
  pSemi: number | null;
  /** Day-over-day change in pWin vs the PREVIOUS snapshot date (probability
   *  units); null when the team has no row on the previous snapshot. */
  delta: number | null;
}

export interface GoneTeam {
  teamId: number;
  team: string;
}

export interface ChancesData {
  /** Latest snapshot date ("2026-07-04"), or null before the first sim run. */
  snapshotDate: string | null;
  /** When the latest snapshot was computed (max computed_at of its rows). */
  computedAt: string | null;
  /** Monte Carlo trial count for the latest snapshot ("simulated N times"). */
  sims: number | null;
  /** Surviving teams, sorted by pWin descending (ties: name A→Z). */
  teams: TeamChance[];
  /** Teams eliminated since our window began — seen on an earlier snapshot,
   *  absent from the latest. Sorted A→Z. */
  gone: GoneTeam[];
}

export const EMPTY_CHANCES: ChancesData = {
  snapshotDate: null,
  computedAt: null,
  sims: null,
  teams: [],
  gone: [],
};

interface RawChanceRow {
  snapshot_date: string;
  team_id: number;
  p_win_tournament: number;
  p_reach_final: number | null;
  p_reach_semi: number | null;
  sims: number;
  computed_at: string;
  team: { name: string } | { name: string }[] | null;
}

/** How many days of history to read: enough for the latest snapshot, the
 *  previous one (day-over-day deltas) and a meaningful "eliminated" row,
 *  while keeping the select bounded well under PostgREST's row cap
 *  (48 teams x 14 days = 672 rows max). */
const WINDOW_DAYS = 14;

async function load(): Promise<ChancesData> {
  try {
    const sb = getSupabaseClient();

    const { data: latest, error: latestError } = await sb
      .from('tournament_chances')
      .select('snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    // A missing table (migration 0007 not yet applied) or any other error
    // lands here — the honest structural empty state, never a throw: unlike
    // the ledger, an empty chances block is EXPECTED until the sim exists.
    if (latestError || !latest) return EMPTY_CHANCES;

    const latestDate = latest.snapshot_date;
    const windowStart = new Date(`${latestDate}T00:00:00Z`);
    windowStart.setUTCDate(windowStart.getUTCDate() - WINDOW_DAYS);
    const windowStartDate = windowStart.toISOString().slice(0, 10);

    const { data, error } = await sb
      .from('tournament_chances')
      .select(
        `snapshot_date, team_id, p_win_tournament, p_reach_final, p_reach_semi,
         sims, computed_at,
         team:teams!tournament_chances_team_id_fkey(name)`,
      )
      .gte('snapshot_date', windowStartDate)
      .order('snapshot_date', { ascending: false })
      .limit(1000);
    if (error || !data) return EMPTY_CHANCES;

    const rows = data as unknown as RawChanceRow[];
    const dates = [...new Set(rows.map((r) => r.snapshot_date))].sort().reverse();
    const prevDate = dates[1] ?? null;

    const latestRows = rows.filter((r) => r.snapshot_date === latestDate);
    const prevByTeam = new Map<number, number>();
    if (prevDate) {
      for (const r of rows) {
        if (r.snapshot_date === prevDate) prevByTeam.set(r.team_id, r.p_win_tournament);
      }
    }

    const teams: TeamChance[] = latestRows
      .map((r) => {
        const prev = prevByTeam.get(r.team_id);
        return {
          teamId: r.team_id,
          team: one(r.team)?.name ?? 'Team',
          pWin: r.p_win_tournament,
          pFinal: r.p_reach_final,
          pSemi: r.p_reach_semi,
          delta: prev === undefined ? null : r.p_win_tournament - prev,
        };
      })
      .sort((a, b) => b.pWin - a.pWin || a.team.localeCompare(b.team));

    // Eliminated inside our window: had a row earlier, none on the latest date.
    const aliveIds = new Set(latestRows.map((r) => r.team_id));
    const goneById = new Map<number, string>();
    for (const r of rows) {
      if (!aliveIds.has(r.team_id) && !goneById.has(r.team_id)) {
        goneById.set(r.team_id, one(r.team)?.name ?? 'Team');
      }
    }
    const gone: GoneTeam[] = [...goneById.entries()]
      .map(([teamId, team]) => ({ teamId, team }))
      .sort((a, b) => a.team.localeCompare(b.team));

    const computedAt = latestRows.reduce<string | null>(
      (max, r) => (max === null || r.computed_at > max ? r.computed_at : max),
      null,
    );

    return {
      snapshotDate: latestDate,
      computedAt,
      sims: latestRows[0]?.sims ?? null,
      teams,
      gone,
    };
  } catch (err) {
    console.error('getChancesData: unexpected failure', err);
    return EMPTY_CHANCES;
  }
}

/** The single read the chances surfaces make. Server-only; degrades to the
 *  honest empty shape on every failure mode (missing table included). */
export async function getChancesData(): Promise<ChancesData> {
  return withTimeout(load(), 6000, EMPTY_CHANCES);
}

/** Minimum meaningful day-over-day pWin move (probability units) worth
 *  surfacing as a "mover" — filters out simulation noise. Shared by every
 *  movers surface (the /chances "Since yesterday" grid, the homepage's
 *  single title-race highlight) so the bar for "worth mentioning" can never
 *  drift between them. */
export const MEANINGFUL_MOVE_THRESHOLD = 0.005;

/** The single biggest day-over-day mover by absolute pWin change, or null
 *  when there's no prior snapshot yet or nothing moved meaningfully — the
 *  homepage's one-line "title race" highlight (RAMBO wave 2 #2) is rendered
 *  only when this is non-null, so it degrades to nothing rather than an
 *  empty/placeholder card. */
export function biggestMover(teams: TeamChance[]): (TeamChance & { delta: number }) | null {
  const moved = teams.filter(
    (t): t is TeamChance & { delta: number } =>
      t.delta !== null && Math.abs(t.delta) >= MEANINGFUL_MOVE_THRESHOLD,
  );
  if (moved.length === 0) return null;
  return moved.reduce((biggest, t) => (Math.abs(t.delta) > Math.abs(biggest.delta) ? t : biggest));
}
