import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from '@/lib/auth/viewer';
import { getFullLedgerRows } from '@/lib/queries/ledger';
import { getAllLeagueOptions } from '@/lib/queries/league';
import LedgerTable from '@/components/ledger/LedgerTable';
import { ANALYSIS_NOT_ADVICE } from '@/lib/constants';
import type { MatchResult } from '@/lib/types';

// /premium/ledger — the premium ledger VIEW: league/result filters and a CSV
// export link over the same free-forever ledger data (ARCHITECTURE.md §4 v2).
// The plain /ledger page is untouched; this is an additive, gated
// convenience, not a re-gating of the underlying record. Dynamic + authed;
// middleware redirects an anonymous visitor to /login, and the premium check
// below (not middleware, which only checks "signed in") decides whether the
// filtered table renders or a plain upgrade note does.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Premium ledger',
  robots: { index: false, follow: false },
};

const RESULT_OPTIONS: Array<{ value: MatchResult | ''; label: string }> = [
  { value: '', label: 'Every result' },
  { value: 'home', label: 'Home win' },
  { value: 'draw', label: 'Draw' },
  { value: 'away', label: 'Away win' },
];

function parseResult(raw: string | undefined): MatchResult | undefined {
  return raw === 'home' || raw === 'draw' || raw === 'away' ? raw : undefined;
}

interface PremiumLedgerPageProps {
  searchParams: Promise<{ league?: string; result?: string }>;
}

export default async function PremiumLedgerPage({ searchParams }: PremiumLedgerPageProps) {
  const { user, isPremium } = await getViewer();
  if (!user) redirect('/login?next=/premium/ledger');

  const { league, result } = await searchParams;
  const leagueOptions = await getAllLeagueOptions();

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Premium ledger
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-fg-dim">
          The same free, full scored record as{' '}
          <Link href="/ledger" className="text-green underline hover:text-green-bright">
            /ledger
          </Link>{' '}
          — filterable here, with a full CSV export.
        </p>
      </header>

      {!isPremium ? (
        <div className="rounded-2xl border border-line bg-surface p-5">
          <p className="text-sm leading-relaxed text-fg-dim">
            League/result filters and CSV export are part of Glass Pitch
            Premium — £4/month or £29/year. Every prediction and the full
            record stay free on{' '}
            <Link href="/ledger" className="text-green underline hover:text-green-bright">
              /ledger
            </Link>{' '}
            regardless.{' '}
            <Link href="/premium" className="text-green underline hover:text-green-bright">
              See what&rsquo;s included
            </Link>
            .
          </p>
        </div>
      ) : (
        <FilteredLedger league={league} result={parseResult(result)} leagueOptions={leagueOptions} />
      )}

      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
        {ANALYSIS_NOT_ADVICE}
      </p>
    </article>
  );
}

async function FilteredLedger({
  league,
  result,
  leagueOptions,
}: {
  league: string | undefined;
  result: MatchResult | undefined;
  leagueOptions: Array<{ name: string; slug: string }>;
}) {
  const supabase = await createClient();
  const rows = await getFullLedgerRows(supabase, { league, result });

  return (
    <>
      <form method="GET" className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="league" className="block text-xs text-fg-dim">
            League
          </label>
          <select
            id="league"
            name="league"
            defaultValue={league ?? ''}
            className="min-h-11 rounded-xl border border-line bg-surface-2 px-3 text-sm text-fg"
          >
            <option value="">Every league</option>
            {leagueOptions.map((l) => (
              <option key={l.slug} value={l.slug}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="result" className="block text-xs text-fg-dim">
            Result
          </label>
          <select
            id="result"
            name="result"
            defaultValue={result ?? ''}
            className="min-h-11 rounded-xl border border-line bg-surface-2 px-3 text-sm text-fg"
          >
            {RESULT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-green px-4 text-sm font-medium text-bg transition-colors hover:bg-green-bright"
        >
          Apply filters
        </button>

        {(league || result) && (
          <Link
            href="/premium/ledger"
            className="inline-flex min-h-11 items-center text-sm font-medium text-fg-dim underline transition-colors hover:text-fg"
          >
            Clear
          </Link>
        )}
      </form>

      <p className="text-sm text-fg-dim">
        <span className="font-mono text-fg">{rows.length}</span> scored calls
        match this filter.
      </p>

      {rows.length > 0 && <LedgerTable rows={rows} />}

      <a
        href="/api/premium/ledger.csv"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-green transition-colors hover:text-green-bright"
      >
        Download the full ledger as CSV
      </a>
    </>
  );
}
