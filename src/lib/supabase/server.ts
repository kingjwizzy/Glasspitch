import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';

// Per-request, cookie-bound Supabase client for auth-aware server code (v2
// premium: /login, /auth/*, /account/*, /premium/*, the Stripe API routes,
// and /match/[id]/insights). Still the PUBLISHABLE key under RLS — this is
// NOT a privilege escalation over src/lib/supabaseClient.ts, it is that same
// read-only anon role, just made session-aware so RLS can additionally see
// `auth.uid()` and gate premium/billing rows accordingly (ARCHITECTURE.md §7
// v2 amendment). Every public, non-authed page keeps using the plain
// singleton in supabaseClient.ts — this file is only ever imported from the
// auth-gated route tree, never from a public ISR page (that would force it
// dynamic and defeat the full-route cache).
//
// A NEW client is created per call (not memoised) because it is bound to
// THIS request's cookies — memoising it like the anon singleton would leak
// one visitor's session into another's request.

function readPublicEnv(): { url: string; publishableKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      'Supabase public env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.local.example).',
    );
  }
  return { url, publishableKey };
}

/**
 * Create a per-request Supabase client bound to the current request's
 * cookies, per the official @supabase/ssr Next.js App Router pattern.
 *
 * `setAll` is wrapped in try/catch: a Server Component cannot set cookies
 * (Next.js throws), so a session refresh triggered from a page render is a
 * harmless no-op there — middleware (src/middleware.ts) is what actually
 * refreshes and persists a renewed session cookie for the routes it covers.
 * Route Handlers and Server Actions CAN set cookies, and do, via this same
 * path (e.g. /auth/callback, /auth/confirm, sign-out, the account-deletion
 * action).
 */
export async function createClient() {
  const { url, publishableKey } = readPublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render — no-op (see doc comment).
        }
      },
    },
  });
}
