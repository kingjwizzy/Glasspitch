import 'server-only';

// Read layer for the free Gameweek Board (/board) and Fixture Ticker
// (/board/ticker) — ARCHITECTURE.md §5 v3, ROADMAP.md §2/§4. Reads
// `team_probability_snapshots` (anon-readable, written nightly by
// jobs/snapshot_probabilities.py) through the plain publishable-key singleton:
// these are PUBLIC, cached ISR pages, so they must never touch cookies or a
// session-aware client. Everything degrades to an honest empty state — the
// table is expected to be empty until the nightly job first runs.

import { getSupabaseClient } from '@/lib/supabaseClient';
import { one } from './shared';

export interface BoardSnapshotRow {
  teamId: number;
  team: string;
  fixtureId: number;
  opponent: string;
  isHome: boolean;
  kickoffUtc: string;
  fixtureStatus: string;
  probWin: number;
  probDraw: number;
  probLoss: number;
  probCleanSheet: number;
  xgFor: number;
  xgAgainst: number;
  /** Day-over-day change in win probability vs yesterday's snapshot of the
   *  same team+fixture; null on the pair's first snapshot. */
  deltaProbWin: number | null;
}

export interface BoardData {
  /** The latest snapshot date ("2026-07-03"), or null when no snapshot exists yet. */
  snapshotDate: string | null;
  rows: BoardSnapshotRow[];
}

interface RawSnapshotRow {
  team_id: number;
  fixture_id: number;
  is_home: boolean;
  prob_win: number;
  prob_draw: number;
  prob_loss: number;
  prob_clean_sheet: number;
  expected_goals_for: number;
  expected_goals_against: number;
  delta_prob_win: number | null;
  team: { name: string } | { name: string }[] | null;
  opponent: { name: string } | { name: string }[] | null;
  fixture:
    | { kickoff_utc: string; status: string }
    | { kickoff_utc: string; status: string }[]
    | null;
}

/**
 * All snapshot rows for the LATEST snapshot date, joined to team/opponent
 * names and the fixture's kickoff. Rows whose fixture has since finished or
 * been postponed are dropped (the board is about what's ahead). Returns an
 * empty result on any error — the pages render the honest empty slot.
 */
export async function getBoardData(): Promise<BoardData> {
  try {
    const sb = getSupabaseClient();

    const { data: latest, error: latestError } = await sb
      .from('team_probability_snapshots')
      .select('snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) {
      console.error('getBoardData: latest-date read failed', latestError.message);
      return { snapshotDate: null, rows: [] };
    }
    if (!latest) return { snapshotDate: null, rows: [] };

    const { data, error } = await sb
      .from('team_probability_snapshots')
      .select(
        `team_id, fixture_id, is_home, prob_win, prob_draw, prob_loss,
         prob_clean_sheet, expected_goals_for, expected_goals_against,
         delta_prob_win,
         team:teams!team_probability_snapshots_team_id_fkey(name),
         opponent:teams!team_probability_snapshots_opponent_team_id_fkey(name),
         fixture:fixtures!team_probability_snapshots_fixture_id_fkey(kickoff_utc, status)`,
      )
      .eq('snapshot_date', latest.snapshot_date)
      .limit(1000);
    if (error) {
      console.error('getBoardData: rows read failed', error.message);
      return { snapshotDate: latest.snapshot_date, rows: [] };
    }

    const rows: BoardSnapshotRow[] = [];
    for (const raw of (data ?? []) as unknown as RawSnapshotRow[]) {
      const fixture = one(raw.fixture);
      if (!fixture) continue;
      if (fixture.status === 'finished' || fixture.status === 'postponed') continue;
      rows.push({
        teamId: raw.team_id,
        team: one(raw.team)?.name ?? 'Team',
        fixtureId: raw.fixture_id,
        opponent: one(raw.opponent)?.name ?? 'Opponent',
        isHome: raw.is_home,
        kickoffUtc: fixture.kickoff_utc,
        fixtureStatus: fixture.status,
        probWin: raw.prob_win,
        probDraw: raw.prob_draw,
        probLoss: raw.prob_loss,
        probCleanSheet: raw.prob_clean_sheet,
        xgFor: raw.expected_goals_for,
        xgAgainst: raw.expected_goals_against,
        deltaProbWin: raw.delta_prob_win,
      });
    }
    rows.sort((a, b) => a.kickoffUtc.localeCompare(b.kickoffUtc) || a.team.localeCompare(b.team));
    return { snapshotDate: latest.snapshot_date, rows };
  } catch (err) {
    console.error('getBoardData: unexpected failure', err);
    return { snapshotDate: null, rows: [] };
  }
}

/** One row per team — its NEXT fixture's snapshot (earliest kickoff). */
export function boardByTeam(rows: BoardSnapshotRow[]): BoardSnapshotRow[] {
  const byTeam = new Map<number, BoardSnapshotRow>();
  for (const row of rows) {
    const existing = byTeam.get(row.teamId);
    if (!existing || row.kickoffUtc < existing.kickoffUtc) byTeam.set(row.teamId, row);
  }
  return [...byTeam.values()].sort(
    (a, b) => b.probWin - a.probWin || a.team.localeCompare(b.team),
  );
}

export interface MoverRow extends BoardSnapshotRow {
  delta: number;
}

/** Biggest day-over-day win-probability movers (per team's next fixture). */
export function boardMovers(rows: BoardSnapshotRow[], limit = 6): MoverRow[] {
  return boardByTeam(rows)
    .filter(
      (r): r is BoardSnapshotRow & { deltaProbWin: number } =>
        r.deltaProbWin !== null && Math.abs(r.deltaProbWin) >= 0.005,
    )
    .map((r) => ({ ...r, delta: r.deltaProbWin }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit);
}

// ── ticker (fixture difficulty) ──────────────────────────────────────────────

/** 1 (most favourable) … 5 (hardest), from the team's own win probability.
 *  Printed as a number everywhere — never colour-only (DESIGN.md §2). */
export function difficultyOf(probWin: number): 1 | 2 | 3 | 4 | 5 {
  if (probWin >= 0.6) return 1;
  if (probWin >= 0.45) return 2;
  if (probWin >= 0.3) return 3;
  if (probWin >= 0.18) return 4;
  return 5;
}

export interface TickerTeamRow {
  teamId: number;
  team: string;
  /** Upcoming fixtures in kickoff order — one cell per fixture. WC edition:
   *  usually a single cell; the club-era multi-gameweek grid slots in here. */
  cells: BoardSnapshotRow[];
}

/** Group the latest snapshot by team for the ticker grid, capped at
 *  `maxCells` upcoming fixtures per team. */
export function tickerRows(rows: BoardSnapshotRow[], maxCells = 4): TickerTeamRow[] {
  const byTeam = new Map<number, TickerTeamRow>();
  for (const row of rows) {
    const entry = byTeam.get(row.teamId) ?? {
      teamId: row.teamId,
      team: row.team,
      cells: [],
    };
    entry.cells.push(row);
    byTeam.set(row.teamId, entry);
  }
  const out = [...byTeam.values()];
  for (const entry of out) {
    entry.cells.sort((a, b) => a.kickoffUtc.localeCompare(b.kickoffUtc));
    entry.cells = entry.cells.slice(0, maxCells);
  }
  out.sort((a, b) => a.team.localeCompare(b.team));
  return out;
}
