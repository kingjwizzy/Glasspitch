import Link from 'next/link';
import ResultBadge from '@/components/ResultBadge';
import ProbabilityBar from '@/components/ProbabilityBar';
import TeamFlag from '@/components/TeamFlag';
import { formatTimeUtc, formatDateShort } from '@/lib/format';
import type { FixtureRowView } from '@/lib/queries/fixtures';

// One fixture row — the shared building block for the team, league and matches
// lists (DESIGN.md §4: one row = one match, full-row tap target). W4 anatomy:
// a fixed left status gutter (kickoff time over its date / "Full time" /
// live), two stacked team lines with typographic winner emphasis (winner keeps
// weight, loser dims — the no-crest answer), a right-aligned mono score column
// in a reserved slot (zero shift as the row morphs), and a slim H/D/A bar with
// its percentages always printed. Colour is never the only signal: the bar
// prints its numbers, the ✓/✗ badge carries an icon + aria-label, and the
// decorative flags are aria-hidden beside plain-text names (§13; national
// flags are sanctioned — see components/TeamFlag.tsx).

function StatusGutter({ f }: { f: FixtureRowView }) {
  if (f.status === 'live') {
    return (
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-live">
        <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
        </span>
        live
      </span>
    );
  }
  if (f.status === 'finished') {
    return (
      <span className="flex flex-col">
        <span className="text-[11px] leading-tight text-fg-dim">Full time</span>
        <time dateTime={f.kickoff_utc} className="mt-0.5 font-mono text-[11px] text-fg-dim">
          {formatDateShort(f.kickoff_utc)}
        </time>
      </span>
    );
  }
  if (f.status === 'postponed') {
    return <span className="text-[11px] leading-tight text-fg-dim">Postponed</span>;
  }
  return (
    <span className="flex flex-col">
      <time dateTime={f.kickoff_utc} className="font-mono text-sm text-fg">
        {formatTimeUtc(f.kickoff_utc)}
      </time>
      <span className="text-[11px] text-fg-dim">UTC</span>
    </span>
  );
}

export default function FixtureRow({ fixture: f }: { fixture: FixtureRowView }) {
  const pred = f.prediction;
  const hasScore =
    (f.status === 'finished' || f.status === 'live') &&
    f.final_home_goals !== null &&
    f.final_away_goals !== null;
  const result = f.actualResult;
  const homeCls =
    result === null || result === 'home' || result === 'draw'
      ? 'font-medium text-fg'
      : 'text-fg-dim';
  const awayCls =
    result === null || result === 'away' || result === 'draw'
      ? 'font-medium text-fg'
      : 'text-fg-dim';

  return (
    <li>
      <Link
        href={`/match/${f.id}`}
        className="block rounded-lg px-2 py-3 transition-colors hover:bg-surface-2"
      >
        <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-3">
          <StatusGutter f={f} />
          <div className="min-w-0 space-y-1">
            <p className={`flex items-center gap-2 truncate text-[15px] ${homeCls}`}>
              <TeamFlag name={f.home} />
              {f.home}
            </p>
            <p className={`flex items-center gap-2 truncate text-[15px] ${awayCls}`}>
              <TeamFlag name={f.away} />
              {f.away}
            </p>
          </div>
          {/* Reserved score slot — filled once there is a score. */}
          <div className="w-5 space-y-1 text-right font-mono text-[15px] font-medium text-fg">
            {hasScore ? (
              <>
                <p className={result === 'away' ? 'text-fg-dim' : ''}>
                  {f.final_home_goals}
                </p>
                <p className={result === 'home' ? 'text-fg-dim' : ''}>
                  {f.final_away_goals}
                </p>
              </>
            ) : null}
          </div>
        </div>

        <div className="mt-2 flex items-end gap-3 pl-[calc(3.5rem+0.75rem)]">
          {pred ? (
            <ProbabilityBar
              variant="row"
              home={pred.prob_home}
              draw={pred.prob_draw}
              away={pred.prob_away}
              className="min-w-0 max-w-56 flex-1"
            />
          ) : (
            <span className="flex-1 text-xs text-fg-dim">Call pending</span>
          )}
          {/* ✓/✗ only for a scored prediction with a resolved hit (§10). */}
          {pred !== null && f.hit !== null && <ResultBadge hit={f.hit} />}
        </div>
      </Link>
    </li>
  );
}
