import 'server-only';
import type { NextRequest } from 'next/server';

// Same-origin guard for state-changing Route Handlers (security audit finding
// #4/CSRF). Next.js Server Actions get an automatic Origin check for free;
// plain Route Handlers (the Stripe checkout/portal POSTs) do not, so without
// this an attacker-hosted page could point a hidden
// `<form method="POST" action="https://glasspitch.com/api/stripe/checkout">`
// at a signed-in visitor and trigger a real Checkout/Portal session in their
// browser purely from ambient session cookies.
//
// `Sec-Fetch-Site` is checked first: every modern browser attaches it to
// same-origin AND cross-site requests alike, and — unlike `Origin` — page JS
// cannot forge or suppress it, so it is the stronger signal. `Origin` is the
// fallback for the rare client that omits `Sec-Fetch-Site`. A request with
// NEITHER header present is allowed through: real CSRF requires a victim's
// BROWSER to carry their session cookie to our origin, and every browser that
// does that also sends one of these headers — a request missing both simply
// isn't the browser-driven cross-site case this guard defends against (OWASP
// CSRF cheat sheet's "Verifying Origin with Standard Headers").
export function isCrossOriginRequest(request: NextRequest): boolean {
  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite) return secFetchSite !== 'same-origin' && secFetchSite !== 'none';

  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true; // an unparseable Origin header is itself suspicious.
  }
}
