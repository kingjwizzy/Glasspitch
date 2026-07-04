// Home/draw/away probability bar — the core data primitive (DESIGN.md §2, §4).
//
// Colour-blind-safe by design: home = blue, draw = grey, away = amber (never the
// red↔green pair). And colour is NEVER the only signal — every outcome shows its
// letter (H/D/A) and its % as well, so the bar parses in greyscale (§2 hard rule).
// Inputs are probabilities in [0, 1] that sum to ~1.0 (the §7 CHECK guarantees it).
//
// W4 size variants:
//  - `legend` (default) — 10px bar + full H/D/A legend (match page surfaces).
//  - `hero`   — 12px bar only; the display-scale probability trio rendered
//               directly above it by FeaturedMatch carries the printed labels,
//               and the bar keeps the full accessible label.
//  - `row`    — 8px bar + an 11px mono "H 54 · D 26 · A 20" line, labels always
//               printed (fixture rows / receipts).
//  - `compact`— legacy boolean: bar only (kept for existing callers).
//
// RAMBO wave 3 #4: every variant's segments now sit in a `.prob-track`
// (bg-surface-2, globals.css) recessed groove so the stacked bar reads as one
// filled meter rather than floating chips; an optional `favoured` prop lets a
// caller bold the model's leaning outcome (row legend / legend dl) while the
// other two stay dim — every existing caller that omits it keeps its exact
// prior appearance. #9b: an opt-in `animated` prop glides segment widths for
// PickCard's live pick bar only; every other caller stays snap-rendered.

import { pct, pctFigure } from '@/lib/format';
import type { MatchResult } from '@/lib/types';

export type ProbabilityBarVariant = 'legend' | 'hero' | 'row';

/** What this bar's segments actually encode, for its `role="img"` accessible
 *  name (a11y audit fix):
 *   - `prediction` (default) — a probability split; keeps the existing
 *     "Win probability — …" name for every current caller, unchanged.
 *   - `result`     — a one-hot ACTUAL outcome (see SettledPickReveal's
 *     `ONE_HOT` map), rendered with this same component for a visual
 *     before/after pair. Without this, a screen reader hears the prediction
 *     name on both bars — e.g. "Win probability — Brazil 100%, draw 0%,
 *     Argentina 0%" for a bar that actually shows the final result, not a
 *     forecast. `result` instead announces "Final result — Brazil win" /
 *     "Final result — draw", derived from whichever segment is largest. */
export type ProbabilityBarSemantics = 'prediction' | 'result';

export interface ProbabilityBarProps {
  home: number;
  draw: number;
  away: number;
  className?: string;
  /** Bar only, no per-outcome legend (for dense rows). */
  compact?: boolean;
  variant?: ProbabilityBarVariant;
  /** Team names to show instead of the generic "Home"/"Away" wording, on the
   *  `legend` variant's per-outcome labels and the bar's accessible label —
   *  neutral-venue tournament matches make "home/away" a confusing signal, so
   *  any caller with team names in scope should pass them (owner UX decision,
   *  W6). Draw always reads "Draw"/"draw". Omit to keep the generic wording
   *  (every other caller/variant, unchanged). */
  homeLabel?: string;
  awayLabel?: string;
  /** See `ProbabilityBarSemantics`. Defaults to `'prediction'`, which
   *  preserves the accessible name every existing caller already gets. */
  semantics?: ProbabilityBarSemantics;
  /** The model's leaning outcome (RAMBO wave 3 #4b) — when given, the `row`
   *  variant's printed mono legend and the `legend` variant's per-outcome
   *  figures render that segment at `font-medium text-fg` while the other two
   *  stay `text-fg-dim`, so a returning fan can scan a list and read each
   *  call's lean at a glance. Omit to keep every existing caller's current,
   *  unweighted appearance exactly as-is (every outcome at equal weight). All
   *  three percentages stay printed either way (§1 honesty — colour/weight is
   *  never the only signal). */
  favoured?: MatchResult;
  /** Opt-in width transition on each segment (RAMBO wave 3 #9b), default OFF
   *  so every server-rendered bar on public pages stays pixel-identical.
   *  Intended ONLY for PickCard's live quick-pick/slider bar, where the
   *  segments visibly rebalance — a snap there reads as broken, not calm. The
   *  global `prefers-reduced-motion: reduce` kill-switch (globals.css) forces
   *  the transition duration to ~0 regardless of this prop. */
  animated?: boolean;
}

const SEGMENTS = [
  { key: 'home', letter: 'H', label: 'Home', bar: 'bg-home', chip: 'bg-home' },
  { key: 'draw', letter: 'D', label: 'Draw', bar: 'bg-draw', chip: 'bg-draw' },
  { key: 'away', letter: 'A', label: 'Away', bar: 'bg-away', chip: 'bg-away' },
] as const;

const BAR_HEIGHT: Record<ProbabilityBarVariant, string> = {
  legend: 'h-2.5',
  hero: 'h-3',
  // RAMBO wave 3 #4a: 6px → 8px — the old height left small segments reading
  // as slivers even seated in the new recessed track.
  row: 'h-2',
};

export default function ProbabilityBar({
  home,
  draw,
  away,
  className,
  compact = false,
  variant = 'legend',
  homeLabel,
  awayLabel,
  semantics = 'prediction',
  favoured,
  animated = false,
}: ProbabilityBarProps) {
  const values: Record<(typeof SEGMENTS)[number]['key'], number> = {
    home,
    draw,
    away,
  };
  // Guard against a zero sum so segment widths stay well-defined.
  const total = home + draw + away || 1;
  const homeWord = homeLabel ?? 'Home';
  const awayWord = awayLabel ?? 'away';
  const label = `${homeWord} ${pct(home)}, draw ${pct(draw)}, ${awayWord} ${pct(away)}`;

  // `result` bars are fed a one-hot trio (exactly one segment is the winner),
  // so "biggest segment" reliably recovers which outcome actually happened —
  // no separate "what happened" prop needed from callers.
  const resultWinner =
    home >= draw && home >= away ? 'home' : away >= draw && away >= home ? 'away' : 'draw';
  const resultPhrase =
    resultWinner === 'home' ? `${homeWord} win`
    : resultWinner === 'away' ? `${awayWord} win`
    : 'draw';
  const accessibleName =
    semantics === 'result' ? `Final result — ${resultPhrase}` : `Win probability — ${label}`;

  return (
    <div className={className}>
      <div
        className={`prob-track flex ${BAR_HEIGHT[variant]} w-full gap-0.5 overflow-hidden rounded-full`}
        role="img"
        aria-label={accessibleName}
      >
        {SEGMENTS.map((s) => (
          <div
            key={s.key}
            className={`${s.bar} h-full first:rounded-l-full last:rounded-r-full ${
              animated ? 'transition-[width] duration-300 ease-out' : ''
            }`}
            style={{
              width: `${(values[s.key] / total) * 100}%`,
              // A true 0% outcome renders no sliver — the bar must parse
              // truthfully in greyscale (DESIGN.md §2). Tiny non-zero outcomes
              // keep a 4px minimum so they stay visible.
              minWidth: values[s.key] > 0 ? '0.25rem' : undefined,
            }}
          />
        ))}
      </div>

      {/* Row variant: labels always printed as one aligned mono line. Duplicate
          of the bar's accessible label, so hidden from the tree. Each segment
          is its own span so the favoured outcome (if given) can render at
          font-medium text-fg while the rest stay text-fg-dim (RAMBO wave 3
          #4b) — omitting `favoured` keeps every span at the inherited
          text-fg-dim, i.e. today's unweighted appearance, unchanged. */}
      {variant === 'row' && (
        <p aria-hidden="true" className="mt-1 font-mono text-micro text-fg-dim">
          {SEGMENTS.map((s, i) => (
            <span key={s.key} className={favoured === s.key ? 'font-medium text-fg' : undefined}>
              {s.letter} {pctFigure(values[s.key])}
              {i < SEGMENTS.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </p>
      )}

      {variant === 'legend' && !compact && (
        <dl className="mt-2.5 grid grid-cols-3 gap-2 text-center">
          {SEGMENTS.map((s) => {
            // Team names replace the generic word when the caller has them in
            // scope (neutral-venue matches make "home/away" ambiguous); the
            // H/D/A chip stays as a secondary marker, never the sole signal.
            const outcomeText =
              s.key === 'home' ? (homeLabel ?? s.label)
              : s.key === 'away' ? (awayLabel ?? s.label)
              : s.label;
            // Favoured emphasis (RAMBO wave 3 #4b): only kicks in once a
            // caller passes `favoured` — every existing legend caller that
            // doesn't keeps today's uniform font-medium text-fg on all three.
            const ddCls = favoured
              ? favoured === s.key
                ? 'font-medium text-fg'
                : 'text-fg-dim'
              : 'font-medium text-fg';
            return (
              <div key={s.key} className="flex min-w-0 flex-col items-center gap-1">
                <dt className="flex min-w-0 items-center gap-1.5 text-xs text-fg-dim">
                  <span
                    aria-hidden="true"
                    className={`${s.chip} inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-[10px] font-semibold text-bg`}
                  >
                    {s.letter}
                  </span>
                  <span className="truncate">{outcomeText}</span>
                </dt>
                <dd className={`font-mono text-sm ${ddCls}`}>{pct(values[s.key])}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}
