import ResultBadge from '@/components/ResultBadge';
import ProbabilityBar from '@/components/ProbabilityBar';
import { pct, scoreLine } from '@/lib/format';

// A fixed, clearly-labelled worked example of one scored call (RAMBO wave 3
// #3a) — shown only on the young/empty ledger surfaces (ProofRail, RecordBand,
// RecentCalls) so a first-time visitor can see the immutable-ledger loop in
// action before any real call has been scored. NEVER presented as real data
// (DESIGN.md §2): the teams are generic placeholders no visitor could mistake
// for an actual fixture, "example" is stated twice, and the card is styled
// with a dashed border — deliberately distinct from the solid card real
// receipts use — so the difference is visible even without reading the copy.

export default function WorkedExample({ className }: { className?: string }) {
  return (
    <div
      className={`rounded-xl border border-dashed border-line p-3 ${className ?? ''}`}
    >
      <p className="text-small font-medium text-fg-dim">
        Example call — not a real match
      </p>
      <p className="mt-1.5 text-small text-fg-dim">
        <span className="font-medium text-fg">Team A</span> v{' '}
        <span className="font-medium text-fg">Team B</span> — we said draw{' '}
        <span className="font-mono text-fg">{pct(0.34)}</span>
      </p>
      <div className="mt-2 flex items-center gap-3">
        <ProbabilityBar
          variant="row"
          home={0.33}
          draw={0.34}
          away={0.33}
          className="max-w-40 flex-1"
        />
        <span className="font-mono text-small font-medium text-fg">
          {scoreLine(1, 1)}
        </span>
        <ResultBadge hit />
      </div>
      <p className="mt-2 text-micro text-fg-dim">
        Published before kickoff, locked at kickoff, scored after full time —
        illustrative only.
      </p>
    </div>
  );
}
