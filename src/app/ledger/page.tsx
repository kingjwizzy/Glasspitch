import type { Metadata } from 'next';
import { ANALYSIS_NOT_ADVICE } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'Track record — the public prediction ledger',
  description:
    'Every prediction, locked at kickoff and scored after full-time — wins and losses. Mean Brier score, log loss and calibration, with sample-size caveats.',
  alternates: { canonical: '/ledger' },
};

export default function LedgerPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">The ledger</h1>
        <p className="mt-2 text-black/70 dark:text-white/70">
          Our identity is radical transparency. Every prediction is timestamped,
          locked at kickoff, and scored properly after full-time. The misses stay
          visible — permanently.
        </p>
      </header>

      <section
        aria-labelledby="record-heading"
        className="rounded-lg border border-black/10 p-4 dark:border-white/15"
      >
        <h2 id="record-heading" className="text-lg font-semibold">
          Running record
        </h2>
        {/* TODO(ARCHITECTURE.md §7, §10): query scored predictions and show the
            running record incl. losses, mean Brier score, mean log loss and a
            calibration table. Only locked + scored rows count; unlocked_void is
            excluded from the scored record (§5, §10). */}
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          The running record, mean Brier score, log loss and calibration will
          appear here.
        </p>
      </section>

      <p className="rounded-md bg-black/5 p-3 text-xs text-black/70 dark:bg-white/10 dark:text-white/70">
        <strong>Sample size matters.</strong> Small samples are noisy; these
        numbers only mean something over dozens-to-hundreds of scored
        predictions. We show the count alongside every metric so the record is
        honest about its own limits.
      </p>
      <p className="text-xs text-black/60 dark:text-white/60">
        {ANALYSIS_NOT_ADVICE}
      </p>
    </div>
  );
}
