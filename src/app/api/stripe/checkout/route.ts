import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe/client';
import { priceIdFor } from '@/lib/stripe/plans';
import { SITE_URL } from '@/lib/constants';
import type { PremiumPlan } from '@/lib/types';

// POST /api/stripe/checkout — starts a subscription-mode Stripe Checkout
// Session (ARCHITECTURE.md §4 v2). Node runtime (default for Route Handlers;
// explicit per the frontend-dev brief). Invoked by a plain <form method="POST">
// on /premium — no client JS, no @stripe/stripe-js: the whole flow is a
// server-issued redirect to Stripe-hosted Checkout and back.
//
// NEVER sets `payment_method_types` — the Stripe Dashboard's configured
// methods apply. Degrades to 503 (not a crash) when Stripe or the requested
// plan's price id isn't configured (test-mode / pre-launch).
export const runtime = 'nodejs';

function unavailable(message: string) {
  console.error(`stripe/checkout: ${message}`);
  return NextResponse.json({ error: message }, { status: 503 });
}

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  if (!stripe) return unavailable('Stripe is not configured.');

  const form = await request.formData();
  const plan = form.get('plan');
  if (plan !== 'monthly' && plan !== 'annual') {
    return NextResponse.json({ error: 'Invalid plan.' }, { status: 400 });
  }
  const priceId = priceIdFor(plan as PremiumPlan);
  if (!priceId) return unavailable(`No price id configured for plan "${plan}".`);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.redirect(new URL('/login?next=/premium', request.url), 303);
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
