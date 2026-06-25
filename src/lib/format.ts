// Pure formatting + display helpers for the read-only web layer.
// Deterministic and timezone-stable (all times rendered in UTC) so server and
// client output match and there is no hydration mismatch (ARCHITECTURE.md §7).

import type { MatchResult } from '@/lib/types';

export interface Probs {
  home: number;
  draw: number;
  away: number;
}

/** 0.54 → "54%". */
export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** 2, 1 → "2–1" (en dash, no spaces — a scoreline). */
export function scoreLine(home: number, away: number): string {
  return `${home}–${away}`;
}

const KICKOFF_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** ISO timestamp → "Sat 27 Jun, 18:00 UTC" (stable, UTC). */
export function formatKickoff(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = Object.fromEntries(
    KICKOFF_FMT.formatToParts(d).map((part) => [part.type, part.value]),
  );
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute} UTC`;
}

/** The single most likely outcome and its probability. */
export function favoured(p: Probs): { key: MatchResult; prob: number } {
  const entries: Array<[MatchResult, number]> = [
    ['home', p.home],
    ['draw', p.draw],
    ['away', p.away],
  ];
  // Stable order (home > draw > away) on ties keeps output deterministic.
  entries.sort((a, b) => b[1] - a[1]);
  return { key: entries[0][0], prob: entries[0][1] };
}

/** Gap between the most- and second-most-likely outcomes (0 = dead heat). */
export function topTwoSpread(p: Probs): number {
  const v = [p.home, p.draw, p.away].sort((a, b) => b - a);
  return v[0] - v[1];
}

/** The outcome we'd have picked (argmax) — used for the ✓/✗ on scored calls. */
export function predictedPick(p: Probs): MatchResult {
  return favoured(p).key;
}

function outcomeTeam(key: MatchResult, home: string, away: string): string {
  if (key === 'home') return home;
  if (key === 'away') return away;
  return 'a draw';
}

export interface ReadInput extends Probs {
  home_name: string;
  away_name: string;
  predicted_home_goals: number;
  predicted_away_goals: number;
}

/**
 * A short, plain-language "read" generated from the numbers — there is no prose
 * column in the schema, so the home page derives this line (ARCHITECTURE.md §14
 * "template-driven written read"). Honest framing only: never a guarantee, never
 * "beats the market" (§9, §13).
 */
export function templateRead(input: ReadInput): string {
  const probs: Probs = { home: input.home, draw: input.draw, away: input.away };
  const fav = favoured(probs);
  const score = scoreLine(input.predicted_home_goals, input.predicted_away_goals);
  const favPct = pct(fav.prob);

  if (topTwoSpread(probs) < 0.08) {
    const team =
      fav.key === 'draw'
        ? 'the draw'
        : outcomeTeam(fav.key, input.home_name, input.away_name);
    return `Too close to call — the model gives ${team} only a slight edge at ${favPct}, ${score} its predicted score.`;
  }
  if (fav.key === 'draw') {
    return `The model leans towards a stalemate — ${favPct} on the draw, ${score} predicted.`;
  }
  const team = outcomeTeam(fav.key, input.home_name, input.away_name);
  return `The model leans ${team} at ${favPct}; it predicts ${score}.`;
}
