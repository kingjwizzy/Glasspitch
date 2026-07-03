import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME, SUPPORT_EMAIL } from '@/lib/constants';

const TERMS_TITLE = 'Terms of use';
const TERMS_DESCRIPTION = 'The terms for using Glass Pitch and Glass Pitch Premium.';

export const metadata: Metadata = {
  title: TERMS_TITLE,
  description: TERMS_DESCRIPTION,
  alternates: { canonical: '/terms' },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: TERMS_TITLE,
    description: TERMS_DESCRIPTION,
    url: '/terms',
  },
  twitter: { card: 'summary_large_image', title: TERMS_TITLE, description: TERMS_DESCRIPTION },
};

export default function TermsPage() {
  return (
    <article className="space-y-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
        Terms of use
      </h1>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          Analysis, not advice
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          {SITE_NAME} publishes football analysis and probabilities — a
          predicted score, a home/draw/away split, and a written read for
          matches we track. This is analysis and probability, not a
          guarantee, and not regulated betting or financial advice. Outcomes
          are uncertain; we do not claim to beat the market, and we never
          imply a prediction solves money problems.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          18+
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          This is a gambling-adjacent product. You must be 18 or over to use
          it, and to create a Glass Pitch Premium account. See our{' '}
          <Link
            href="/responsible-gambling"
            className="text-green underline hover:text-green-bright"
          >
            responsible gambling
          </Link>{' '}
          page.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          Acceptable use
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          Don&rsquo;t try to break, scrape at abusive volume, reverse-engineer,
          or interfere with the site or its ledger; don&rsquo;t use it to
          harass anyone or to break the law. We may suspend or close an
          account that does.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          Subscriptions
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          Glass Pitch Premium is £4/month or £29/year, billed by our payment
          processor, Stripe, and renews automatically until you cancel.
          Cancel any time from your account&rsquo;s billing portal — cancelling
          is exactly as easy as subscribing, and you keep access until the end
          of the period you&rsquo;ve already paid for. The full prediction
          ledger and every match prediction stay free forever, whether or not
          you subscribe; Premium only adds depth content (fuller prediction
          detail, post-match stats) and ledger export/filter tools. See our{' '}
          <Link href="/refunds" className="text-green underline hover:text-green-bright">
            refunds
          </Link>{' '}
          page for cancellation and cooling-off terms.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          No warranty, limitation of liability
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          The site and its predictions are provided &ldquo;as is&rdquo;,
          without warranty of accuracy or availability. To the extent
          permitted by law, we&rsquo;re not liable for losses arising from
          your use of, or reliance on, the site or its content — this does not
          limit any liability that cannot be excluded under UK law (for
          example, for death or personal injury caused by negligence, or for
          fraud).
        </p>
      </section>

      <p className="text-sm text-fg-dim">
        Questions?{' '}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="underline decoration-fg-dim/40 underline-offset-2 transition-colors hover:text-fg"
        >
          {SUPPORT_EMAIL}
        </a>
      </p>

      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
        Draft pending professional (legal) review — this page has not yet been
        signed off and should not be relied on as final before that review
        completes.
      </p>
    </article>
  );
}
