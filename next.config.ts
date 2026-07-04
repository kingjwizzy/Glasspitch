import type { NextConfig } from "next";

// Security headers (ARCHITECTURE.md §12; hardened further, security audit
// finding #5). Applied via next.config's `headers()` rather than
// src/middleware.ts: the CSP must cover EVERY route (every public ISR/SSG
// page included), whereas middleware here is deliberately scoped (see its own
// `config.matcher`) to only the auth/billing/game paths — broadening it to
// match everything would re-run session-cookie logic on every cached page for
// no reason. A static, build-time header list has no such cost.
//
// Threat model note this policy leans on (audit finding #6): @supabase/ssr's
// session cookie is deliberately NOT httpOnly (createBrowserClient — see
// src/lib/supabase/browser.ts / useAuthState.ts — reads the session straight
// from the cookie client-side, which requires JS access to it). That means an
// XSS bug, not just a network attacker, could exfiltrate a visitor's session —
// so `script-src` staying as tight as possible (not a wildcard, no
// 'unsafe-eval') is this policy's single most load-bearing line, not a
// formality.
//
// `style-src 'unsafe-inline'` is required, not incidental: ProbabilityBar
// (src/components/ProbabilityBar.tsx) renders segment widths via an inline
// `style` attribute (computed percentages can't be static Tailwind classes),
// and CSP's `style-src` governs the `style=""` attribute as well as `<style>`
// elements.
//
// `script-src 'unsafe-inline'` is likewise required by the framework, not by
// our code: the Next.js App Router injects inline bootstrap/RSC-flight
// `<script>self.__next_f.push(...)</script>` tags into EVERY page (static and
// dynamic alike, even with zero "use client" files). Blocking them breaks the
// flight stream client-side ("Connection closed." uncaught error on every
// route — caught by e2e). The payloads are page-specific, so hash-based CSP
// is impractical, and the strict alternative — per-request nonces via
// middleware — forces dynamic rendering, defeating the ISR/full-route-cache
// architecture every page relies on. Revisit with nonces scoped to dynamic
// authenticated segments when W2 adds them. (JSON-LD data blocks were never
// the issue: `type="application/ld+json"` is non-executable and ungoverned
// by script directives.) `'unsafe-eval'` is deliberately absent — nothing in
// this app needs it.
//
// The OG/icon routes (icon.tsx, apple-icon.tsx, opengraph-image.tsx,
// src/lib/og.ts) render `<img src="data:...">` tags, but only INSIDE Satori's
// server-side ImageResponse renderer — that markup is turned into a PNG on
// the server and never reaches a browser DOM, so it is entirely outside the
// browser-enforced CSP below; nothing needs to be relaxed for it.
//
// `connect-src` includes the live Supabase project origin (not just 'self'):
// useAuthState.ts's client-side `supabase.auth.getSession()` /
// `onAuthStateChange` — the header's sign-in/account probe, present on every
// page — talks to Supabase Auth directly from the browser, so without this
// the header's auth state would silently fail to resolve on every route.
//
// `form-action` allow-lists Stripe's OWN hosted-checkout/portal domains, not
// just 'self': /premium and /checkout/resume each POST to a same-origin
// Route Handler that responds with a 303 redirect to a `checkout.stripe.com`
// / `billing.stripe.com` URL (never an iframe — see the Stripe route
// comments), and Chromium-based browsers enforce `form-action` against the
// FINAL redirect destination, not just the form's own `action=`.
function supabaseOrigin(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null; // malformed/missing at build time — omit rather than crash the build.
  }
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  ["connect-src 'self' https://api.stripe.com", supabaseOrigin()].filter(Boolean).join(' '),
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // W6 share kit: the OG image routes read vendored brand fonts and flag
  // SVGs from the local filesystem at render time (zero network calls —
  // src/lib/og.ts). The per-code flag read is dynamic, which static tracing
  // can't follow, so pin the whole flag set + fonts into every traced
  // serverless bundle explicitly (they're ~200KB total). /ledger's OG route
  // needs only the fonts (its subject is the aggregate record, not any one
  // team, so it never reads a flag); /board's needs both, same as
  // /match/[id] and /chances. Every OG route added here MUST be added to
  // this map, or it 500s in prod serverless (the filesystem reads it makes
  // aren't otherwise traced into the deployed bundle).
  outputFileTracingIncludes: {
    '/match/[id]/opengraph-image': ['./src/assets/og/*.ttf', './public/flags/*.svg'],
    '/chances/opengraph-image': ['./src/assets/og/*.ttf', './public/flags/*.svg'],
    '/ledger/opengraph-image': ['./src/assets/og/*.ttf'],
    '/board/opengraph-image': ['./src/assets/og/*.ttf', './public/flags/*.svg'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: CSP },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
