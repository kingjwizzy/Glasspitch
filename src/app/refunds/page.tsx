import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME } from '@/lib/constants';

const REFUNDS_TITLE = 'Cancellations & refunds';
const REFUNDS_DESCRIPTION =
  'How to cancel Glass Pitch Premium, and your UK consumer rights on refunds.';

export const metadata: Metadata = {
  title: REFUNDS_TITLE,
  description: REFUNDS_DESCRIPTION,
  alternates: { canonical: '/refunds' },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: REFUNDS_TITLE,
    description: REFUNDS_DESCRIPTION,
    url: '/refunds',
  },
  twitter: { card: 'summary_large_image', title: REFUNDS_TITLE, description: REFUNDS_DESCRIPTION },
};

export default function RefundsPage() {
  return (
    <article className="space-y-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
        Cancellations & refunds
      </h1>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          Cancelling
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          Cancel Glass Pitch Premium any time from{' '}
          <Link href="/account" className="text-green underline hover:text-green-bright">
            your account
          </Link>{' '}
          via &ldquo;Manage billing&rdquo; (the Stripe Customer Portal) —
          cancelling is exactly as easy as subscribing, with no phone call and
          no retention pitch. When you cancel, you keep Premium access until
          the end of the period you&rsquo;ve already paid for; it then simply
          doesn&rsquo;t renew.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          Your 14-day cooling-off right
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          Under UK consumer law you normally have 14 days from subscribing to
          cancel a distance contract for a full refund. Glass Pitch Premium is
          digital content that starts being made available to you immediately
          on subscribing (deeper prediction detail, post-match stats and
          ledger tools become available straight away). By subscribing, you
          confirm you want that access to start immediately, and you
          acknowledge that doing so means you lose the right to cancel for a
          refund once the content has started being provided, in line with UK
          digital-content rules. If you believe you were charged in error,
          contact us and we&rsquo;ll look into it.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          {SITE_NAME} stays honest either way
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          The full prediction ledger and every match prediction stay free and
          public, subscribed or not — cancelling Premium never takes away
          anything from the free product, and subscribing never changes what
          the model predicts.
        </p>
      </section>

      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
        Draft pending professional (legal) review — this page has not yet been
        signed off and should not be relied on as final before that review
        completes.
      </p>
    </article>
  );
}
