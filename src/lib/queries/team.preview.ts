import 'server-only';

// Representative in-memory team data for local PREVIEW / screenshots ONLY.
//
// Gated behind the server-only `PREVIEW_TEAM` env var (see team.ts); never set
// in production and, being server-only, never reaches the client bundle. It
// writes NOTHING to Supabase — it lets team pages be rendered and screenshotted
// with no seeded local database, including the populated-upcoming state that the
// seeded 2022 WC data (all fixtures finished) cannot provide. Team names are
// plain text only, no crests/marks (§13). Numbers are illustrative, not real.

import { favoured } from '@/lib/format';
import type { MatchResult, PredictionStatus } from '@/lib/types';
import { buildScoredRecord, type FixtureRowView } from './fixtures';
import type { FormResult } from './match';
import type { TeamData } from './team';

// ── helpers ──────────────────────────────────────────────────────────────────

function slugToName(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

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
    prediction,
    actualResult,
    pick,
    hit,
  };
}

function form(
  spec: Array<['W' | 'D' | 'L', number, number, string, boolean]>,
): FormResult[] {
  // spec is oldest → newest, matching the live loader's output order.
  let id = 9000;
  return spec.map(([outcome, gf, ga, opponent, home]) => ({
    outcome,
    gf,
    ga,
    opponent,
    home,
    fixtureId: id++,
    kickoff_utc: '2022-12-10T15:00:00+00:00',
  }));
}

// ── empty mode ───────────────────────────────────────────────────────────────

function buildEmpty(slug: string): TeamData {
  return {
    name: slugToName(slug),
    slug,
    league: 'World Cup',
    leagueSlug: 'world-cup',
    upcoming: [],
    recent: [],
    form: [],
    record: null,
  };
}

// ── default (populated) mode ─────────────────────────────────────────────────

function buildDefault(slug: string): TeamData {
  const name = slugToName(slug);

  // One upcoming fixture (future kickoff, with a published prediction). This
  // exercises the UPCOMING branch of FixtureRow — the seeded 2022 data has no
  // future fixtures, so this state is only reachable via preview.
  const upcoming: FixtureRowView[] = [
    fixture(
      5001,
      name, slug,
      'France', 'france',
      '2026-07-10T15:00:00+00:00',
      'scheduled',
      [0.41, 0.29, 0.30],
      [1, 1],
      null,
      null,
    ),
  ];

  // Three finished recents: two hits and one miss (the visible honesty — §1).
  const recent: FixtureRowView[] = [
    // Hit: clear home win — model backed it.
    fixture(
      5002,
      name, slug,
      'Mexico', 'mexico',
      '2022-11-26T13:00:00+00:00',
      'finished',
      [0.60, 0.24, 0.16],
      [2, 0],
      [2, 0],
      0.21,
    ),
    // Miss: model leaned home, away side won.
    fixture(
      5003,
      'Croatia', 'croatia',
      name, slug,
      '2022-12-09T19:00:00+00:00',
      'finished',
      [0.44, 0.30, 0.26],
      [1, 1],
      [0, 3],
      0.98,
    ),
    // Hit: model correctly called away.
    fixture(
      5004,
      'Poland', 'poland',
      name, slug,
      '2022-11-30T20:00:00+00:00',
      'finished',
      [0.22, 0.27, 0.51],
      [0, 2],
      [0, 2],
      0.35,
    ),
  ];

  const teamForm = form([
    ['W', 2, 0, 'Mexico', true],
    ['W', 2, 0, 'Poland', false],
    ['D', 0, 0, 'Saudi Arabia', true],
    ['L', 0, 3, 'Croatia', false],
    ['W', 2, 1, 'Netherlands', true],
  ]);

  return {
    name,
    slug,
    league: 'World Cup',
    leagueSlug: 'world-cup',
    upcoming,
    recent,
    form: teamForm,
    // Same shared derivation as the live read (fixtures.ts), so preview
    // screenshots can never show a record the live page wouldn't.
    record: buildScoredRecord(recent),
  };
}

// ── public entry point ────────────────────────────────────────────────────────

/** Returns preview data for a given slug and mode ('empty' | 'default' | '1'). */
export function previewTeamData(slug: string, mode: string): TeamData {
  if (mode === 'empty') return buildEmpty(slug);
  return buildDefault(slug);
}
