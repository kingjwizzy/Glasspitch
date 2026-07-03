import 'server-only';

// The viewer/entitlement helper (v2 premium; ARCHITECTURE.md §4, §7).
//
// This is a UX convenience ONLY — it decides what to render (an upsell vs. the
// real content), it is NOT the security boundary. The actual gate is Row Level
// Security on `fixture_insights` (readable only via an active-subscription
// check) and on the billing tables (owner-read/service-write, zero-anon). Even
// if this helper were wrong, a non-premium user's own client would simply get
// zero rows back from a premium-gated table, never someone else's data.

import { createClient } from '@/lib/supabase/server';
import type { SubscriptionStatus } from '@/lib/types';

export interface Viewer {
  user: { id: string; email: string | null } | null;
  isPremium: boolean;
  subscriptionStatus: SubscriptionStatus | null;
}

const NONE: Viewer = { user: null, isPremium: false, subscriptionStatus: null };

/**
 * Resolve the current signed-in user (if any) and whether they hold an
 * active subscription, via the per-request cookie-bound client — so the read
 * is naturally scoped to "my own subscription row" under RLS.
 *
 * Mirrors the backend-jobs migration's `public.is_premium()` SQL function
 * exactly (`status in ('active','trialing')` AND `current_period_end is null
 * or current_period_end > now()`) — the ACTUAL gate on `fixture_insights` —
 * so this UX helper can never disagree with what RLS actually allows. No
 * trial is offered today (a locked product decision, DESIGN.md §6), so
 * `trialing` should never occur in practice; it's included only to stay
 * byte-for-byte aligned with `is_premium()` rather than silently drifting.
 * `past_due` is deliberately NOT treated as premium — same as the DB helper.
 *
 * `.limit(1)` before `.maybeSingle()` is defensive: nothing in the schema
 * enforces at most one subscription row per user (only `stripe_customer_id`
 * is UNIQUE), so an unbounded `.maybeSingle()` would throw if a user ever
 * ended up with two rows.
 */
export async function getViewer(): Promise<Viewer> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NONE;

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('status, current_period_end')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const status = (subscription?.status as SubscriptionStatus | undefined) ?? null;
  const periodEnd = subscription?.current_period_end ?? null;
  const notExpired = periodEnd === null || new Date(periodEnd) > new Date();
  const isPremium = (status === 'active' || status === 'trialing') && notExpired;

  return {
    user: { id: user.id, email: user.email ?? null },
    isPremium,
    subscriptionStatus: status,
  };
}
