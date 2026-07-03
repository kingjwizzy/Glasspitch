import { type NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe/client';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import type { Database, Json } from '@/lib/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

// POST /api/stripe/webhook — the ONE sanctioned writer of billing tables
// (ARCHITECTURE.md §0/§5 v2 amendment): signature-verified, server-only, and
// the only code path anywhere that uses the service-role client to touch
// `subscriptions` / `stripe_events`. Node runtime so `request.text()` gives
// the raw, unparsed body signature verification needs.
//
// Idempotency: insert-first into `stripe_events` keyed on the Stripe event
// id — a primary-key conflict means we've already processed this exact event,
// so we return 200 immediately without re-handling it (Stripe retries
// webhooks; this makes replays and races harmless). If handling then FAILS,
// the idempotency row is removed and a 500 is returned so Stripe retries —
// a billing state change must never be silently dropped (gate finding,
// 2026-07-03): a lost checkout.session.completed would leave a paying user
// without premium; a lost subscription.deleted would leave lingering access.
export const runtime = 'nodejs';

function serviceUnavailable(message: string) {
  console.error(`stripe/webhook: ${message}`);
  return NextResponse.json({ error: message }, { status: 503 });
}

async function resolveUserId(
  admin: SupabaseClient<Database>,
  customerId: string,
  metadataUserId: string | null | undefined,
): Promise<string | null> {
  if (metadataUserId) return metadataUserId;
  const { data } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return data?.user_id ?? null;
}

function toIso(unixSeconds: number | null | undefined): string | null {
  return typeof unixSeconds === 'number' ? new Date(unixSeconds * 1000).toISOString() : null;
}

async function upsertFromCheckoutSession(
  admin: SupabaseClient<Database>,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  const userId =
    session.client_reference_id ?? (session.metadata?.supabase_user_id as string | undefined);
  const customerId =
    typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null);

  if (!userId || !customerId) {
    console.error('stripe/webhook: checkout.session.completed missing user/customer', session.id);
    return false;
  }

  let status = 'incomplete';
  let priceId: string | null = null;
  let currentPeriodEnd: string | null = null;
  let cancelAtPeriodEnd = false;
  const subscriptionId =
    typeof session.subscription === 'string' ? session.subscription : (session.subscription?.id ?? null);

  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    status = subscription.status;
    const item = subscription.items.data[0];
    priceId = item?.price.id ?? null;
    currentPeriodEnd = toIso(item?.current_period_end);
    cancelAtPeriodEnd = subscription.cancel_at_period_end;
  }

  const { error } = await admin.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      status,
      price_id: priceId,
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: cancelAtPeriodEnd,
      updated_at: new Date().toISOString(),
    },
    // `stripe_customer_id` (NOT `user_id`) is the table's actual UNIQUE key
    // (see the backend-jobs migration 0004): one row per Stripe customer, so
    // a re-subscribe after cancelling updates the same row.
    { onConflict: 'stripe_customer_id' },
  );
  if (error) {
    console.error('stripe/webhook: subscriptions upsert failed', error.message);
    return false;
  }
  return true;
}

async function upsertFromSubscription(
  admin: SupabaseClient<Database>,
  subscription: Stripe.Subscription,
): Promise<boolean> {
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
  const userId = await resolveUserId(
    admin,
    customerId,
    subscription.metadata?.supabase_user_id as string | undefined,
  );

  if (!userId) {
    // Possibly an ordering race (subscription.* landing before
    // checkout.session.completed created the mapping row) — fail so Stripe
    // retries; the retry succeeds once the mapping exists.
    console.error('stripe/webhook: could not resolve user_id for subscription', subscription.id);
    return false;
  }

  const item = subscription.items.data[0];
  const { error } = await admin.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      status: subscription.status,
      price_id: item?.price.id ?? null,
      current_period_end: toIso(item?.current_period_end),
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'stripe_customer_id' },
  );
  if (error) {
    console.error('stripe/webhook: subscriptions upsert failed', error.message);
    return false;
  }
  return true;
}

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return serviceUnavailable('Stripe secret key or webhook secret is not configured.');
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header.' }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('stripe/webhook: signature verification failed', err);
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Insert-first idempotency: a PK conflict on `id` means this exact event was
  // already recorded (and, by extension, already handled) — return 200 now.
  const { error: insertError } = await admin.from('stripe_events').insert({
    id: event.id,
    type: event.type,
    payload: JSON.parse(JSON.stringify(event)) as Json,
  });
  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error('stripe/webhook: failed to record stripe_events row', insertError.message);
    return NextResponse.json({ error: 'Could not record event.' }, { status: 500 });
  }

  let handled = true;
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        handled = await upsertFromCheckoutSession(admin, stripe, event.data.object);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        handled = await upsertFromSubscription(admin, event.data.object);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error(`stripe/webhook: error handling ${event.type}`, err);
    handled = false;
  }

  if (!handled) {
    // Undo the idempotency record so Stripe's retry isn't swallowed as a
    // duplicate, and signal failure so it DOES retry (with backoff, visible
    // in the Stripe dashboard if it keeps failing).
    const { error: undoError } = await admin.from('stripe_events').delete().eq('id', event.id);
    if (undoError) {
      console.error('stripe/webhook: failed to undo stripe_events row', undoError.message);
    }
    return NextResponse.json({ error: 'Event handling failed.' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
