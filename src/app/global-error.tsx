'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import './globals.css';
import { ANALYSIS_NOT_ADVICE, DISCLAIMER, SITE_NAME } from '@/lib/constants';

// Root-layout error boundary (ARCHITECTURE.md §11, §12). Only fires if the ROOT
// LAYOUT ITSELF throws (vs. src/app/error.tsx, which handles everything else
// and renders inside a working layout) — so, unlike every other page in this
// lane, it must define its own <html>/<body> and cannot rely on the root
// layout's Header/Footer/DisclaimerBanner having rendered. The disclaimer line
// is restated verbatim here for exactly that reason: it must never depend on a
// layout that just failed (ARCHITECTURE.md §13 — present on every page, no
// exceptions).
//
// Next.js requires global-error.tsx to be a Client Component (it needs
// `reset()`) — the one unavoidable exception to this lane's zero-client-JS
// content rule, since it is App Router infrastructure, not a content
// component. Deliberately minimal (no next/font, no nested components) so it
// has as few failure modes of its own as possible.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="flex min-h-full flex-col items-center justify-center bg-bg px-4 py-12 text-center text-fg">
        <div className="mx-auto max-w-md">
          <p className="font-mono text-sm text-fg-dim">500</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
            {SITE_NAME} hit a problem
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-fg-dim">
            Something went wrong loading the site — it&rsquo;s likely
            temporary, not a change to the record. Try again in a moment.
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
              Back to home
            </Link>
          </div>
          <p className="mt-8 text-xs leading-relaxed text-fg-dim">{DISCLAIMER}</p>
          <p className="mt-2 text-xs leading-relaxed text-fg-dim">{ANALYSIS_NOT_ADVICE}</p>
        </div>
      </body>
    </html>
  );
}
