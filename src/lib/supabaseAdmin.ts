// SERVER-ONLY secret-key Supabase client.
//
// The secret key bypasses Row Level Security and can write (ARCHITECTURE.md
// §7). It must NEVER reach the browser bundle (§12): the secret key is a
// secret. In this product the Python jobs are the canonical writers; this
// client is reserved for a future sanctioned server-side writer (e.g. the W2
// Stripe webhook route) — see CLAUDE.md's roster note that widening the "jobs
// are the only DB writers" invariant needs an explicit ARCHITECTURE.md
// amendment before anything actually writes through it.
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
