import type { Metadata } from 'next';
import Link from 'next/link';
import { getViewer } from '@/lib/auth/viewer';
import { plansConfigured } from '@/lib/stripe/plans';
import { ANALYSIS_NOT_ADVICE, RESPONSIBLE_GAMBLING, SITE_NAME } from '@/lib/constants';

// /premium — the pricing page (ARCHITECTURE.md §4 v2). Noindexed, out of the
// public nav and the sitemap until the owner flips premium live post-Stripe-
// vetting and legal sign-off (§13). Every rule in DESIGN.md §6 applies
// verbatim: state plainly what premium contains and the price, state that the
// ledger and every prediction stay free forever, no urgency, no dark
// patterns, no more than one quiet upgrade affordance — here, the two plain
// Checkout buttons ARE the page's purpose, so nothing else competes with them.
const PREMIUM_TITLE = 'Premium';
const PREMIUM_DESCRIPTION = 'What Glass Pitch Premium adds, and what stays free forever.';

export const metadata: Metadata = {
  title: PREMIUM_TITLE,
  description: PREMIUM_DESCRIPTION,
  alternates: { canonical: '/premium' },
  // Self-referential og:url + restated siteName (openGraph fully replaces the
  // layout's object — ARCHITECTURE.md §11). Present regardless of the
  // noindex gate below — harmless pre-launch, and ready the moment it flips.
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: PREMIUM_TITLE,
    description: PREMIUM_DESCRIPTION,
    url: '/premium',
  },
  twitter: { card: 'summary_large_image', title: PREMIUM_TITLE, description: PREMIUM_DESCRIPTION },
  // Indexable only once live payments are on (NEXT_PUBLIC_PREMIUM_LIVE=1 —
  // the same env gate as the header affordance).
  robots:
    process.env.NEXT_PUBLIC_PREMIUM_LIVE === '1'
      ? undefined
      : { index: false, follow: false },
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

// Each plan is its own <form method="POST"> straight to Checkout — no client
// JS anywhere on this page. The button itself IS the unmistakable CTA (audit
// #5/#16/#24): solid primary-green fill (not an outline), a verb + price
// label, a trailing arrow, and a persistent (not hover-only) affordance so
// it reads as clickable at a glance, not just on interaction.
function PlanCard({
  plan,
  price,
  cadence,
  ctaLabel,
  badge,
  emphasized,
}: {
  plan: 'monthly' | 'annual';
  price: string;
  cadence: string;
  ctaLabel: string;
  badge?: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl border p-4 ${
        emphasized ? 'border-green bg-surface-2' : 'border-line bg-surface'
      }`}
    >
      {badge ? (
        <span className="inline-flex w-fit items-center rounded-full bg-green/15 px-2.5 py-1 text-xs font-medium text-green-bright">
          {badge}
        </span>
      ) : null}
      <div>
        <span className="font-mono text-2xl font-medium text-fg">{price}</span>{' '}
        <span className="text-sm text-fg-dim">{cadence}</span>
      </div>
      <form action="/api/stripe/checkout" method="POST">
        <input type="hidden" name="plan" value={plan} />
        <button
          type="submit"
          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-green px-4 text-sm font-semibold text-bg transition-colors hover:bg-green-bright"
        >
          {ctaLabel}
          <span aria-hidden="true">→</span>
        </button>
      </form>
    </div>
  );
}

export default async function PremiumPage() {
  const { isPremium } = await getViewer();
  const canCheckout = plansConfigured();

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
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Annual is the emphasised/default plan — a real, calculable
                saving (£39/yr vs £6×12=£72/yr = 46% — no fake "was £X" strike
                price, no countdown; DESIGN.md §6). */}
            <PlanCard
              plan="annual"
              price="£39"
              cadence="per year"
              ctaLabel="Start annual · £39/yr"
              badge="Save 46% · about £3.25/mo"
              emphasized
            />
            <PlanCard plan="monthly" price="£6" cadence="per month" ctaLabel="Start monthly · £6/mo" />
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
          subscribing, no retention calls, no hoops.
        </p>

        <p className="text-sm text-fg-dim">
          Not sure yet?{' '}
          <Link href="/ledger" className="text-green underline transition-colors hover:text-green-bright">
            See our public, scored track record
          </Link>
          .
        </p>
      </section>

      <div className="space-y-2 rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
        <p>{ANALYSIS_NOT_ADVICE}</p>
        <p>{RESPONSIBLE_GAMBLING}</p>
      </div>
    </article>
  );
}
