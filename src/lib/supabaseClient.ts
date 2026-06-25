// Public, read-only Supabase client for the browser and server components.
//
// Uses the publishable key only. Row Level Security makes the public role
// read-only (ARCHITECTURE.md §7): the website NEVER writes and never calls the
// football API on the request path (§5 golden rule). The secret key is never
// used here — see supabaseAdmin.ts.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

let browserClient: SupabaseClient<Database> | undefined;

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
 * Returns a memoised publishable-key Supabase client. Created lazily so that
 * pages which do not (yet) query the database still build when env vars are
 * absent.
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (!browserClient) {
    const { url, publishableKey } = readPublicEnv();
    browserClient = createClient<Database>(url, publishableKey, {
      // v1 holds no personal data and has no auth (ARCHITECTURE.md §3, §13).
      auth: { persistSession: false },
    });
  }
  return browserClient;
}
