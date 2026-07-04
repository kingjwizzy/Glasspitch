import Link from 'next/link';
import { ArrowRightIcon, CheckIcon, CrossIcon } from '@/components/icons';
import LedgerPipeline from '@/components/home/LedgerPipeline';
import WorkedExample from '@/components/home/WorkedExample';
import { metric3 } from '@/lib/format';
import type { RecentCallView, RecordView } from '@/lib/queries/homepage';

// The ledger proof rail (W4 spec §1) — beside the featured match at lg, below
// it on mobile, so the moat is visible in the first viewport: scored counts,
// mean Brier, the last ~10 ✓/✗ receipts, and the immutability sentence.
//
// EMPTY STATE (young ledger, RAMBO wave 3 #3a): never fake data — a static
// pipeline (lock → whistle → scored) plus a clearly-labelled worked example
// that teaches the mechanism instead of rendering blank em-dashes at exactly
// the moment first-visit traffic peaks. The pipeline is decorative
// (aria-hidden); the worked example and sentence carry the meaning.

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass p-3 lg:p-4">
      <p className="font-mono text-2xl font-medium leading-none text-fg">{value}</p>
      <p className="mt-1.5 text-[13px] text-fg-dim">{label}</p>
    </div>
  );
}

function EmptyRail() {
  return (
    <div className="glass p-4">
      {/* lock → whistle → scored, fully static. */}
      <LedgerPipeline />
      <WorkedExample className="mt-3" />
      <p className="mt-3 text-sm text-fg-dim">
        First calls lock at kickoff and get scored here — misses included.
      </p>
    </div>
  );
}

export default function ProofRail({
  calls,
  record,
}: {
  calls: RecentCallView[];
  record: RecordView;
}) {
  const hasRecord = record.count > 0;

  return (
    <div className="flex h-full flex-col gap-3">
      <h2 className="sr-only">Our record at a glance</h2>

      {/* Three stat tiles — mono figures, sentence-case labels. Em-dashes,
          never invented numbers, while the ledger is young. Stagger steps 2–3
          of the once-on-load hero rise (kicker 0, featured card 1). */}
      <div className="rise-in rise-in-2 grid grid-cols-3 gap-3">
        <StatTile
          label="predictions scored"
          value={hasRecord ? String(record.count) : '—'}
        />
        <StatTile
          label="mean Brier"
          value={record.meanBrier !== null ? metric3(record.meanBrier) : '—'}
        />
        <StatTile
          label="most-likely outcome landed"
          value={hasRecord ? `${record.hits} of ${record.count}` : '—'}
        />
      </div>

      {/* The ✓/✗ receipts strip — each chip links to its match page; the glyph
          always present, so colour is never the only signal (DESIGN.md §2). */}
      {calls.length > 0 ? (
        <div className="rise-in rise-in-3 glass p-4">
          <ul className="flex gap-2 overflow-x-auto">
            {calls.map((c) => (
              <li key={c.id} className="shrink-0">
                <Link
                  href={`/match/${c.fixtureId}`}
                  aria-label={`${c.home} v ${c.away} — ${c.hit ? 'correct call' : 'missed call'}`}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${
                    c.hit ? 'bg-green/15 text-green' : 'bg-miss/15 text-miss'
                  }`}
                >
                  {c.hit ? (
                    <CheckIcon className="h-4 w-4" />
                  ) : (
                    <CrossIcon className="h-4 w-4" />
                  )}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-fg-dim">
            Every prediction is published before kickoff and locked at
            kickoff, then sealed into a public{' '}
            <Link
              href="/methodology#hash-chain"
              className="text-green underline transition-colors hover:text-green-bright"
            >
              SHA-256 hash chain
            </Link>{' '}
            — tamper-evident, not just promised.
          </p>
        </div>
      ) : (
        <EmptyRail />
      )}

      <Link
        href="/ledger"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-green transition-colors hover:text-green-bright"
      >
        See the full ledger
        <ArrowRightIcon className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
