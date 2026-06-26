import Link from 'next/link';

// Themed 404 for an unknown / untracked league slug (ARCHITECTURE.md §11). The
// page read returns null for a missing league, which triggers notFound().
export default function LeagueNotFound() {
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <p className="font-mono text-sm text-fg-dim">404</p>
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-fg">
        League not found
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-fg-dim">
        We don&rsquo;t have this league in our record — it may not be a tracked
        tournament, or the link may be out of date.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-green px-4 text-sm font-medium text-bg transition-colors hover:bg-green-bright"
        >
          Back to matches
        </Link>
        <Link
          href="/ledger"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-4 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
        >
          See the track record
        </Link>
      </div>
    </div>
  );
}
