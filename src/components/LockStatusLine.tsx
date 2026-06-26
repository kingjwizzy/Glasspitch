import { LockClosedIcon, LockOpenIcon } from '@/components/icons';
import type { PredictionStatus } from '@/lib/types';

// The lock-state honesty line under a prediction (ARCHITECTURE.md §7, §10).
// Shared by the home hero and the match page so this compliance-bearing copy
// has a single source and cannot drift between the two surfaces.
//
// Only a genuinely locked or scored row is immutable; a 'published' row still
// LOCKS at kickoff (void rows are filtered upstream and never reach here). The
// `locked` predicate lives here so the "can never be edited" claim is always
// true wherever it is shown.

/** Whether a prediction in this status is already immutable (§10). */
export function isLocked(status: PredictionStatus): boolean {
  return status === 'locked' || status === 'scored';
}

export default function LockStatusLine({
  status,
  className,
}: {
  status: PredictionStatus;
  className?: string;
}) {
  return (
    <p className={`flex items-center gap-1.5 text-xs text-fg-dim ${className ?? ''}`}>
      {isLocked(status) ? (
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
  );
}
