import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe/client';
import { resolvePriceId } from '@/lib/stripe/plans';
import { isCrossOriginRequest } from '@/lib/security/originGuard';
import { SITE_URL } from '@/lib/constants';
import type { PremiumPlan } from '@/lib/types';

// /api/stripe/checkout — starts a subscription-mode Stripe Checkout Session
// (ARCHITECTURE.md §4 v2). Node runtime (default for Route Handlers; explicit
// per the frontend-dev brief).
//
// POST-only (security audit finding #4/CSRF fix): this is the plain
// <form method="POST"> on /premium — no client JS, no @stripe/stripe-js — and
// is guarded by isCrossOriginRequest below since Route Handlers, unlike
// Server Actions, get no automatic Origin check from Next.js. A GET verb used
// to exist purely for the "resume to Stripe" flow (an anonymous visitor sent
// to /login mid-checkout, then bounced straight back here once they clicked
// the magic link) — a state-changing (Checkout-session-creating,
// Stripe-billed) action must never be GET-reachable, since a GET can be
// triggered as a same-site side effect (an <img>/prefetched <a>, no CSRF
// token needed) far more easily than a POST. The resume flow now lands
// instead on /checkout/resume, a plain page with its own
// <form method="POST" action="/api/stripe/checkout">, so finishing checkout
// after signing back in still only ever happens via a real POST.
//
// NEVER sets `payment_method_types` — the Stripe Dashboard's configured
// methods apply. Degrades to 503 (not a crash) when Stripe or the requested
// plan's price id isn't configured (test-mode / pre-launch).
export const runtime = 'nodejs';

function unavailable(message: string) {
  console.error(`stripe/checkout: ${message}`);
  return NextResponse.json({ error: message }, { status: 503 });
}

function parsePlan(value: FormDataEntryValue | string | null): PremiumPlan | null {
  return value === 'monthly' || value === 'annual' ? value : null;
}

async function handleCheckout(request: NextRequest, plan: PremiumPlan | null) {
  if (isCrossOriginRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
  }

  const stripe = getStripe();
  if (!stripe) return unavailable('Stripe is not configured.');

  if (!plan) {
    return NextResponse.json({ error: 'Invalid plan.' }, { status: 400 });
  }

  // `lookup_key`-first resolution (audit #1): env price ids are stale until
  // the owner repoints them, so this is the one path both the monthly and
  // annual buttons rely on to reach the CORRECT £6/£39 prices.
  const priceId = await resolvePriceId(plan);
  if (!priceId) return unavailable(`No price id configured for plan "${plan}".`);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    // Resume-to-Stripe: send the visitor to sign in, then to /checkout/resume
    // (not /premium) with the same plan preserved, so magic-link login
    // resumes straight into a one-click "Continue to checkout" rather than
    // losing their choice — that page's own POST form is what actually
    // re-enters this handler (this route is POST-only; see the file banner).
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', `/checkout/resume?plan=${plan}`);
    return NextResponse.redirect(loginUrl, 303);
  }

  // Reuse an existing Stripe customer if this visitor has subscribed before —
  // the mapping is written by the webhook (the sanctioned billing writer),
  // never by this route.
  // `.limit(1)` before `.maybeSingle()`: only `stripe_customer_id` is UNIQUE
  // in the schema, not `user_id` — defensive against >1 row ever existing.
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Tax collection is OFF by default (audit #17): only switch it on once the
  // owner has confirmed the relevant tax registrations are in place — see
  // STRIPE_AUTOMATIC_TAX in the deploy env, not a code change.
  const taxEnabled = process.env.STRIPE_AUTOMATIC_TAX === '1';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      metadata: { supabase_user_id: user.id },
      subscription_data: { metadata: { supabase_user_id: user.id } },
      ...(existing?.stripe_customer_id
        ? { customer: existing.stripe_customer_id }
        : { customer_email: user.email }),
      // Audit #15: lets a visitor holding a promo/discount code redeem it on
      // the Stripe-hosted page — costs nothing when no codes exist.
      allow_promotion_codes: true,
      ...(taxEnabled
        ? { automatic_tax: { enabled: true }, billing_address_collection: 'auto' as const }
        : {}),
      // Audit #6 compliance: since access starts immediately, UK/EU distance-
      // selling rules require the customer to knowingly waive their 14-day
      // cancellation right — stated plainly next to the pay button rather
      // than relying on `consent_collection` (which needs a Dashboard-
      // configured Terms of Service URL this repo can't set).
      custom_text: {
        submit: {
          message:
            'You get Premium access immediately. Starting now means you agree to waive your 14-day cancellation right for this billing period. Cancel any time after that from your account.',
        },
      },
      success_url: `${SITE_URL}/account?checkout=success`,
      cancel_url: `${SITE_URL}/premium?checkout=cancelled`,
    });

    if (!session.url) return unavailable('Stripe did not return a Checkout URL.');
    return NextResponse.redirect(session.url, 303);
  } catch (err) {
    console.error('stripe/checkout: session creation failed', err);
    return NextResponse.json({ error: 'Could not start checkout.' }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  return handleCheckout(request, parsePlan(form.get('plan')));
}
