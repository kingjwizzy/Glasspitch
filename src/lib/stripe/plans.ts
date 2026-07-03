import 'server-only';
import type { PremiumPlan } from '@/lib/types';

// Plan ↔ Stripe Price id mapping (ARCHITECTURE.md §4: £4/mo + £29/yr, locked
// pricing). The env vars are allowed to be EMPTY (test mode, pre-launch) —
// every caller must treat a missing price id as "this plan isn't available
// right now", never crash (v2 guardrail: degrade gracefully when Stripe env
// is unset).

export const PLAN_LABEL: Record<PremiumPlan, string> = {
  monthly: '£4/month',
  annual: '£29/year',
};

export function priceIdFor(plan: PremiumPlan): string | null {
  const id =
    plan === 'monthly'
      ? process.env.STRIPE_PRICE_ID_MONTHLY
      : process.env.STRIPE_PRICE_ID_ANNUAL;
  return id && id.length > 0 ? id : null;
}

/** True only when BOTH plans have a configured price id — used to decide
 *  whether /premium shows working checkout buttons or an honest "not open
 *  yet" message (DESIGN.md §6: never a broken or dead-end control). */
export function plansConfigured(): boolean {
  return priceIdFor('monthly') !== null && priceIdFor('annual') !== null;
}

export function planForPriceId(priceId: string | null): PremiumPlan | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_ID_MONTHLY) return 'monthly';
  if (priceId === process.env.STRIPE_PRICE_ID_ANNUAL) return 'annual';
  return null;
}
