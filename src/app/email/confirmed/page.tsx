import type { Metadata } from 'next';
import Link from 'next/link';

// Double-opt-in success (static; ARCHITECTURE.md §5 v3 email-capture
// amendment).
export const metadata: Metadata = {
  title: 'Email confirmed',
  robots: { index: false, follow: false },
};

export default function EmailConfirmedPage() {
  return (
    <article className="mx-auto max-w-xl space-y-4 py-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
        You&rsquo;re on the list
      </h1>
      <p className="text-sm leading-relaxed text-fg-dim">
        Confirmed. You&rsquo;ll get one plain email after each matchday with
        the scored record — wins and losses at identical prominence, the same
        as the site itself. Nothing else, no more often.
      </p>
      <p className="text-sm leading-relaxed text-fg-dim">
        Changed your mind? Every email has a one-click unsubscribe that works
        immediately.
      </p>
      <Link
        href="/ledger"
        className="inline-flex min-h-11 items-center text-sm font-medium text-green transition-colors hover:text-green-bright"
      >
        See the record so far
      </Link>
    </article>
  );
}
