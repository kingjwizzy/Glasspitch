import Link from 'next/link';
import ProbabilityBar from '@/components/ProbabilityBar';
import { favoured, formatKickoff, pct } from '@/lib/format';
import type { MatchResult } from '@/lib/types';
import type { FixtureView } from '@/lib/queries/homepage';

// Compact, scannable fixture rows — one match per row, full-row tap target
// (DESIGN.md §4, pattern brief: one row = one match). The favoured outcome + one
// number is the quick read; the slim bar gives the H/D/A shape at a glance.

const PICK: Record<MatchResult, { letter: string; chip: string }> = {
  home: { letter: 'H', chip: 'bg-home' },
  draw: { letter: 'D', chip: 'bg-draw' },
  away: { letter: 'A', chip: 'bg-away' },
};

function FixtureRow({ f }: { f: FixtureView }) {
  const pred = f.prediction;
  const fav = pred
    ? favoured({ home: pred.prob_home, draw: pred.prob_draw, away: pred.prob_away })
    : null;

  return (
    <li>
      <Link
        href={`/match/${f.id}`}
        className="flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface-2"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-fg">
            {f.home} <span className="text-fg-dim">v</span> {f.away}
          </p>
          <p className="mt-0.5 font-mono text-xs text-fg-dim">
            {formatKickoff(f.kickoff_utc)}
          </p>
        </div>

        {pred && fav ? (
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="flex items-center gap-1.5" aria-hidden="true">
              <span
                className={`${PICK[fav.key].chip} inline-flex h-4 w-4 items-center justify-center rounded-[3px] text-[10px] font-semibold text-bg`}
              >
                {PICK[fav.key].letter}
              </span>
              <span className="font-mono text-sm font-medium text-fg">
                {pct(fav.prob)}
              </span>
            </span>
            <ProbabilityBar
              compact
              home={pred.prob_home}
              draw={pred.prob_draw}
              away={pred.prob_away}
              className="w-24"
            />
          </div>
        ) : (
          <span className="shrink-0 text-xs text-fg-dim">Call pending</span>
        )}
      </Link>
    </li>
  );
}

export default function UpcomingFixtures({ fixtures }: { fixtures: FixtureView[] }) {
  if (fixtures.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-6 text-sm text-fg-dim">
        No upcoming fixtures right now — they&rsquo;ll appear here as soon as the
        next matches are scheduled.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-surface px-2">
      {fixtures.map((f) => (
        <FixtureRow key={f.id} f={f} />
      ))}
    </ul>
  );
}
