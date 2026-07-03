import { formatKickoff } from '@/lib/format';
import type { MatchPrediction } from '@/lib/queries/match';

// The audit trail behind the lock-state prose (ARCHITECTURE.md §7, §10): the
// ledger claims "every prediction is timestamped" and "locked at kickoff, it
// can never be edited" (LockStatusLine) — this renders the actual clock times
// so those claims are dateable, not just asserted. Always UTC, matching every
// other timestamp on the site (lib/format.ts).

export default function AuditLine({ prediction }: { prediction: MatchPrediction }) {
  const isLocked = prediction.status === 'locked' || prediction.status === 'scored';
  const isScored = prediction.status === 'scored' && prediction.scored_at !== null;

  return (
    <p className="mt-2 text-xs leading-relaxed text-fg-dim">
      Published{' '}
      <time dateTime={prediction.published_at} className="font-mono">
        {formatKickoff(prediction.published_at)}
      </time>
      {' · '}
      {isLocked ? 'locked' : 'locks'}{' '}
      <time dateTime={prediction.locked_at} className="font-mono">
        {formatKickoff(prediction.locked_at)}
      </time>
      {isScored && (
        <>
          {' · scored '}
          <time dateTime={prediction.scored_at as string} className="font-mono">
            {formatKickoff(prediction.scored_at as string)}
          </time>
        </>
      )}
    </p>
  );
}
