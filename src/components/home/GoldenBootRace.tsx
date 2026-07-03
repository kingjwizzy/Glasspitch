import { NationalityFlag } from '@/components/TeamFlag';
import type { TopScorerView } from '@/lib/queries/goldenBoot';

// Golden Boot race — home item 5 (DESIGN.md §4), W4 slot contract: a .glass
// card with ~320px reserved height (zero CLS while data arrives), a
// hairline-ruled table — rank gutter · name · nation · right-aligned mono
// goals — whose dense aligned-numbers texture is deliberately part of the
// instrument-panel register. No photos or crests (ARCHITECTURE.md §13);
// national flags beside the nationality are the W6 owner request ("flags
// now, faces eventually") and sit under the same W4 sanction as team flags —
// public-domain national symbols, decorative, plain text stays the
// identifier. Ties are shown honestly ("=3"); the empty state is the same
// table skeleton with em-dashes — never a spinner.

export default function GoldenBootRace({ scorers }: { scorers: TopScorerView[] }) {
  if (scorers.length === 0) {
    return (
      <div className="glass min-h-80 px-4 py-2">
        <ol aria-hidden="true" className="divide-y divide-line">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 py-3.5">
              <span className="w-6 shrink-0 font-mono text-sm text-fg-faint">—</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-fg-dim">—</p>
                <p className="text-xs text-fg-faint">—</p>
              </div>
              <span className="shrink-0 font-mono text-sm text-fg-dim">—</span>
            </li>
          ))}
        </ol>
        <p className="py-3 text-sm text-fg-dim">
          Top-scorer standings appear once the data pipeline first runs.
        </p>
      </div>
    );
  }

  // A rank shared by more than one player renders as "=N" on every tied row.
  const rankCounts = new Map<number, number>();
  for (const s of scorers) rankCounts.set(s.rank, (rankCounts.get(s.rank) ?? 0) + 1);

  return (
    <div className="glass min-h-80 px-4 py-1">
      <ol className="divide-y divide-line">
        {scorers.map((s) => {
          const tied = (rankCounts.get(s.rank) ?? 0) > 1;
          const top = s.rank === 1;
          return (
            <li key={`${s.rank}-${s.playerName}`} className="flex items-center gap-3 py-3">
              {/* Rank is inferable from order + goals — a hint, so faint + hidden
                  from the tree (fg-faint is reserved for non-essential text). */}
              <span
                className="w-6 shrink-0 font-mono text-sm text-fg-faint"
                aria-hidden="true"
              >
                {tied ? `=${s.rank}` : s.rank}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-base text-fg ${top ? 'font-medium' : ''}`}
                >
                  {s.playerName}
                </p>
                <p className="flex items-center gap-1.5 truncate text-[13px] text-fg-dim">
                  {s.nationality ? (
                    <>
                      <NationalityFlag
                        nationality={s.nationality}
                        className="h-3.5 w-3.5"
                      />
                      <span className="truncate">{s.nationality}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </p>
              </div>
              <span className="shrink-0 font-mono text-base font-medium text-fg">
                {s.goals}
                <span className="ml-1 text-xs font-normal text-fg-dim">
                  {s.goals === 1 ? 'goal' : 'goals'}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
