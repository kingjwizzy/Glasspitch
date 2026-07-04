import 'server-only';

// Representative in-memory league data for local PREVIEW / screenshots ONLY.
//
// Gated behind the server-only `PREVIEW_LEAGUE` env var (see league.ts); never
// set in production and, being server-only, never reaches the client bundle. It
// writes NOTHING to Supabase — it lets the league page be rendered and
// screenshotted with no seeded local database, including the populated-upcoming
// state that the seeded 2022 WC data (all finished) cannot provide. Team names
// are plain text only, no crests/marks (§13). Numbers are illustrative.

import { favoured } from '@/lib/format';
import type { MatchResult, PredictionStatus } from '@/lib/types';
import { buildScoredRecord, type FixtureRowView } from './fixtures';
import type { LeagueData } from './league';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build one FixtureRowView for preview purposes. */
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

  const hit: boolean | null =
    isFinished && pick !== null ? pick === actualResult : null;

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

// ── empty mode ───────────────────────────────────────────────────────────────

function buildEmpty(slug: string): LeagueData {
  return {
    name: slug === 'world-cup' ? 'World Cup' : slug,
    slug,
    country: 'World',
    season: 2026,
    upcoming: [],
    recent: [],
    record: null,
  };
}

// ── default (populated) mode ─────────────────────────────────────────────────

function buildDefault(slug: string): LeagueData {
  const name = slug === 'world-cup' ? 'World Cup' : slug;

  // Two upcoming fixtures — exercises the UPCOMING branch of FixtureRow.
  const upcoming: FixtureRowView[] = [
    fixture(
      6001,
      'Argentina', 'argentina',
      'France', 'france',
      '2026-07-10T15:00:00+00:00',
      'scheduled',
      [0.35, 0.28, 0.37],
      [1, 1],
      null,
      null,
    ),
    fixture(
      6002,
      'England', 'england',
      'Spain', 'spain',
      '2026-07-10T19:00:00+00:00',
      'scheduled',
      [0.38, 0.27, 0.35],
      [1, 1],
      null,
      null,
    ),
  ];

  // Five finished recents with a mix of hits and misses.
  const recent: FixtureRowView[] = [
    // Hit: clear home win.
    fixture(
      6003,
      'France', 'france',
      'Morocco', 'morocco',
      '2022-12-14T19:00:00+00:00',
      'finished',
      [0.63, 0.22, 0.15],
      [2, 0],
      [2, 0],
      0.22,
    ),
    // Hit: away win, model got it.
    fixture(
      6004,
      'Croatia', 'croatia',
      'Brazil', 'brazil',
      '2022-12-09T15:00:00+00:00',
      'finished',
      [0.22, 0.25, 0.53],
      [0, 2],
      [0, 1],
      0.52,
    ),
    // Miss: model leaned home, it was a draw.
    fixture(
      6005,
      'Netherlands', 'netherlands',
      'Argentina', 'argentina',
      '2022-12-09T19:00:00+00:00',
      'finished',
      [0.47, 0.29, 0.24],
      [2, 1],
      [2, 2],
      0.74,
    ),
    // Hit: home win.
    fixture(
      6006,
      'England', 'england',
      'France', 'france',
      '2022-12-10T19:00:00+00:00',
      'finished',
      [0.37, 0.28, 0.35],
      [1, 1],
      [1, 2],
      0.83,
    ),
    // Hit: clear home win.
    fixture(
      6007,
      'Argentina', 'argentina',
      'Croatia', 'croatia',
      '2022-12-13T19:00:00+00:00',
      'finished',
      [0.58, 0.25, 0.17],
      [2, 0],
      [3, 0],
      0.28,
    ),
  ];

  return {
    name,
    slug,
    country: 'World',
    season: 2026,
    upcoming,
    recent,
    // Same shared derivation as the live read (fixtures.ts).
    record: buildScoredRecord(recent),
  };
}

// ── public entry point ────────────────────────────────────────────────────────

/** Returns preview data for a given slug and mode ('empty' | 'default' | '1'). */
export function previewLeagueData(slug: string, mode: string): LeagueData {
  if (mode === 'empty') return buildEmpty(slug);
  return buildDefault(slug);
}
