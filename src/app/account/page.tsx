import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMySubscription } from '@/lib/queries/subscription';
import { signOut } from '@/lib/auth/actions';
import { formatDateShort } from '@/lib/format';
import { PLAN_LABEL } from '@/lib/stripe/plans';
import type { SubscriptionStatus } from '@/lib/types';

// /account — dynamic, authed (ARCHITECTURE.md §4 v2). Out of the public nav,
// noindexed, out of the sitemap until the owner flips premium live (§13).
// Middleware already redirects an anonymous visitor to /login; the explicit
// check + redirect below is defence in depth, not the primary gate.
export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false, follow: false },
};

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: 'Active',
  past_due: 'Payment past due',
  canceled: 'Cancelled',
  incomplete: 'Incomplete',
  incomplete_expired: 'Expired before payment completed',
  trialing: 'Trialing',
  unpaid: 'Unpaid',
  paused: 'Paused',
};

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/account');

  const subscription = await getMySubscription(supabase, user.id);
  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
  const isActive = subscription?.status === 'active';

  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Your account
        </h1>
        <p className="text-sm text-fg-dim">Signed in as {user.email}.</p>
      </header>

      <section aria-labelledby="subscription-heading" className="space-y-3">
        <h2
          id="subscription-heading"
          className="font-display text-lg font-semibold tracking-tight text-fg"
        >
          Glass Pitch Premium
        </h2>

        {!subscription ? (
          <div className="rounded-2xl border border-line bg-surface p-5">
            <p className="text-sm leading-relaxed text-fg-dim">
              You don&rsquo;t have a Premium subscription. Every prediction and
              the full scored ledger are free regardless —{' '}
              <Link
                href="/premium"
                className="text-green underline transition-colors hover:text-green-bright"
              >
                see what Premium adds
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="space-y-3 rounded-2xl border border-line bg-surface p-5">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-fg-dim">Status</dt>
                <dd className="mt-0.5 font-medium text-fg">
                  {STATUS_LABEL[subscription.status]}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-fg-dim">Plan</dt>
                <dd className="mt-0.5 font-medium text-fg">
                  {subscription.plan ? PLAN_LABEL[subscription.plan] : '—'}
                </dd>
              </div>
              {subscription.currentPeriodEnd && (
                <div>
                  <dt className="text-xs text-fg-dim">
                    {subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'}
                  </dt>
                  <dd className="mt-0.5 font-mono font-medium text-fg">
                    {formatDateShort(subscription.currentPeriodEnd)}
                  </dd>
                </div>
              )}
            </dl>

            {subscription.cancelAtPeriodEnd && isActive && (
              <p className="text-xs leading-relaxed text-fg-dim">
                Your subscription is set to end on the date above and won&rsquo;t
                renew — you keep Premium access until then.
              </p>
            )}

            {subscription.hasStripeCustomer && stripeConfigured ? (
              <form action="/api/stripe/portal" method="POST">
                <button
                  type="submit"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-line bg-surface-2 px-4 text-sm font-medium text-fg transition-colors hover:bg-line"
                >
                  Manage billing
                </button>
              </form>
            ) : (
              <p className="text-xs leading-relaxed text-fg-dim">
                {stripeConfigured
                  ? 'Billing management isn’t available for this account yet.'
                  : 'Billing isn’t switched on in this environment yet.'}
              </p>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="session-heading" className="space-y-3">
        <h2
          id="session-heading"
          className="font-display text-lg font-semibold tracking-tight text-fg"
        >
          Session
        </h2>
        <form action={signOut}>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-line bg-surface-2 px-4 text-sm font-medium text-fg transition-colors hover:bg-line"
          >
            Sign out
          </button>
        </form>
      </section>

      <section aria-labelledby="delete-heading" className="space-y-3">
        <h2
          id="delete-heading"
          className="font-display text-lg font-semibold tracking-tight text-fg"
        >
          Delete account
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          Permanently deletes your Glass Pitch account and any subscription
          record we hold about you. This does not cancel an active Stripe
          subscription for you automatically — cancel it first via
          &ldquo;Manage billing&rdquo; above if you don&rsquo;t want to be
          charged again.
        </p>
        <Link
          href="/account/delete"
          className="inline-flex min-h-11 items-center text-sm font-medium text-miss-bright underline transition-colors hover:text-miss"
        >
          Delete my account
        </Link>
      </section>
    </article>
  );
}
