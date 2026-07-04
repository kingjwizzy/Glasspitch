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

// ── Matchday liveness — the live minute (RAMBO wave 3 #1) ──────────────────

/** The three fixture columns the live clock is derived from — nullable
 *  because the fetch sweep populates them only for fixtures it has touched
 *  since the columns were added; an older/just-flipped-live row can be `null`
 *  until the next run. Callers must gate on `status === 'live'` themselves —
 *  this helper trusts its inputs unconditionally. */
export interface LiveClock {
  statusShort: string | null;
  elapsedMinute: number | null;
  elapsedExtraMinute: number | null;
}

/**
 * Render recipe for a live match clock (DESIGN.md §4 item 1: "a LIVE badge +
 * minute"): `"HT"` at half time; else the elapsed minute with any added time
 * printed as `67'` / `90+2'`; else `null` so the caller falls back to its
 * existing plain "Live" label. Never returns an empty string or the literal
 * text `"null"` — a fixture the fetch sweep hasn't touched yet degrades to
 * that honest fallback rather than a broken-looking badge.
 */
export function liveMinuteLabel(clock: LiveClock): string | null {
  if (clock.statusShort === 'HT') return 'HT';
  if (clock.elapsedMinute != null) {
    const extra = clock.elapsedExtraMinute ? `+${clock.elapsedExtraMinute}` : '';
    return `${clock.elapsedMinute}${extra}'`;
  }
  return null;
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

// ── Beat the Model — the reveal (kick plan #5) ──────────────────────────────

export type BrierVerdictTier = 'bang-on' | 'sharp' | 'close' | 'off';

export interface BrierVerdict {
  tier: BrierVerdictTier;
  /** Short chip label. */
  label: string;
  /** One-line, kind, instructive elaboration. Never "try again" or any
   *  urgency vocabulary (DESIGN.md §6) — a miss is a lesson, not a failure. */
  detail: string;
}

/**
 * Plain-language translation of a three-way H/D/A Brier score into a kind,
 * instructive verdict. Same 0 (perfect) .. 2 (confidently wrong) scale
 * printed everywhere else (ScoredResult.tsx's "0 best, 2 worst" caption, the
 * pool leaderboard) — never a second, bespoke scale.
 *
 * The three cut points are grounded in the score's own geometry, not chosen
 * by eye:
 *  - The algebraic minimum Brier for ANY miss (the pick that would have been
 *    argmax'd from the saved probabilities doesn't match what happened) is
 *    exactly 0.5 — reached only in the limit of two outcomes tied at 50/50
 *    and the third at 0. So a Brier below 0.5 is ALWAYS a hit.
 *  - The maximum possible Brier for ANY hit is exactly 2/3 (≈0.667) — reached
 *    only at a perfectly even 33/33/33 split (the same "always guessing"
 *    baseline RecordBand.tsx plots on the home page). So a Brier at or above
 *    1.0 is ALWAYS a miss.
 *  - 0.5–1.0 is therefore the only band where hits and misses overlap: a hit
 *    called with little conviction, or a miss that still gave the truth real
 *    weight. It reads as "close" either way — a narrow call is a narrow call,
 *    regardless of which side of it landed.
 *
 * | Tier    | Range     | Always... |
 * |---------|-----------|------------|
 * | Bang on | < 0.20    | a confident hit |
 * | Sharp   | 0.20–0.50 | a hit, leaning the right way |
 * | Close   | 0.50–1.00 | ambiguous — a narrow hit or a narrow miss |
 * | Off     | ≥ 1.00    | a miss the model (or you) read differently |
 */
export function brierVerdict(brier: number): BrierVerdict {
  if (brier < 0.2) {
    return {
      tier: 'bang-on',
      label: 'Bang on',
      detail: 'Nailed it, and said so with real conviction.',
    };
  }
  if (brier < 0.5) {
    return {
      tier: 'sharp',
      label: 'Sharp',
      detail: 'You leaned the right way, and it paid off.',
    };
  }
  if (brier < 1.0) {
    return {
      tier: 'close',
      label: 'Close',
      detail: 'This one could have gone either way — a narrow call.',
    };
  }
  return {
    tier: 'off',
    label: 'Off',
    detail: 'The model read this one differently — a lesson for next time, not a verdict on you.',
  };
}

/**
 * The public track record as one shareable line, e.g. "41 of 64 calls landed
 * so far — the full scored record, misses included." Takes plain numbers
 * (not a query-layer type) so this stays a pure, data-source-agnostic
 * formatter — callers on both /ledger and /board build it from the SAME
 * `getRecordFigures()` read (src/lib/queries/recordSummary.ts), so the
 * shared line can never drift from the number a visitor could go verify.
 */
export function recordShareText(count: number, hits: number): string {
  return `${hits} of ${count} calls landed so far — the full scored record, misses included.`;
}

// ── Calibration reliability read (RAMBO wave 2 #3) ─────────────────────────

/** Structural (not imported) shape matching `CalibrationBin` from
 *  lib/queries/ledger.ts — kept local, plain-number-only, so this stays a
 *  pure, data-source-agnostic formatter with no dependency the other way
 *  (ledger.ts already imports from this module; importing its type back
 *  here would be circular). Any object with these three fields — including
 *  a real `CalibrationBin` — satisfies it. */
export interface CalibrationPoint {
  n: number;
  predictedAvg: number | null;
  observedRate: number | null;
}

/** Below this many total (probability, outcome) data points across every
 *  band, the record is too thin to characterise honestly — matches the
 *  ledger page's own "small samples are noisy" caveat rather than asserting
 *  a false confidence this early (§10). */
const MIN_CALIBRATION_POINTS = 30;

/** A weighted mean absolute gap under this (5 percentage points) reads as
 *  "well-calibrated"; at or above it, still honestly summarised but flagged
 *  as rougher. A judgement call for plain-language framing, not a formal
 *  statistical threshold. */
const WELL_CALIBRATED_GAP = 0.05;

/**
 * One honest, plain-language sentence summarising how well-calibrated the
 * record is — e.g. "When we say 60%, it lands about 58% of the time." —
 * derived ONLY from the same per-band figures the reliability diagram and
 * CalibrationTable already show (never a separate computation path that
 * could drift from what a visitor can verify on the same page). Shows ONLY
 * the displayed third-party model's calibration; `bins` must never be built
 * from the in-house Elo model (§9, enforced by buildCalibration() only ever
 * being called on the displayed-source rows — this function has no way to
 * tell the difference, so that guarantee lives at the call site).
 *
 * Picks the band with the most data points as the one named in the
 * sentence — the band the record can speak to most confidently — and is
 * honest about a too-small sample rather than a headline number nobody
 * should trust yet.
 */
export function calibrationRead(bins: CalibrationPoint[]): string {
  const populated = bins.filter(
    (b): b is CalibrationPoint & { predictedAvg: number; observedRate: number } =>
      b.n > 0 && b.predictedAvg !== null && b.observedRate !== null,
  );
  const total = populated.reduce((sum, b) => sum + b.n, 0);

  if (total === 0) {
    return 'No scored predictions yet, so there is nothing to check — calibration appears here once calls are scored.';
  }
  if (total < MIN_CALIBRATION_POINTS) {
    return `Only ${total} data point${total === 1 ? '' : 's'} scored so far — too early to say how well-calibrated the record is.`;
  }

  const weightedGap =
    populated.reduce(
      (sum, b) => sum + b.n * Math.abs(b.observedRate - b.predictedAvg),
      0,
    ) / total;
  const busiest = populated.reduce((a, b) => (b.n > a.n ? b : a));
  const predictedPct = pct(busiest.predictedAvg);
  const observedPct = pct(busiest.observedRate);

  if (weightedGap < WELL_CALIBRATED_GAP) {
    return `Well-calibrated overall — when we say ${predictedPct}, it lands about ${observedPct} of the time.`;
  }
  return `Roughly calibrated — when we say ${predictedPct}, it lands about ${observedPct} of the time, though some bands drift further from the diagonal than others.`;
}

/**
 * The honest one-line "I beat the model" read (kick plan #4) — ONLY ever
 * called when the visitor's own Brier is strictly lower than the model's for
 * the SAME fixture (a real, scored result — never a hypothetical). Prefers
 * the concrete, literal claim ("you gave X more credit than the model did")
 * when it's true; otherwise falls back to a claim that's always true by
 * construction (a lower Brier means the visitor's whole three-way spread was
 * closer to the true one-hot outcome than the model's was, even if no single
 * leg was individually higher).
 */
export function beatModelRead(
  userProbs: Probs,
  modelProbs: Probs,
  result: MatchResult,
  home: string,
  away: string,
): string {
  const name = outcomeName(result, home, away);
  const yours = probOf(userProbs, result);
  const models = probOf(modelProbs, result);
  if (yours > models) {
    return `You gave ${name} more credit than the model did (${pct(yours)} vs ${pct(models)}) — and you were right.`;
  }
  return `Your whole spread matched what happened more closely than the model's did — that's the win here, not any one number.`;
}
