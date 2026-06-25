import 'server-only';

// Representative in-memory home-page data for local PREVIEW / screenshots ONLY.
//
// Gated behind the server-only `PREVIEW_HOMEPAGE` env var (see homepage.ts); it
// is never set in production and, being server-only, never reaches the client
// bundle. It writes NOTHING to Supabase — it just lets the page render with
// realistic content when there is no seeded local database. Team names are
// plain text only, no crests/marks (ARCHITECTURE.md §13). The numbers are
// illustrative, not real predictions.

import type {
  FixtureView,
  HomepageData,
  PredictionView,
  RecentCallView,
} from './homepage';
import { predictedPick } from '@/lib/format';

export type PreviewVariant = 'default' | 'live';

let seq = 1;

function fixture(
  home: string,
  away: string,
  kickoff: string,
  probs: [number, number, number],
  predicted: [number, number],
  status: FixtureView['status'] = 'scheduled',
  predStatus: PredictionView['status'] = 'published',
  finalScore: [number, number] | null = null,
): FixtureView {
  const id = seq++;
  return {
    id,
    kickoff_utc: kickoff,
    status,
    league: 'FIFA World Cup',
    home,
    away,
    homeSlug: home.toLowerCase().replace(/\s+/g, '-'),
    awaySlug: away.toLowerCase().replace(/\s+/g, '-'),
    final_home_goals: finalScore ? finalScore[0] : null,
    final_away_goals: finalScore ? finalScore[1] : null,
    prediction: {
      prob_home: probs[0],
      prob_draw: probs[1],
      prob_away: probs[2],
      predicted_home_goals: predicted[0],
      predicted_away_goals: predicted[1],
      status: predStatus,
      locked_at: kickoff,
    },
  };
}

function scored(
  home: string,
  away: string,
  probs: [number, number, number],
  final: [number, number],
  result: RecentCallView['result'],
  brier: number,
): RecentCallView {
  const pick = predictedPick({ home: probs[0], draw: probs[1], away: probs[2] });
  return {
    id: `preview-${seq++}`,
    fixtureId: seq,
    league: 'FIFA World Cup',
    home,
    away,
    prob_home: probs[0],
    prob_draw: probs[1],
    prob_away: probs[2],
    final_home_goals: final[0],
    final_away_goals: final[1],
    result,
    brier_score: brier,
    pick,
    hit: result !== null && pick === result,
  };
}

export function previewHomepageData(variant: PreviewVariant): HomepageData {
  seq = 1;

  const upcoming: FixtureView[] = [
    fixture('Argentina', 'Croatia', '2026-06-26T16:00:00+00:00', [0.55, 0.24, 0.21], [2, 0]),
    fixture('France', 'Morocco', '2026-06-26T19:00:00+00:00', [0.5, 0.26, 0.24], [2, 1]),
    fixture('England', 'Netherlands', '2026-06-27T16:00:00+00:00', [0.38, 0.3, 0.32], [1, 1]),
    fixture('Portugal', 'Uruguay', '2026-06-27T19:00:00+00:00', [0.46, 0.27, 0.27], [2, 1]),
    fixture('Germany', 'Japan', '2026-06-28T16:00:00+00:00', [0.41, 0.29, 0.3], [1, 1]),
    fixture('Belgium', 'United States', '2026-06-28T19:00:00+00:00', [0.48, 0.26, 0.26], [2, 1]),
  ];

  // Tightest calls first (smallest top-two gap) — the most interesting reads.
  const watching = [upcoming[2], upcoming[4], upcoming[3]];

  const recentCalls: RecentCallView[] = [
    scored('Netherlands', 'Mexico', [0.57, 0.24, 0.19], [3, 1], 'home', 0.33),
    // An honest miss — shown openly (DESIGN.md §1, the whole identity).
    scored('Croatia', 'Japan', [0.5, 0.27, 0.23], [1, 2], 'away', 0.86),
    scored('Spain', 'Switzerland', [0.62, 0.23, 0.15], [2, 0], 'home', 0.24),
    // A second miss — a predicted home win that finished level.
    scored('Uruguay', 'Ghana', [0.48, 0.28, 0.24], [1, 1], 'draw', 0.71),
    scored('France', 'Poland', [0.66, 0.21, 0.13], [3, 0], 'home', 0.19),
  ];

  const hero =
    variant === 'live'
      ? fixture(
          'Argentina',
          'France',
          '2026-06-25T18:00:00+00:00',
          [0.49, 0.27, 0.24],
          [2, 1],
          'live',
          'locked',
          [1, 1],
        )
      : fixture('Brazil', 'Spain', '2026-06-25T19:00:00+00:00', [0.44, 0.28, 0.28], [2, 1]);

  return {
    hero,
    upcoming,
    watching,
    recentCalls,
    record: { meanBrier: 0.57, count: 37 },
  };
}
