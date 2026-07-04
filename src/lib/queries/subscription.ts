import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { SubscriptionStatus } from '@/lib/types';
import { resolvePlanForPriceId } from '@/lib/stripe/plans';

// /account's subscription read (ARCHITECTURE.md §7 v2 amendment). Goes
// through the CALLER'S per-request, cookie-bound client — never the anon
// singleton and never supabaseAdmin — so the row returned is provably the
// signed-in visitor's own (RLS: owner-read on billing tables).
//
// `.limit(1)` before `.maybeSingle()` is defensive: only `stripe_customer_id`
// is UNIQUE in the backend-jobs migration, not `user_id` — nothing stops a
// user from ending up with two rows, and an unbounded `.maybeSingle()` throws
// on more than one match. Ordered by `updated_at` so the most recently
// touched row (the one the webhook most recently wrote) wins.

export interface MySubscription {
  status: SubscriptionStatus;
  plan: 'monthly' | 'annual' | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasStripeCustomer: boolean;
}

export async function getMySubscription(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<MySubscription | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('status, price_id, current_period_end, cancel_at_period_end, stripe_customer_id')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('getMySubscription: read failed', error.message);
    return null;
  }
  if (!data) return null;

  return {
    status: data.status as SubscriptionStatus,
    plan: await resolvePlanForPriceId(data.price_id),
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
    hasStripeCustomer: Boolean(data.stripe_customer_id),
  };
}
