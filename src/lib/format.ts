// Pure formatting + display helpers for the read-only web layer.
// Deterministic and timezone-stable (all times rendered in UTC) so server and
// client output match and there is no hydration mismatch (ARCHITECTURE.md §7).

import type { MatchResult } from '@/lib/types';

export interface Probs {
  home: number;
  draw: number;
  away: number;
}

/** 0.54 → "54%" (whole percent — compact bars and row surfaces).
 *  Honest caps at the edges: a non-zero probability never rounds to a flat
 *  "0%" or "100%" — it shows "<1%" / ">99%" instead (W4 spec, number grammar). */
export function pct(value: number): string {
  const rounded = Math.round(value * 100);
  if (rounded <= 0 && value > 0) return '<1%';
  if (rounded >= 100 && value < 1) return '>99%';
  return `${rounded}%`;
}

/** Whole-percent NUMBER string without the % sign (for "H 54 · D 26 · A 20"
 *  style mono lines where the unit is stated once). Same caps as pct(). */
export function pctFigure(value: number): string {
  return pct(value).replace('%', '');
}

/**
 * One-decimal percent trio that always sums to exactly 100.0 (largest-remainder
 * rounding) — the number grammar for match/ledger display surfaces where three
 * independently-rounded figures visibly not summing to 100 would undermine the
 * "we take our numbers seriously" register (W4 spec item 3).
 */
export function pctTrioOneDecimal(p: Probs): [string, string, string] {
  const raw = [p.home, p.draw, p.away].map((v) => v * 1000); // tenths of a percent
  const floors = raw.map((v) => Math.floor(v));
  let remainder = 1000 - floors.reduce((s, v) => s + v, 0);
  // Distribute leftover tenths to the largest fractional parts (stable order on ties).
  const order = raw
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] += 1;
    remainder -= 1;
  }
  return out.map((v) => `${(v / 10).toFixed(1)}%`) as [string, string, string];
}

/** Brier / log loss → three decimals, mono-ready ("0.191"). */
export function metric3(value: number): string {
  return value.toFixed(3);
}

const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** ISO timestamp → "18:00" (UTC, 24h). */
export function formatTimeUtc(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : TIME_FMT.format(d);
}

const DATETIME_SHORT_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** ISO timestamp → "28 Jun 14:02 UTC" (provenance microlines). */
export function formatDateTimeShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = Object.fromEntries(
    DATETIME_SHORT_FMT.formatToParts(d).map((part) => [part.type, part.value]),
  );
  return `${p.day} ${p.month} ${p.hour}:${p.minute} UTC`;
}

const FULL_DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** ISO timestamp → "Friday, 3 July 2026" (stable, UTC). */
export function formatFullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = Object.fromEntries(
    FULL_DATE_FMT.formatToParts(d).map((part) => [part.type, part.value]),
  );
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}

const DAY_DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** The UTC calendar date ("2026-07-03") of an ISO timestamp — day-grouping key. */
export function utcDateKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

/**
 * Day-group heading relative to the render moment: "Today — Friday 3 July",
 * "Tomorrow — Saturday 4 July", else "Saturday 11 July" (all UTC, so server
 * output is deterministic and byte-identical for every visitor).
 */
export function dayLabel(iso: string, renderedAt: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = Object.fromEntries(
    DAY_DATE_FMT.formatToParts(d).map((part) => [part.type, part.value]),
  );
  const date = `${p.weekday} ${p.day} ${p.month}`;
  const key = utcDateKey(iso);
  const todayKey = utcDateKey(renderedAt);
  const tomorrowKey = utcDateKey(
    new Date(new Date(renderedAt).getTime() + 24 * 3600 * 1000).toISOString(),
  );
  if (key === todayKey) return `Today — ${date}`;
  if (key === tomorrowKey) return `Tomorrow — ${date}`;
  return date;
}

/**
 * Coarse, server-computed kickoff phrasing (W4 spec): "Kicks off today,
 * 18:00 UTC — about 3 hours away" / "Kicks off tomorrow, 17:00 UTC" /
 * "Kicks off Saturday 11 July, 16:00 UTC". The buckets are deliberately coarse
 * ("about N hours") so the ≤10-minute ISR staleness is absorbed — never a
 * ticking countdown (no JS, no urgency; DESIGN.md §5/§6).
 */
export function kickoffPhrase(kickoffIso: string, renderedAt: string): string {
  const kick = new Date(kickoffIso);
  const now = new Date(renderedAt);
  if (Number.isNaN(kick.getTime()) || Number.isNaN(now.getTime())) {
    return `Kicks off ${kickoffIso}`;
  }
  const time = `${formatTimeUtc(kickoffIso)} UTC`;
  const key = utcDateKey(kickoffIso);
  const todayKey = utcDateKey(renderedAt);
  const tomorrowKey = utcDateKey(
    new Date(now.getTime() + 24 * 3600 * 1000).toISOString(),
  );

  if (key === todayKey) {
    const mins = (kick.getTime() - now.getTime()) / 60000;
    if (mins <= 5) return `Kicks off today, ${time} — any moment now`;
    if (mins < 55) return `Kicks off today, ${time} — less than an hour away`;
    const hours = Math.round(mins / 60);
    return `Kicks off today, ${time} — about ${hours === 1 ? 'an hour' : `${hours} hours`} away`;
  }
  if (key === tomorrowKey) return `Kicks off tomorrow, ${time}`;
  const p = Object.fromEntries(
    DAY_DATE_FMT.formatToParts(kick).map((part) => [part.type, part.value]),
  );
  return `Kicks off ${p.weekday} ${p.day} ${p.month}, ${time}`;
}

/**
 * The mono freshness stamp under the home kicker: "Updated 09:40 UTC ·
 * refreshes after every final whistle" — rendered once at ISR time (honest
 * about staleness, never a live clock).
 */
export function updatedStamp(renderedAt: string): string {
  return `Updated ${formatTimeUtc(renderedAt)} UTC · refreshes after every final whistle`;
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

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** ISO timestamp → "18 Dec 2022" (stable, UTC). Used to keep per-match titles
 *  unique when the same two teams meet more than once. */
export function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DATE_FMT.format(d);
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

/** Human label for a match outcome. */
export const RESULT_LABEL: Record<MatchResult, string> = {
  home: 'Home win',
  draw: 'Draw',
  away: 'Away win',
};

/**
 * Shared label for every "our call" surface (RecentCalls, ScoredResult,
 * FixtureRow, LedgerTable) — always followed by the outcome name and the
 * probability in parentheses, e.g. "Our call: Brazil (54%)". A single shared
 * constant so the wording can never drift back into betting vernacular
 * ("backed"/"backing" reads as bet-slip language, which contradicts the
 * "analysis, not betting advice" framing — ARCHITECTURE.md §9/§13).
 */
export const OUR_CALL_LABEL = 'Our call:';

/** Name the picked outcome by team, or "the draw" — used in the "Our call: …"
 *  copy (see `OUR_CALL_LABEL`) shared by RecentCalls/ScoredResult/FixtureRow/
 *  LedgerTable. */
export function outcomeName(key: MatchResult, home: string, away: string): string {
  if (key === 'home') return home;
  if (key === 'away') return away;
  return 'the draw';
}

/** Probability the prediction assigned to a given outcome. */
export function probOf(p: Probs, key: MatchResult): number {
  if (key === 'home') return p.home;
  if (key === 'away') return p.away;
  return p.draw;
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
    const team = outcomeName(fav.key, input.home_name, input.away_name);
    return `Too close to call — the model gives ${team} only a slight edge at ${favPct}, ${score} its predicted score.`;
  }
  if (fav.key === 'draw') {
    return `The model leans towards a stalemate — ${favPct} on the draw, ${score} predicted.`;
  }
  const team = outcomeName(fav.key, input.home_name, input.away_name);
  return `The model leans ${team} at ${favPct}; it predicts ${score}.`;
}

/**
 * One-line plain-prose read for a scored receipt (W4 spec §4) — honest
 * probability framing at equal weight for hits and misses, derived only from
 * the probability we assigned and whether it landed. Never hype, never a
 * guarantee (DESIGN.md §9).
 */
export function receiptRead(pickProb: number, hit: boolean): string {
  const p = pct(pickProb);
  if (hit) {
    return pickProb >= 0.5
      ? `A ${p} call landed — about as often as it should.`
      : `A ${p} call landed — our narrow favourite came through.`;
  }
  return pickProb >= 0.5
    ? `A ${p} call missed — even strong calls lose sometimes, and we count it.`
    : `A ${p} call lost — that should happen more often than not.`;
}
