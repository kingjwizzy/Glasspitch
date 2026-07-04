import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PLAN_LABEL } from '@/lib/stripe/plans';
import type { PremiumPlan } from '@/lib/types';

// /checkout/resume — the landing page for the "resume to Stripe" flow
// (security audit finding #4/CSRF fix). /api/stripe/checkout is now POST-only
// (a state-changing, Checkout-session-creating action must never be
// GET-reachable), so an anonymous visitor who started checkout, got sent to
// /login to sign in, and clicked their magic link can no longer be bounced
// straight back into a GET-triggered Checkout session. Instead they land
// here, signed in, with the plan preserved via `?plan=`, and this page's own
// <form method="POST" action="/api/stripe/checkout"> is what actually
// re-enters the checkout route — one real click, zero client JS, and the
// resulting POST passes the same Origin/Sec-Fetch-Site check every other
// checkout submission does.
//
// Private/transitional surface: noindexed, out of the sitemap, never linked
// from the public nav — only ever reached via the /login → magic-link →
// /auth/confirm redirect chain.
export const metadata: Metadata = {
  title: 'Continue to checkout',
  robots: { index: false, follow: false },
};

interface CheckoutResumeProps {
  searchParams: Promise<{ plan?: string }>;
}

function parsePlan(value: string | undefined): PremiumPlan | null {
  return value === 'monthly' || value === 'annual' ? value : null;
}

export default async function CheckoutResumePage({ searchParams }: CheckoutResumeProps) {
  const { plan: rawPlan } = await searchParams;
  const plan = parsePlan(rawPlan);

  // No valid plan to resume — send them back to pick one rather than show a
  // dead-end form (DESIGN.md §6: never a broken or confusing control).
  if (!plan) redirect('/premium');

  return (
    <article className="mx-auto max-w-sm space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          You&rsquo;re signed in
        </h1>
        <p className="text-sm leading-relaxed text-fg-dim">
          Continue to Stripe to finish subscribing to Glass Pitch Premium —{' '}
          {PLAN_LABEL[plan]}.
        </p>
      </header>

      <form action="/api/stripe/checkout" method="POST">
        <input type="hidden" name="plan" value={plan} />
        <button
          type="submit"
          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-green px-4 text-sm font-semibold text-bg transition-colors hover:bg-green-bright"
        >
          Continue to checkout
          <span aria-hidden="true">→</span>
        </button>
      </form>
    </article>
  );
}
