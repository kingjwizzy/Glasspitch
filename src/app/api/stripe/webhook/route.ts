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
// webhooks; this makes replays and races harmless). Always returns fast and
// always 200 once the event is durably recorded, so Stripe doesn't retry a
// permanent failure our own bug caused.
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
): Promise<void> {
  const userId =
    session.client_reference_id ?? (session.metadata?.supabase_user_id as string | undefined);
  const customerId =
    typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null);

  if (!userId || !customerId) {
    console.error('stripe/webhook: checkout.session.completed missing user/customer', session.id);
    return;
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
  if (error) console.error('stripe/webhook: subscriptions upsert failed', error.message);
}

async function upsertFromSubscription(
  admin: SupabaseClient<Database>,
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
  const userId = await resolveUserId(
    admin,
    customerId,
    subscription.metadata?.supabase_user_id as string | undefined,
  );

  if (!userId) {
    console.error('stripe/webhook: could not resolve user_id for subscription', subscription.id);
    return;
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
  if (error) console.error('stripe/webhook: subscriptions upsert failed', error.message);
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

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await upsertFromCheckoutSession(admin, stripe, event.data.object);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await upsertFromSubscription(admin, event.data.object);
        break;
      default:
        break;
    }
  } catch (err) {
    // Already durably recorded in stripe_events above; log and still return
    // 200 so Stripe doesn't retry forever on a bug in our own handling.
    console.error(`stripe/webhook: error handling ${event.type}`, err);
  }

  return NextResponse.json({ received: true });
}
