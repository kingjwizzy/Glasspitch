import type { Metadata } from 'next';
import Link from 'next/link';
import { getViewer } from '@/lib/auth/viewer';
import { plansConfigured } from '@/lib/stripe/plans';
import { ANALYSIS_NOT_ADVICE, RESPONSIBLE_GAMBLING } from '@/lib/constants';

// /premium — the pricing page (ARCHITECTURE.md §4 v2). Noindexed, out of the
// public nav and the sitemap until the owner flips premium live post-Stripe-
// vetting and legal sign-off (§13). Every rule in DESIGN.md §6 applies
// verbatim: state plainly what premium contains and the price, state that the
// ledger and every prediction stay free forever, no urgency, no dark
// patterns, no more than one quiet upgrade affordance — here, the two plain
// Checkout buttons ARE the page's purpose, so nothing else competes with them.
export const metadata: Metadata = {
  title: 'Premium',
  description: 'What Glass Pitch Premium adds, and what stays free forever.',
  robots: { index: false, follow: false },
};

const INCLUDED = [
  {
    title: 'Prediction detail',
    body: 'The fuller breakdown behind each locked call, per fixture.',
  },
  {
    title: 'Post-match stats',
    body: 'Deeper stats once a match finishes, alongside the scored result.',
  },
  {
    title: 'Ledger CSV export',
    body: 'Download the full scored record for your own analysis.',
  },
  {
    title: 'Ledger filters',
    body: 'Filter the record by league and result.',
  },
] as const;

function PlanForm({
  plan,
  price,
  cadence,
}: {
  plan: 'monthly' | 'annual';
  price: string;
  cadence: string;
}) {
  return (
    <form action="/api/stripe/checkout" method="POST" className="flex-1">
      <input type="hidden" name="plan" value={plan} />
      <button
        type="submit"
        className="flex min-h-11 w-full flex-col items-center justify-center rounded-xl border border-line bg-surface-2 px-4 py-3 transition-colors hover:border-green"
      >
        <span className="font-mono text-2xl font-medium text-fg">{price}</span>
        <span className="text-xs text-fg-dim">{cadence}</span>
      </button>
    </form>
  );
}

export default async function PremiumPage() {
  const { isPremium } = await getViewer();
  const canCheckout = plansConfigured() && Boolean(process.env.STRIPE_SECRET_KEY);

  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Glass Pitch Premium
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-fg-dim">
          Premium adds depth for people who want to go further into the
          numbers. It never changes what the model predicts, and it never
          gates the record itself.
        </p>
      </header>

      <section aria-labelledby="included-heading" className="space-y-3">
        <h2
          id="included-heading"
          className="font-display text-lg font-semibold tracking-tight text-fg"
        >
          What&rsquo;s included
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {INCLUDED.map((item) => (
            <li key={item.title} className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-sm font-medium text-fg">{item.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-fg-dim">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm leading-relaxed text-fg">
        <span className="font-medium">The full ledger and every prediction stay free, forever.</span>{' '}
        <span className="text-fg-dim">
          Premium never changes the calls or the record — it only adds depth
          content and export/filter tools around them.
        </span>
      </p>

      <section aria-labelledby="plans-heading" className="space-y-3">
        <h2
          id="plans-heading"
          className="font-display text-lg font-semibold tracking-tight text-fg"
        >
          Plans
        </h2>

        {isPremium ? (
          <div className="rounded-2xl border border-line bg-surface p-5">
            <p className="text-sm leading-relaxed text-fg-dim">
              You&rsquo;re already subscribed to Premium.{' '}
              <Link
                href="/account"
                className="text-green underline transition-colors hover:text-green-bright"
              >
                Manage your subscription
              </Link>
              .
            </p>
          </div>
        ) : canCheckout ? (
          <div className="flex gap-3">
            <PlanForm plan="monthly" price="£4" cadence="per month" />
            <PlanForm plan="annual" price="£29" cadence="per year" />
          </div>
        ) : (
          <div className="rounded-2xl border border-line bg-surface p-5">
            <p className="text-sm leading-relaxed text-fg-dim">
              Checkout isn&rsquo;t switched on in this environment yet — check
              back soon.
            </p>
          </div>
        )}

        <p className="text-xs leading-relaxed text-fg-dim">
          Cancel any time from your account — cancelling is exactly as easy as
          subscribing.
        </p>
      </section>

      <div className="space-y-2 rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
        <p>{ANALYSIS_NOT_ADVICE}</p>
        <p>{RESPONSIBLE_GAMBLING}</p>
      </div>
    </article>
  );
}
