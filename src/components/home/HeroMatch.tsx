import Link from 'next/link';
import ProbabilityBar from '@/components/ProbabilityBar';
import { LockClosedIcon, LockOpenIcon } from '@/components/icons';
import { formatKickoff, scoreLine } from '@/lib/format';
import type { FixtureView } from '@/lib/queries/homepage';

// The featured match — the soonest upcoming fixture, or a live one if there is
// play right now (DESIGN.md §4 "matchday energy"). Shows our locked pre-match
// H/D/A call and predicted score. The "locked" framing is honest about state:
// an upcoming prediction LOCKS at kickoff; only live/finished ones ARE locked.

function LivePill() {
  // Solid red with dark text clears AA (≈4.96:1); the red tint behind red text
  // does not. The dot is decorative (the "Live" word carries the meaning).
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-live px-2.5 py-1 text-xs font-semibold text-bg">
      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bg opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-bg" />
      </span>
      Live
    </span>
  );
}

export default function HeroMatch({ fixture }: { fixture: FixtureView }) {
  const isLive = fixture.status === 'live';
  const pred = fixture.prediction;
  // Only a genuinely locked or scored prediction is immutable. A 'published'
  // row still locks AT kickoff; void rows are filtered out upstream, but gate
  // explicitly so the "can never be edited" claim is always true (§10 honesty).
  const locked = pred ? pred.status === 'locked' || pred.status === 'scored' : false;
  const hasLiveScore =
    isLive && fixture.final_home_goals !== null && fixture.final_away_goals !== null;

  return (
    <Link
      href={`/match/${fixture.id}`}
      className="block rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-fg/20 hover:bg-surface-2"
    >
      {/* meta row */}
      <div className="flex items-center justify-between gap-3 text-xs text-fg-dim">
        <span>{fixture.league}</span>
        {isLive ? (
          <LivePill />
        ) : (
          <time dateTime={fixture.kickoff_utc} className="font-mono">
            {formatKickoff(fixture.kickoff_utc)}
          </time>
        )}
      </div>

      {/* teams + score — one heading per match (cleaner for headings nav) */}
      <h3 className="mt-4 flex items-center gap-3 font-display text-xl font-semibold tracking-tight text-fg">
        <span className="flex-1 text-right">{fixture.home}</span>
        <span className="shrink-0 text-center">
          {hasLiveScore ? (
            <span className="font-mono text-2xl font-medium">
              {scoreLine(fixture.final_home_goals!, fixture.final_away_goals!)}
            </span>
          ) : (
            <span className="text-sm font-normal text-fg-dim">v</span>
          )}
        </span>
        <span className="flex-1 text-left">{fixture.away}</span>
      </h3>

      {/* our call */}
      {pred ? (
        <div className="mt-5">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <span className="text-xs text-fg-dim">
              {isLive ? 'Our locked pre-match call' : 'Our call'}
            </span>
            <span className="text-xs text-fg-dim">
              Predicted{' '}
              <span className="font-mono font-medium text-fg">
                {scoreLine(pred.predicted_home_goals, pred.predicted_away_goals)}
              </span>
            </span>
          </div>
          <ProbabilityBar
            home={pred.prob_home}
            draw={pred.prob_draw}
            away={pred.prob_away}
          />
          <p className="mt-3.5 flex items-center gap-1.5 text-xs text-fg-dim">
            {locked ? (
              <>
                <LockClosedIcon className="h-3.5 w-3.5 text-green" />
                Locked before kickoff — it can never be edited.
              </>
            ) : (
              <>
                <LockOpenIcon className="h-3.5 w-3.5" />
                Locks at kickoff, then scored in the public ledger.
              </>
            )}
          </p>
        </div>
      ) : (
        <p className="mt-5 text-sm text-fg-dim">
          Probabilities are published once the model has run.
        </p>
      )}
    </Link>
  );
}
