import type { NextConfig } from "next";

// Security headers (ARCHITECTURE.md §12). Low blast-radius today — the site
// has zero client components, no cookies and no auth — but W2 adds Stripe
// Checkout/Elements and an auth cookie, so a hardened baseline ships now
// rather than being retrofitted under time pressure later.
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
// by script directives.)
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.stripe.com",
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
