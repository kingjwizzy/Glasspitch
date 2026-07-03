import type { Metadata } from 'next';
import Link from 'next/link';

// One-click unsubscribe landing (static; GDPR — ARCHITECTURE.md §5 v3
// email-capture amendment, §13). No guilt copy, no "are you sure" friction:
// the unsubscribe has ALREADY happened by the time this page renders.
export const metadata: Metadata = {
  title: 'Unsubscribed',
  robots: { index: false, follow: false },
};

export default function EmailUnsubscribedPage() {
  return (
    <article className="mx-auto max-w-xl space-y-4 py-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
        You&rsquo;re unsubscribed
      </h1>
      <p className="text-sm leading-relaxed text-fg-dim">
        Done — that took effect immediately, and your address has been removed
        from our mailing records entirely, not just muted. The full record
        stays free on the site whenever you want it, no inbox required.
      </p>
      <p className="text-sm leading-relaxed text-fg-dim">
        Changed your mind later? Just subscribe again from the site footer.
        Details in the{' '}
        <Link href="/privacy" className="text-green underline hover:text-green-bright">
          privacy notice
        </Link>
        .
      </p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center text-sm font-medium text-green transition-colors hover:text-green-bright"
      >
        Back to the site
      </Link>
    </article>
  );
}
