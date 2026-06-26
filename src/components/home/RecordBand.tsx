import Link from 'next/link';
import { ArrowRightIcon } from '@/components/icons';
import type { RecordView } from '@/lib/queries/homepage';

// Running record band (DESIGN.md §4, ARCHITECTURE.md §10). Mean Brier + sample
// size, always with the honest "losses included" + small-sample caveat, linking
// to the first-class ledger. Lower Brier is better (0 perfect, 2 worst).

export default function RecordBand({ record }: { record: RecordView }) {
  const hasData = record.count > 0 && record.meanBrier !== null;

  return (
    <Link
      href="/ledger"
      className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface-2 p-5 transition-colors hover:border-fg/20"
    >
      {hasData ? (
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-medium text-fg">
              {record.meanBrier!.toFixed(2)}
            </span>
            <span className="text-sm text-fg-dim">mean Brier</span>
          </div>
          <p className="mt-1 text-xs text-fg-dim">
            Across{' '}
            <span className="font-mono text-fg-dim">{record.count}</span> scored
            predictions, losses included. Small samples are noisy — it only means
            something over hundreds.
          </p>
        </div>
      ) : (
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg">The record opens soon</p>
          <p className="mt-1 text-xs text-fg-dim">
            Brier score and calibration appear here once the first predictions
            are scored — wins and losses alike.
          </p>
        </div>
      )}
      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-green">
        Ledger
        <ArrowRightIcon className="h-4 w-4" />
      </span>
    </Link>
  );
}
