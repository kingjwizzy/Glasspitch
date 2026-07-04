import type { Metadata } from 'next';
import Link from 'next/link';
import AdSlot from '@/components/AdSlot';
import SectionHeader from '@/components/SectionHeader';
import LedgerTable from '@/components/ledger/LedgerTable';
import CalibrationTable from '@/components/ledger/CalibrationTable';
import EmptyStateSpot from '@/components/art/EmptyStateSpot';
import { getLedgerData } from '@/lib/queries/ledger';
import { pct } from '@/lib/format';
import { ANALYSIS_NOT_ADVICE, SITE_NAME, THIRD_PARTY_LABEL } from '@/lib/constants';

// SSR/ISR (ARCHITECTURE.md §11): re-render at most every 10 minutes so the record
// refreshes as calls are scored, with no per-visitor work and — like every web
// surface — NEVER a football-API call on the request path (§5 golden rule). The
// page reads only from Supabase. Metadata is static, so no generateMetadata/cache.
export const revalidate = 600;

const LEDGER_TITLE = 'Track record — the public prediction ledger';
const LEDGER_DESCRIPTION =
  'Every prediction, locked at kickoff and scored after full-time — wins and losses. Mean Brier score, log loss and calibration, with sample-size caveats.';

export const metadata: Metadata = {
  title: LEDGER_TITLE,
  description: LEDGER_DESCRIPTION,
  alternates: { canonical: '/ledger' },
  // Self-referential og:url + restated siteName (openGraph fully replaces the
  // layout's object — ARCHITECTURE.md §11).
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: LEDGER_TITLE,
    description: LEDGER_DESCRIPTION,
    url: '/ledger',
  },
  twitter: { card: 'summary_large_image', title: LEDGER_TITLE, description: LEDGER_DESCRIPTION },
};

function fmt(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

function Metric({
  value,
  label,
  caption,
}: {
  value: string;
  label: string;
  caption: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-4">
      <p className="font-mono text-3xl font-medium text-fg">{value}</p>
      <p className="mt-1 text-sm font-medium text-fg">{label}</p>
      <p className="mt-1 text-xs leading-relaxed text-fg-dim">{caption}</p>
    </div>
  );
}

export default async function LedgerPage() {
  const { summary, rows, calibration } = await getLedgerData();
  const hasRecord = summary.count > 0;

  return (
    <article className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          The ledger
        </h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-dim">
          Our identity is radical transparency. Every prediction is timestamped,
          locked at kickoff, and scored properly after full-time — wins and
          losses alike. The misses stay visible, permanently. See our{' '}
          <Link
            href="/methodology"
            className="text-green underline transition-colors hover:text-green-bright"
          >
            methodology
          </Link>{' '}
          for exactly how these numbers are computed.
        </p>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-fg-dim">
          And you don&rsquo;t have to take our word for it — every scored call
          is sealed into a public{' '}
          <Link
            href="/methodology#hash-chain"
            className="text-green underline transition-colors hover:text-green-bright"
          >
            SHA-256 hash chain
          </Link>
          , each row locking the one before it, so any change to a past result
          breaks the chain in a way anyone can check. Tamper-evident, not just
          promised.
        </p>
      </header>

      {!hasRecord ? (
        <section
          aria-labelledby="record-heading"
          className="rounded-2xl border border-line bg-surface p-5"
        >
          {/* Spot illustration (W6 visual pack) — decorative; the copy
              carries the meaning. */}
          <EmptyStateSpot variant="ledger" className="mb-4 h-16 w-auto" />
          <h2
            id="record-heading"
            className="font-display text-base font-semibold tracking-tight text-fg"
          >
            The record opens soon
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-fg-dim">
            No scored predictions yet. Once the first matches are locked at
            kickoff and finish, the running record, mean Brier score, log loss
            and calibration appear here — wins and losses alike.
          </p>
        </section>
      ) : (
        <>
          <section aria-labelledby="record-heading">
            <SectionHeader id="record-heading" title="Running record" />
            <div className="grid grid-cols-2 gap-3">
              <Metric
                value={fmt(summary.meanBrier)}
                label="Mean Brier score"
                caption="0 best, 2 worst — lower is better. Losses included."
              />
              <Metric
                value={fmt(summary.meanLogLoss)}
                label="Mean log loss"
                caption="Punishes confident misses — lower is better."
              />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-fg-dim">
              Across{' '}
              <span className="font-mono text-fg">{summary.count}</span> scored
              predictions — wins and losses alike. The outcome we leaned towards
              came in{' '}
              <span className="font-mono text-fg">{summary.hits}</span> of{' '}
              <span className="font-mono text-fg">{summary.count}</span>
              {summary.hitRate !== null && (
                <>
                  {' '}
                  (<span className="font-mono">{pct(summary.hitRate)}</span>)
                </>
              )}
              ; every miss is counted in full.
            </p>
          </section>

          <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
            <span className="font-medium text-fg">Sample size matters.</span>{' '}
            Small samples are noisy; these numbers only mean something over
            dozens-to-hundreds of scored predictions. We show the count alongside
            every metric so the record is honest about its own limits.
          </p>

          <section aria-labelledby="calibration-heading">
            <SectionHeader id="calibration-heading" title="Calibration" />
            <p className="mb-3 max-w-prose text-sm leading-relaxed text-fg-dim">
              Calibration asks a simple question: when we say 30%, does it happen
              about 30% of the time? Each band groups every home, draw and away
              probability we assigned, so {summary.count} matches give{' '}
              <span className="font-mono">{summary.count * 3}</span> data points.
              Well-calibrated means the two right-hand columns roughly agree.
            </p>
            <CalibrationTable bins={calibration} />
          </section>

          {/* Reserved ad slot — built-ready but renders nothing in v1 (§4, §13). */}
          <AdSlot slot="ledger-inline" />

          <section aria-labelledby="calls-heading">
            <SectionHeader id="calls-heading" title="Every scored call" />
            <LedgerTable rows={rows} />
            <p className="mt-2 text-xs leading-relaxed text-fg-dim">
              Newest first. Lower Brier is better (0 to 2). Tap any match for its
              full breakdown, including log loss.
            </p>
          </section>
        </>
      )}

      <div className="space-y-2 rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
        <p>{THIRD_PARTY_LABEL}</p>
        <p>{ANALYSIS_NOT_ADVICE}</p>
      </div>
    </article>
  );
}
