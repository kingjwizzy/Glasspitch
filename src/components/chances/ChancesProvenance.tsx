import { formatDateShort } from '@/lib/format';

// The provenance microline under every chances surface — the same "show your
// working" register as the ledger (ARCHITECTURE.md §10: print the sample
// size): how many Monte Carlo trials, which snapshot, and the cadence.

export default function ChancesProvenance({
  sims,
  snapshotDate,
}: {
  sims: number | null;
  snapshotDate: string | null;
}) {
  if (sims === null || snapshotDate === null) return null;
  return (
    <p className="mt-3 text-center font-mono text-[11px] leading-4 text-fg-dim">
      simulated {sims.toLocaleString('en-GB')} times · updated daily · snapshot{' '}
      {formatDateShort(`${snapshotDate}T00:00:00Z`)}
    </p>
  );
}
