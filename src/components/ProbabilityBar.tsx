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
//  - `row`    — 6px bar + an 11px mono "H 54 · D 26 · A 20" line, labels always
//               printed (fixture rows / receipts).
//  - `compact`— legacy boolean: bar only (kept for existing callers).

import { pct, pctFigure } from '@/lib/format';

export type ProbabilityBarVariant = 'legend' | 'hero' | 'row';

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
}

const SEGMENTS = [
  { key: 'home', letter: 'H', label: 'Home', bar: 'bg-home', chip: 'bg-home' },
  { key: 'draw', letter: 'D', label: 'Draw', bar: 'bg-draw', chip: 'bg-draw' },
  { key: 'away', letter: 'A', label: 'Away', bar: 'bg-away', chip: 'bg-away' },
] as const;

const BAR_HEIGHT: Record<ProbabilityBarVariant, string> = {
  legend: 'h-2.5',
  hero: 'h-3',
  row: 'h-1.5',
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

  return (
    <div className={className}>
      <div
        className={`flex ${BAR_HEIGHT[variant]} w-full gap-0.5 overflow-hidden rounded-full`}
        role="img"
        aria-label={`Win probability — ${label}`}
      >
        {SEGMENTS.map((s) => (
          <div
            key={s.key}
            className={`${s.bar} h-full first:rounded-l-full last:rounded-r-full`}
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
          of the bar's accessible label, so hidden from the tree. */}
      {variant === 'row' && (
        <p
          aria-hidden="true"
          className="mt-1 font-mono text-[11px] leading-4 text-fg-dim"
        >
          H {pctFigure(home)} · D {pctFigure(draw)} · A {pctFigure(away)}
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
                <dd className="font-mono text-sm font-medium text-fg">
                  {pct(values[s.key])}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}
