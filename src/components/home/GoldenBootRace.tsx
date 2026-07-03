import type { TopScorerView } from '@/lib/queries/goldenBoot';

// Golden Boot race — home item 5 (DESIGN.md §4): top scorers, name · nation ·
// goals, text and numbers only (no photos/crests — ARCHITECTURE.md §13). Mono
// figures for the goal counts (DESIGN.md §3 "we take our numbers seriously").
// Honest empty state (DESIGN.md §9) while the data pipeline hasn't run yet.

export default function GoldenBootRace({ scorers }: { scorers: TopScorerView[] }) {
  if (scorers.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-6 text-sm text-fg-dim">
        Top-scorer standings appear once the data pipeline first runs.
      </p>
    );
  }

  return (
    <ol className="divide-y divide-line rounded-xl border border-line bg-surface px-4">
      {scorers.map((s) => (
        <li key={`${s.rank}-${s.playerName}`} className="flex items-center gap-3 py-3">
          <span className="w-5 shrink-0 font-mono text-sm text-fg-dim" aria-hidden="true">
            {s.rank}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">{s.playerName}</p>
            <p className="truncate text-xs text-fg-dim">{s.nationality ?? '—'}</p>
          </div>
          <span className="shrink-0 font-mono text-sm font-medium text-fg">
            {s.goals}
            <span className="ml-1 text-xs font-normal text-fg-dim">
              {s.goals === 1 ? 'goal' : 'goals'}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
