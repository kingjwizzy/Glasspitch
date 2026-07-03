'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ANALYSIS_NOT_ADVICE } from '@/lib/constants';

// Route-level error boundary (ARCHITECTURE.md §11, §12). Renders INSIDE the
// root layout, so the persistent disclaimer banner, header and footer are
// already present — this only needs to own the content region. A themed
// fallback matters here specifically because the read layer deliberately
// THROWS on a transient DB failure (see src/lib/queries/*.ts's "throw so ISR
// retries" sentinel pattern) so ISR serves the last good cached page instead
// of a false empty state — which makes this boundary an expected code path,
// not a rare edge case.
//
// Next.js requires error.tsx to be a Client Component (it needs `reset()`,
// which re-renders the segment) — the one unavoidable exception to this
// lane's zero-client-JS content rule, since it is App Router infrastructure,
// not a content component.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side render errors are already logged by Next's server console;
    // this also surfaces the error in the browser console for this session.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <p className="font-mono text-sm text-fg-dim">500</p>
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-fg">
        Something went wrong
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-fg-dim">
        We couldn&rsquo;t load this page just now — it&rsquo;s likely a
        temporary problem on our side, not a change to the record. Try again
        in a moment.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-green px-4 text-sm font-medium text-bg transition-colors hover:bg-green-bright"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-4 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
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
      <p className="mt-8 text-xs leading-relaxed text-fg-dim">{ANALYSIS_NOT_ADVICE}</p>
    </div>
  );
}
