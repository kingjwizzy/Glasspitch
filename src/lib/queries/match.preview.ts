import 'server-only';

// Representative in-memory match data for local PREVIEW / screenshots ONLY.
//
// Gated behind the server-only `PREVIEW_MATCH` env var (see match.ts); never set
// in production and, being server-only, never reaches the client bundle. It
// writes NOTHING to Supabase — it lets every prediction STATE be rendered and
// screenshotted with no seeded local database, including states the seeded 2022
// data has none of (published / locked / voided / no-prediction). Team names are
// plain text only, no crests/marks (§13). Numbers are illustrative, not real.

import type { FormResult, MatchData, MatchPrediction } from './match';

type Probs = [number, number, number];

let formSeq = 1000;

function form(spec: Array<['W' | 'D' | 'L', number, number, string, boolean]>): FormResult[] {
  // spec is oldest → newest, matching the live loader's output order.
  return spec.map(([outcome, gf, ga, opponent, home]) => ({
    outcome,
    gf,
    ga,
    opponent,
    home,
    fixtureId: formSeq++,
    kickoff_utc: '2026-06-20T18:00:00+00:00',
  }));
}

interface Spec {
  id: number;
  home: string;
  away: string;
  kickoff: string;
  status: MatchData['status'];
  probs: Probs;
  predicted: [number, number];
  predStatus: MatchPrediction['status'];
  final?: [number, number];
  result?: MatchPrediction['result'];
  brier?: number;
  logLoss?: number;
  voided?: boolean;
  noPrediction?: boolean;
  homeForm: FormResult[];
  awayForm: FormResult[];
}

function build(s: Spec): MatchData {
  const final = s.final ?? null;
  const prediction: MatchPrediction | null =
    s.noPrediction || s.voided
      ? null
      : {
          prob_home: s.probs[0],
          prob_draw: s.probs[1],
          prob_away: s.probs[2],
          predicted_home_goals: s.predicted[0],
          predicted_away_goals: s.predicted[1],
          status: s.predStatus,
          locked_at: s.kickoff,
          result: s.result ?? null,
          brier_score: s.brier ?? null,
          log_loss: s.logLoss ?? null,
          final_home_goals: final ? final[0] : null,
          final_away_goals: final ? final[1] : null,
        };
  return {
    id: s.id,
    league: 'FIFA World Cup',
    kickoff_utc: s.kickoff,
    status: s.status,
    home: s.home,
    away: s.away,
    homeSlug: s.home.toLowerCase().replace(/\s+/g, '-'),
    awaySlug: s.away.toLowerCase().replace(/\s+/g, '-'),
    final_home_goals: final ? final[0] : null,
    final_away_goals: final ? final[1] : null,
    prediction,
    predictionVoided: Boolean(s.voided),
    homeForm: s.homeForm,
    awayForm: s.awayForm,
  };
}

const SPECS: Record<number, Spec> = {
  // 1 — scored HIT: a clear favourite that came in.
  1: {
    id: 1,
    home: 'Spain',
    away: 'Costa Rica',
    kickoff: '2026-06-21T16:00:00+00:00',
    status: 'finished',
    probs: [0.62, 0.23, 0.15],
    predicted: [2, 0],
    predStatus: 'scored',
    final: [3, 0],
    result: 'home',
    brier: 0.24,
    logLoss: 0.48,
    homeForm: form([
      ['W', 2, 0, 'Germany', true],
      ['W', 1, 0, 'Japan', false],
      ['D', 1, 1, 'Morocco', true],
      ['W', 3, 1, 'Croatia', false],
    ]),
    awayForm: form([
      ['L', 0, 7, 'Spain', false],
      ['L', 0, 1, 'Japan', true],
      ['W', 1, 0, 'Germany', false],
    ]),
  },
  // 2 — scored MISS: backed the favourite, it finished level (the honest miss).
  2: {
    id: 2,
    home: 'Argentina',
    away: 'France',
    kickoff: '2026-06-22T15:00:00+00:00',
    status: 'finished',
    probs: [0.35, 0.35, 0.3],
    predicted: [1, 1],
    predStatus: 'scored',
    final: [2, 2],
    result: 'draw',
    brier: 0.635,
    logLoss: 1.05,
    homeForm: form([
      ['W', 3, 0, 'Croatia', true],
      ['W', 2, 1, 'Netherlands', false],
      ['W', 2, 0, 'Australia', true],
      ['L', 1, 2, 'Saudi Arabia', true],
    ]),
    awayForm: form([
      ['W', 2, 0, 'Morocco', true],
      ['W', 2, 1, 'England', false],
      ['W', 3, 1, 'Poland', true],
      ['L', 0, 1, 'Tunisia', false],
    ]),
  },
  // 3 — scored MISS where the model gave the actual outcome almost no chance.
  3: {
    id: 3,
    home: 'Japan',
    away: 'Costa Rica',
    kickoff: '2026-06-21T10:00:00+00:00',
    status: 'finished',
    probs: [0.5, 0.5, 0.0],
    predicted: [2, 1],
    predStatus: 'scored',
    final: [0, 1],
    result: 'away',
    brier: 1.5,
    logLoss: 27.631,
    homeForm: form([
      ['L', 1, 2, 'Germany', false],
      ['W', 2, 1, 'Spain', true],
      ['D', 0, 0, 'Croatia', false],
    ]),
    awayForm: form([
      ['L', 0, 7, 'Spain', false],
      ['W', 1, 0, 'Japan', true],
    ]),
  },
  // 4 — upcoming, published prediction (locks at kickoff, not yet locked).
  4: {
    id: 4,
    home: 'Brazil',
    away: 'Switzerland',
    kickoff: '2026-06-28T19:00:00+00:00',
    status: 'scheduled',
    probs: [0.55, 0.26, 0.19],
    predicted: [2, 0],
    predStatus: 'published',
    homeForm: form([
      ['W', 2, 0, 'Serbia', true],
      ['W', 1, 0, 'Switzerland', true],
      ['D', 0, 0, 'Croatia', false],
      ['W', 4, 1, 'South Korea', true],
    ]),
    awayForm: form([
      ['W', 1, 0, 'Cameroon', true],
      ['L', 0, 1, 'Brazil', false],
      ['W', 3, 2, 'Serbia', false],
    ]),
  },
  // 5 — live, locked prediction with a live score.
  5: {
    id: 5,
    home: 'Portugal',
    away: 'Uruguay',
    kickoff: '2026-06-25T19:00:00+00:00',
    status: 'live',
    probs: [0.46, 0.27, 0.27],
    predicted: [2, 1],
    predStatus: 'locked',
    final: [1, 0],
    homeForm: form([
      ['W', 3, 2, 'Ghana', true],
      ['W', 2, 0, 'Uruguay', false],
      ['W', 6, 1, 'Switzerland', true],
    ]),
    awayForm: form([
      ['D', 0, 0, 'South Korea', true],
      ['L', 0, 2, 'Portugal', true],
      ['L', 0, 2, 'Ghana', false],
    ]),
  },
  // 6 — a prediction existed but was VOIDED (not locked before kickoff, §10).
  6: {
    id: 6,
    home: 'Morocco',
    away: 'Spain',
    kickoff: '2026-06-24T15:00:00+00:00',
    status: 'finished',
    probs: [0.33, 0.33, 0.34],
    predicted: [1, 1],
    predStatus: 'unlocked_void',
    final: [0, 0],
    voided: true,
    homeForm: form([
      ['D', 0, 0, 'Croatia', true],
      ['W', 2, 1, 'Canada', false],
      ['L', 0, 2, 'Portugal', false],
    ]),
    awayForm: form([
      ['W', 7, 0, 'Costa Rica', true],
      ['L', 1, 2, 'Japan', false],
      ['D', 1, 1, 'Germany', true],
    ]),
  },
  // 7 — finished match with NO published prediction at all.
  7: {
    id: 7,
    home: 'Wales',
    away: 'Iran',
    kickoff: '2026-06-23T10:00:00+00:00',
    status: 'finished',
    probs: [0, 0, 0],
    predicted: [0, 0],
    predStatus: 'published',
    final: [0, 2],
    noPrediction: true,
    homeForm: form([
      ['D', 1, 1, 'USA', false],
      ['L', 0, 3, 'England', true],
    ]),
    awayForm: form([
      ['L', 2, 6, 'England', false],
      ['W', 2, 0, 'Wales', false],
    ]),
  },
  // 8 — finished, result in, but the prediction is not yet scored.
  8: {
    id: 8,
    home: 'Netherlands',
    away: 'USA',
    kickoff: '2026-06-23T15:00:00+00:00',
    status: 'finished',
    probs: [0.35, 0.35, 0.3],
    predicted: [1, 1],
    predStatus: 'locked',
    final: [3, 1],
    homeForm: form([
      ['W', 2, 0, 'Qatar', true],
      ['D', 1, 1, 'Ecuador', true],
      ['W', 2, 0, 'Senegal', false],
    ]),
    awayForm: form([
      ['D', 1, 1, 'Wales', true],
      ['D', 0, 0, 'England', false],
      ['L', 0, 1, 'Iran', true],
    ]),
  },
};

/** Returns preview data for a known id, else null (so 404 is testable too). */
export function previewMatchData(id: number): MatchData | null {
  const spec = SPECS[id];
  return spec ? build(spec) : null;
}
