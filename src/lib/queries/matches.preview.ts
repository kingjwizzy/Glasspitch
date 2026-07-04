import 'server-only';

// Representative in-memory /matches index data for local PREVIEW / screenshots
// ONLY. Gated behind the server-only `PREVIEW_MATCHES` env var (see
// matches.ts); never set in production and, being server-only, never reaches
// the client bundle. Writes NOTHING to Supabase — it lets the page render
// (and the build succeed) with no seeded database. Team names are plain text
// only, no crests/marks (ARCHITECTURE.md §13). Numbers are illustrative.

import { favoured } from '@/lib/format';
import type { MatchResult, PredictionStatus } from '@/lib/types';
import type { FixtureRowView } from './fixtures';
import type { MatchDayGroup, MatchesIndexData } from './matches';

// Only a type-only import from ./matches above (never a value) — matches.ts
// imports THIS module's `previewMatchesData` as a value, so a value import in
// the other direction would make the two modules circularly dependent on each
// other's runtime bindings. Duplicating this tiny day-grouping helper (rather
// than importing matches.ts's `groupByDay`) keeps the preview module
// self-contained, mirroring how every other `*.preview.ts` in this codebase
// owns its own small builder rather than sharing one with its live sibling.
const DAY_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

function groupByDay(fixtures: FixtureRowView[]): MatchDayGroup[] {
  const order: string[] = [];
  const groups = new Map<string, FixtureRowView[]>();
  for (const f of fixtures) {
    const dateIso = f.kickoff_utc.slice(0, 10);
    if (!groups.has(dateIso)) {
      groups.set(dateIso, []);
      order.push(dateIso);
    }
    groups.get(dateIso)!.push(f);
  }
  return order.map((dateIso) => ({
    dateIso,
    label: DAY_FMT.format(new Date(`${dateIso}T00:00:00Z`)),
    fixtures: groups.get(dateIso) ?? [],
  }));
}

/** Build one FixtureRowView for preview purposes (mirrors league.preview.ts's
 *  local helper — each preview module owns its own small builder). */
function fixture(
  id: number,
  home: string,
  homeSlug: string,
  away: string,
  awaySlug: string,
  kickoff: string,
  status: 'scheduled' | 'finished',
  probs: [number, number, number] | null,
  predicted: [number, number] | null,
  finals: [number, number] | null,
  brier: number | null,
): FixtureRowView {
  const isFinished = status === 'finished';

  const actualResult: MatchResult | null =
    isFinished && finals !== null
      ? finals[0] > finals[1]
        ? 'home'
        : finals[1] > finals[0]
          ? 'away'
          : 'draw'
      : null;

  const prediction =
    probs !== null && predicted !== null
      ? {
          prob_home: probs[0],
          prob_draw: probs[1],
          prob_away: probs[2],
          predicted_home_goals: predicted[0],
          predicted_away_goals: predicted[1],
          status: (isFinished ? 'scored' : 'published') as PredictionStatus,
          locked_at: kickoff,
          brier_score: brier,
        }
      : null;

  const pick: MatchResult | null = prediction
    ? favoured({ home: prediction.prob_home, draw: prediction.prob_draw, away: prediction.prob_away }).key
    : null;

  const hit: boolean | null = isFinished && pick !== null ? pick === actualResult : null;

  return {
    id,
    kickoff_utc: kickoff,
    status,
    league: 'World Cup',
    leagueSlug: 'world-cup',
    home,
    away,
    homeSlug,
    awaySlug,
    final_home_goals: finals ? finals[0] : null,
    final_away_goals: finals ? finals[1] : null,
    // This preview builder never produces a 'live' fixture, so these are
    // always null — see match.preview.ts's identical note on why that's
    // deliberate rather than a gap.
    status_short: null,
    elapsed_minute: null,
    elapsed_extra_minute: null,
    prediction,
    actualResult,
    pick,
    hit,
  };
}

function buildEmpty(): MatchesIndexData {
  return { upcomingByDay: [], recent: [] };
}

function buildDefault(): MatchesIndexData {
  // Two days of upcoming fixtures — exercises the day-grouping UI.
  const upcoming: FixtureRowView[] = [
    fixture(
      7001, 'Argentina', 'argentina', 'France', 'france',
      '2026-07-10T15:00:00+00:00', 'scheduled',
      [0.35, 0.28, 0.37], [1, 1], null, null,
    ),
    fixture(
      7002, 'England', 'england', 'Spain', 'spain',
      '2026-07-10T19:00:00+00:00', 'scheduled',
      [0.38, 0.27, 0.35], [1, 1], null, null,
    ),
    fixture(
      7003, 'Brazil', 'brazil', 'Germany', 'germany',
      '2026-07-11T15:00:00+00:00', 'scheduled',
      null, null, null, null,
    ),
  ];

  const recent: FixtureRowView[] = [
    fixture(
      7004, 'France', 'france', 'Morocco', 'morocco',
      '2026-07-03T19:00:00+00:00', 'finished',
      [0.63, 0.22, 0.15], [2, 0], [2, 0], 0.22,
    ),
    fixture(
      7005, 'Croatia', 'croatia', 'Brazil', 'brazil',
      '2026-07-02T15:00:00+00:00', 'finished',
      [0.22, 0.25, 0.53], [0, 2], [0, 1], 0.52,
    ),
  ];

  return {
    upcomingByDay: groupByDay(upcoming),
    recent,
  };
}

/** Returns preview data for a given mode ('empty' | 'default' | '1'). */
export function previewMatchesData(mode: string): MatchesIndexData {
  if (mode === 'empty') return buildEmpty();
  return buildDefault();
}
