import Link from 'next/link';
import { ArrowRightIcon } from '@/components/icons';

// Quiet callout to the first-class ledger (DESIGN.md §4, ARCHITECTURE.md §10).
// The match page proves one call; the ledger proves the whole record, losses
// included — that link is the trust path.
export default function LedgerCallout() {
  return (
    <Link
      href="/ledger"
      className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface-2 p-5 transition-colors hover:border-fg/20"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">Every call is on the record</p>
        <p className="mt-1 text-xs text-fg-dim">
          Wins and losses alike, locked at kickoff and scored — see the full
          track record.
        </p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-green">
        Ledger
        <ArrowRightIcon className="h-4 w-4" />
      </span>
    </Link>
  );
}
