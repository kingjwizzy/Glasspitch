import Link from 'next/link';
import { ArrowRightIcon } from '@/components/icons';
import LedgerPipeline from '@/components/home/LedgerPipeline';
import { metric3 } from '@/lib/format';
import type { RecordView } from '@/lib/queries/homepage';

// The record band — the accountability end-cap (W4 spec §6; DESIGN.md §4 item
// 6), the page's third and final .glass-raised surface. Display-scale stats
// with the sample size stated plainly (small-n honesty, no smoothed gravitas),
// and a CSS-only baseline strip comparing our mean Brier with the
// always-guessing ⅓/⅓/⅓ baseline (0.667). Neutral markers + mono labels — the
// H/D/A colours are reserved for data and semantic green for ✓ only.

// Track scale: 0 (perfect, left) … 0.8 (right) — keeps the 0.667 baseline
// marker inside the track with honest room to its right.
const TRACK_MAX = 0.8;
const BASELINE = 2 / 3;

function trackPct(value: number): number {
  return Math.min(Math.max((value / TRACK_MAX) * 100, 2), 98);
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="font-mono text-[32px] font-medium leading-none text-fg">{value}</p>
      <p className="mt-1.5 text-[13px] text-fg-dim">{label}</p>
    </div>
  );
}

export default function RecordBand({ record }: { record: RecordView }) {
  const hasData = record.count > 0 && record.meanBrier !== null;

  return (
    <div className="glass-raised p-5 lg:p-8">
      <div className="grid gap-8 lg:grid-cols-12 lg:items-center">
        {/* Headline zone. */}
        <div className="lg:col-span-4">
          <h2
            id="record-heading"
            className="font-display text-2xl font-semibold tracking-tight text-fg"
          >
            The record so far
          </h2>
          <p className="mt-1.5 max-w-[38ch] text-sm text-fg-dim">
            Would guessing do better? Compare us with the always-guessing
            baseline — misses included.
          </p>
          <Link
            href="/ledger"
            className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-green transition-colors hover:text-green-bright"
          >
            See the ledger
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>

        {hasData ? (
          <>
            {/* Stat trio at display scale, n stated plainly. */}
            <div className="flex flex-wrap gap-x-10 gap-y-6 lg:col-span-4">
              <Stat value={String(record.count)} label="scored calls" />
              <Stat value={metric3(record.meanBrier!)} label="mean Brier" />
              <Stat
                value={record.meanLogLoss !== null ? metric3(record.meanLogLoss) : '—'}
                label="mean log loss"
              />
              <p className="w-full text-[13px] text-fg-dim">
                across <span className="font-mono">{record.count}</span> scored{' '}
                {record.count === 1 ? 'call' : 'calls'} — small samples are noisy.
              </p>
            </div>

            {/* Baseline strip — CSS only, neutral markers, mono labels. */}
            <div className="lg:col-span-4">
              <div className="relative mt-2 h-1.5 rounded-full bg-surface-2">
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg-dim"
                  style={{ left: `${trackPct(record.meanBrier!)}%` }}
                />
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-fg-dim bg-bg"
                  style={{ left: `${trackPct(BASELINE)}%` }}
                />
              </div>
              <dl className="mt-3 space-y-1 font-mono text-[11px] leading-4 text-fg-dim">
                <div className="flex items-center gap-2">
                  <dt className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full bg-fg-dim"
                    />
                    Glass Pitch
                  </dt>
                  <dd>{metric3(record.meanBrier!)}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <dt className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full border border-fg-dim bg-bg"
                    />
                    always guessing ⅓ / ⅓ / ⅓
                  </dt>
                  <dd>0.667</dd>
                </div>
              </dl>
              <p className="mt-3 text-[13px] leading-relaxed text-fg-dim">
                Lower is better. When we say 70%, it should happen about 70% of the
                time — the ledger shows whether it does.
              </p>
            </div>
          </>
        ) : (
          /* Young ledger: structural honesty, never invented numbers. */
          <div className="lg:col-span-8">
            <LedgerPipeline />
            <p className="mt-3 max-w-prose text-sm text-fg-dim">
              The record opens after the first final whistle — Brier score, log loss
              and calibration, misses included. Every prediction is locked at kickoff
              and the ledger cannot be edited, not even by us.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
