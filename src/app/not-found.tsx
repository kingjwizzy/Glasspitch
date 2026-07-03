import type { Metadata } from 'next';
import Link from 'next/link';
import NotFoundArt from '@/components/art/NotFoundArt';

// Root 404 (ARCHITECTURE.md §11) for any unmatched top-level path. The three
// dynamic routes each carry their own themed not-found.tsx for their specific
// "not in our record" copy (match/team/league); this is the generic fallback
// for everything else, so no path ever falls through to Next's unthemed
// default 404. Renders inside the root layout, so the disclaimer banner,
// header and footer are already present.
export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      {/* The ball went wide (W6 visual pack) — decorative; the copy carries
          the meaning. */}
      <NotFoundArt className="mx-auto mb-6 h-28 w-auto" />
      <p className="font-mono text-sm text-fg-dim">404</p>
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-fg">
        Page not found
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-fg-dim">
        That one went wide of the post — the page may have moved, or the link
        may be out of date.
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
