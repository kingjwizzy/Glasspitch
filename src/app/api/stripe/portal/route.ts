import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe/client';
import { isCrossOriginRequest } from '@/lib/security/originGuard';
import { SITE_URL } from '@/lib/constants';

// POST /api/stripe/portal — opens the Stripe Customer Portal so cancelling is
// exactly as easy as subscribing (DESIGN.md §6). Requires an authenticated
// visitor with an existing Stripe customer id (only ever written by the
// webhook). Degrades to 503/redirect (never a crash) when Stripe isn't
// configured or there is nothing to manage yet.
//
// Guarded by isCrossOriginRequest (security audit finding #4/CSRF fix): this
// is a plain <form method="POST"> on /account — Route Handlers get no
// automatic Origin check from Next.js the way Server Actions do.
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
  }

  const stripe = getStripe();
  if (!stripe) {
    console.error('stripe/portal: Stripe is not configured.');
    return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login?next=/account', request.url), 303);
  }

  // `.limit(1)` before `.maybeSingle()`: only `stripe_customer_id` is UNIQUE
  // in the schema, not `user_id` — defensive against >1 row ever existing.
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!subscription?.stripe_customer_id) {
    return NextResponse.redirect(new URL('/account?portal=unavailable', request.url), 303);
  }

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${SITE_URL}/account`,
    });
    return NextResponse.redirect(portalSession.url, 303);
  } catch (err) {
    console.error('stripe/portal: session creation failed', err);
    return NextResponse.redirect(new URL('/account?portal=error', request.url), 303);
  }
}
