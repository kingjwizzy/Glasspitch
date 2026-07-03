import 'server-only';
import Stripe from 'stripe';

// Server-only Stripe SDK factory (ARCHITECTURE.md §4, §13 v2 amendment).
//
// Test-mode keys only until Stripe's restricted-business review clears and
// legal sign-off is obtained (§13) — this module doesn't know or care which
// mode the key is in, it just reads whatever STRIPE_SECRET_KEY is configured.
//
// `getStripe()` returns `null` (never throws) when the key is unset, so every
// caller can degrade to a 503 + log instead of crashing — Stripe env being
// absent must never take down the build or the rest of the site.

// Pinned to the version this SDK ships as its default (stripe@18.5.0), rather
// than relying on the SDK's implicit default — an explicit pin means a future
// SDK bump can't silently change the wire API version underneath us.
const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2025-08-27.basil';

let stripeClient: Stripe | undefined;

export function getStripe(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;

  if (!stripeClient) {
    stripeClient = new Stripe(secretKey, {
      apiVersion: STRIPE_API_VERSION,
      // No `payment_method_types` anywhere in this codebase, by design — omit
      // it everywhere and let the Stripe Dashboard's configured methods apply.
      appInfo: { name: 'Glass Pitch', version: '2.0.0' },
    });
  }
  return stripeClient;
}
