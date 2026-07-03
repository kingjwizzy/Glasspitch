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
}: ProbabilityBarProps) {
  const values: Record<(typeof SEGMENTS)[number]['key'], number> = {
    home,
    draw,
    away,
  };
  // Guard against a zero sum so segment widths stay well-defined.
  const total = home + draw + away || 1;
  const label = `Home ${pct(home)}, draw ${pct(draw)}, away ${pct(away)}`;

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
          {SEGMENTS.map((s) => (
            <div key={s.key} className="flex flex-col items-center gap-1">
              <dt className="flex items-center gap-1.5 text-xs text-fg-dim">
                <span
                  aria-hidden="true"
                  className={`${s.chip} inline-flex h-4 w-4 items-center justify-center rounded-[3px] text-[10px] font-semibold text-bg`}
                >
                  {s.letter}
                </span>
                {s.label}
              </dt>
              <dd className="font-mono text-sm font-medium text-fg">
                {pct(values[s.key])}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
