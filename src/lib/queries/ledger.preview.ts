import 'server-only';

// Representative in-memory ledger rows for local PREVIEW / screenshots ONLY.
//
// Gated behind the server-only `PREVIEW_LEDGER` env var (see ledger.ts); it is
// never set in production and, being server-only, never reaches the client
// bundle. It writes NOTHING to Supabase — it just lets the page render with
// realistic content when there is no seeded local database, and it never
// produces the empty state by mutating data. Team names are plain text only, no
// crests/marks (ARCHITECTURE.md §13). The numbers are illustrative, not real
// predictions, and deliberately include wins and losses across a spread of
// confidence bands so the record and the reliability table both populate.

import type { MatchResult } from '@/lib/types';
import { predictedPick } from '@/lib/format';
import type { LedgerRowView } from './ledger';

let seq = 1;

function row(
  home: string,
  away: string,
  probs: [number, number, number],
  predicted: [number, number],
  final: [number, number],
  result: MatchResult,
  brier: number,
  logLoss: number,
): LedgerRowView {
  const fixtureId = seq++;
  const pick = predictedPick({ home: probs[0], draw: probs[1], away: probs[2] });
  return {
    id: `preview-${fixtureId}`,
    fixtureId,
    league: 'FIFA World Cup',
    home,
    away,
    kickoffUtc: '2026-06-01T18:00:00+00:00',
    prob_home: probs[0],
    prob_draw: probs[1],
    prob_away: probs[2],
    predicted_home_goals: predicted[0],
    predicted_away_goals: predicted[1],
    final_home_goals: final[0],
    final_away_goals: final[1],
    result,
    brier_score: brier,
    log_loss: logLoss,
    pick,
    hit: pick === result,
  };
}

/** Illustrative scored calls, newest first (the order the live read returns). */
export function previewLedgerRows(): LedgerRowView[] {
  seq = 1;
  return [
    row('France', 'Poland', [0.66, 0.21, 0.13], [3, 0], [3, 1], 'home', 0.19, 0.42),
    row('Spain', 'Switzerland', [0.62, 0.23, 0.15], [2, 0], [2, 0], 'home', 0.24, 0.48),
    row('Netherlands', 'Mexico', [0.57, 0.24, 0.19], [2, 1], [3, 1], 'home', 0.33, 0.56),
    row('Argentina', 'Australia', [0.54, 0.26, 0.20], [2, 1], [2, 1], 'home', 0.36, 0.62),
    // An honest miss — a predicted home win that finished level.
    row('Uruguay', 'Ghana', [0.48, 0.28, 0.24], [1, 0], [1, 1], 'draw', 0.71, 1.27),
    row('Portugal', 'Switzerland', [0.50, 0.27, 0.23], [2, 1], [2, 0], 'home', 0.41, 0.69),
    row('England', 'Senegal', [0.52, 0.27, 0.21], [2, 0], [3, 0], 'home', 0.39, 0.65),
    // A miss — the model leaned home, the away side won.
    row('Brazil', 'Croatia', [0.49, 0.28, 0.23], [2, 1], [1, 2], 'away', 0.86, 1.47),
    row('Germany', 'Japan', [0.41, 0.29, 0.30], [1, 1], [1, 1], 'draw', 0.62, 1.24),
    // A miss — backed the away side on a near coin-flip, but it finished level (a draw).
    row('Morocco', 'Spain', [0.30, 0.33, 0.37], [1, 1], [0, 0], 'draw', 0.64, 1.11),
    row('Croatia', 'Japan', [0.34, 0.33, 0.33], [1, 1], [1, 1], 'draw', 0.66, 1.11),
    // A miss — we gave the eventual outcome a low chance.
    row('Belgium', 'Morocco', [0.55, 0.26, 0.19], [2, 0], [0, 2], 'away', 1.05, 1.66),
    row('Japan', 'Costa Rica', [0.45, 0.29, 0.26], [1, 0], [0, 1], 'away', 0.83, 1.35),
    row('Senegal', 'Ecuador', [0.42, 0.30, 0.28], [1, 1], [2, 1], 'home', 0.55, 0.87),
  ];
}
