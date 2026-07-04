// SERVER-ONLY secret-key Supabase client.
//
// The secret key bypasses Row Level Security and can write (ARCHITECTURE.md
// §7). It must NEVER reach the browser bundle (§12): the secret key is a
// secret. The Python jobs remain the only writer of football data; this
// client is used ONLY by the amendment-sanctioned server-only callers below
// (ARCHITECTURE.md §0/§5, amended 2026-07-03):
//   1. src/app/api/stripe/webhook/route.ts — the ONE writer of the billing
//      tables (`subscriptions`, `stripe_events`), signature-verified.
//   2. src/app/account/actions.ts's `deleteAccountAction` — self-serve GDPR
//      account deletion (`auth.admin.deleteUser`), which cascades to
//      `profiles`/`subscriptions` via FK constraints rather than writing a
//      billing row directly.
//   3. src/app/api/email/* (W6, §5 v3 email-capture amendment) — the ONE
//      writer of `email_subscribers` (double opt-in subscribe/confirm/
//      unsubscribe; the table has zero anon access). The subscribe route
//      additionally calls the `request_email_send` RPC (audit fix #1) before
//      sending, which records a throttled-send attempt into `email_send_log`
//      — still reached only through this same service-role client, never a
//      second admin surface.
//   4. src/lib/queries/openMatch.ts's `getOpenMatchInsights` (W6) — a
//      READ-ONLY exception: renders ONE deterministic match's premium
//      `fixture_insights` into the public cached match page per day ("open
//      match of the day", ROADMAP.md §2 owner-approved). Writes nothing.
// No other caller is sanctioned; adding one needs an explicit ARCHITECTURE.md
// amendment first, per CLAUDE.md's roster note. Note the user-picks writer
// path (/play) deliberately does NOT appear here — game picks go through the
// visitor's own RLS-scoped publishable-key client, never this one.
//
// `import 'server-only'` makes an accidental client-component import a BUILD
// error rather than only a runtime throw in the visitor's browser (the
// `typeof window` guard below is belt-and-braces on top of it, since it also
// catches a bare dynamic `require`/`import()` that bundling might not).

import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// Module-load guard: importing this file in the browser is a hard error.
if (typeof window !== 'undefined') {
  throw new Error(
    'supabaseAdmin.ts was imported in client code. The service-role key is ' +
      'server-only and must never reach the browser (ARCHITECTURE.md §7, §12).',
  );
}

let adminClient: SupabaseClient<Database> | undefined;

/**
 * Returns a memoised secret-key Supabase client. Server-only.
 * Throws if called in the browser or if the required env vars are absent.
 */
export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (typeof window !== 'undefined') {
    throw new Error(
      'getSupabaseAdmin() must not be called in the browser (server-only).',
    );
  }
  if (!adminClient) {
    const url =
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secretKey) {
      throw new Error(
        'Supabase admin env vars missing. Set SUPABASE_URL (or ' +
          'NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SECRET_KEY (server-only).',
      );
    }
    adminClient = createClient<Database>(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}
