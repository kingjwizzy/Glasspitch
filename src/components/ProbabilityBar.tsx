// Mobile-first stacked home/draw/away probability bar.
// Inputs are probabilities in [0, 1] that normally sum to ~1.0 (the §7 CHECK
// guarantees this for stored predictions).

export interface ProbabilityBarProps {
  home: number;
  draw: number;
  away: number;
  className?: string;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

const SEGMENTS = [
  { key: 'home', label: 'Home', color: 'bg-emerald-600' },
  { key: 'draw', label: 'Draw', color: 'bg-slate-500' },
  { key: 'away', label: 'Away', color: 'bg-indigo-600' },
] as const;

export default function ProbabilityBar({
  home,
  draw,
  away,
  className,
}: ProbabilityBarProps) {
  const values: Record<(typeof SEGMENTS)[number]['key'], number> = {
    home,
    draw,
    away,
  };
  // Guard against a zero sum so segment widths stay well-defined.
  const total = home + draw + away || 1;

  return (
    <div className={className}>
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10"
        role="img"
        aria-label={`Home ${pct(home)}, Draw ${pct(draw)}, Away ${pct(away)}`}
      >
        {SEGMENTS.map((s) => (
          <div
            key={s.key}
            className={s.color}
            style={{ width: `${(values[s.key] / total) * 100}%` }}
          />
        ))}
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
        {SEGMENTS.map((s) => (
          <div key={s.key}>
            <dt className="text-black/60 dark:text-white/60">{s.label}</dt>
            <dd className="font-semibold tabular-nums">{pct(values[s.key])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
