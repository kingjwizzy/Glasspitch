import 'server-only';
import type { PremiumPlan } from '@/lib/types';
import { getStripe } from '@/lib/stripe/client';

// Plan ↔ Stripe Price id mapping (ARCHITECTURE.md §4: £6/mo + £39/yr, locked
// pricing).
//
// v2.1 (2026-07-04, audit #1 blocker): price resolution now prefers Stripe's
// `lookup_key` over the env vars. The Vercel env
// STRIPE_PRICE_ID_MONTHLY/ANNUAL still point at the OLD, wrongly-priced
// Stripe prices (£4/mo, £29/yr) and cannot be edited from here — the correct
// prices (`premium_monthly` £6, `premium_annual` £39) are looked up by their
// stable `lookup_key`, which survives archiving/recreating the underlying
// price object. The env ids remain a graceful-degradation FALLBACK only:
// every caller must still treat "nothing resolvable" as "this plan isn't
// available right now", never crash.

export const PLAN_LABEL: Record<PremiumPlan, string> = {
  monthly: '£6/month',
  annual: '£39/year',
};

const LOOKUP_KEY: Record<PremiumPlan, string> = {
  monthly: 'premium_monthly',
  annual: 'premium_annual',
};

function envPriceId(plan: PremiumPlan): string | null {
  const id =
    plan === 'monthly'
      ? process.env.STRIPE_PRICE_ID_MONTHLY
      : process.env.STRIPE_PRICE_ID_ANNUAL;
  return id && id.length > 0 ? id : null;
}

// Memoised per plan for the process lifetime — a Stripe Checkout/webhook is a
// hot path, and `lookup_key` prices don't change without a deploy, so one
// `prices.list` call per plan per server instance is enough. Storing the
// in-flight Promise (not just the resolved value) also means concurrent
// callers within the same instance share one Stripe API call instead of
// firing one each.
const resolvedPriceIds = new Map<PremiumPlan, Promise<string | null>>();

async function fetchPriceId(plan: PremiumPlan): Promise<string | null> {
  const stripe = getStripe();
  if (stripe) {
    try {
      const prices = await stripe.prices.list({
        lookup_keys: [LOOKUP_KEY[plan]],
        active: true,
        limit: 1,
      });
      const found = prices.data[0]?.id;
      if (found) return found;
    } catch (err) {
      console.error(`stripe/plans: lookup_key resolution failed for "${plan}"`, err);
    }
  }
  // No Stripe configured, or the lookup key wasn't found (not created yet) —
  // fall back to the env id so nothing breaks pre-flip.
  return envPriceId(plan);
}

/** Resolve a plan's live Stripe price id, `lookup_key`-first. Never throws —
 *  returns `null` when truly unavailable (no Stripe, no lookup key, no env
 *  fallback either). */
export async function resolvePriceId(plan: PremiumPlan): Promise<string | null> {
  const cached = resolvedPriceIds.get(plan);
  if (cached) return cached;

  const pending = fetchPriceId(plan);
  resolvedPriceIds.set(plan, pending);
  const resolved = await pending;

  // Only a real `lookup_key` hit is safe to memoise for the process lifetime.
  // A `null` (no Stripe, or the key isn't created yet) or an env-fallback
  // result (a transient `prices.list` error dropped us into `envPriceId`)
  // must NOT be pinned: caching the env id would charge the OLD wrong £4/£29
  // price until the process recycles, and caching `null` would keep /premium
  // showing "not available" even after the correct price is created. Dropping
  // the entry lets the next call retry. Concurrent in-flight callers still
  // shared the one `pending` promise above, so this doesn't refire the lookup
  // for a burst — only the NEXT request after a failure re-attempts.
  if (resolved === null || resolved === envPriceId(plan)) {
    resolvedPriceIds.delete(plan);
  }
  return resolved;
}

/** True when Stripe itself is configured — lookup keys (not env price ids)
 *  are now the source of truth for whether a given plan resolves, so this no
 *  longer checks the env vars directly; it only decides whether /premium
 *  shows working checkout buttons or an honest "not open yet" message
 *  (DESIGN.md §6: never a broken or dead-end control). */
export function plansConfigured(): boolean {
  return Boolean(getStripe());
}

/** Reverse-map a stored `price_id` back to a plan. Checks the resolved
 *  (lookup_key-first) ids first, then falls back to the raw env ids — a
 *  `subscriptions` row can still reference an old, since-archived price that
 *  was current when the customer subscribed, and that must keep reading as
 *  the right plan rather than silently going blank. */
export async function resolvePlanForPriceId(priceId: string | null): Promise<PremiumPlan | null> {
  if (!priceId) return null;

  const [monthlyId, annualId] = await Promise.all([
    resolvePriceId('monthly'),
    resolvePriceId('annual'),
  ]);
  if (priceId === monthlyId) return 'monthly';
  if (priceId === annualId) return 'annual';

  if (priceId === envPriceId('monthly')) return 'monthly';
  if (priceId === envPriceId('annual')) return 'annual';

  return null;
}
