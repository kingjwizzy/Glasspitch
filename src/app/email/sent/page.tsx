import type { Metadata } from 'next';
import Link from 'next/link';

// Where the footer's subscribe form lands (static; ARCHITECTURE.md §5 v3
// email-capture amendment). Copy is deliberately address-agnostic — the form
// never reveals whether an address was already on the list.
export const metadata: Metadata = {
  title: 'Check your inbox',
  robots: { index: false, follow: false },
};

export default function EmailSentPage() {
  return (
    <article className="mx-auto max-w-xl space-y-4 py-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
        Check your inbox
      </h1>
      <p className="text-sm leading-relaxed text-fg-dim">
        If that address is new to us, a confirmation email is on its way.
        Nothing is ever sent until you click the link inside it — that&rsquo;s
        the double opt-in doing its job. No email? Check spam, or just try
        again from the footer.
      </p>
      <p className="text-sm leading-relaxed text-fg-dim">
        Every email we send has a one-click unsubscribe. Details in the{' '}
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
