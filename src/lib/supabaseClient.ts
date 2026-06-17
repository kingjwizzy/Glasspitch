// Public, read-only Supabase client for the browser and server components.
//
// Uses the anon key only. Row Level Security makes the anon role read-only
// (ARCHITECTURE.md §7): the website NEVER writes and never calls the football
// API on the request path (§5 golden rule). The service-role key is never used
// here — see supabaseAdmin.ts.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

let browserClient: SupabaseClient<Database> | undefined;

function readPublicEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Supabase public env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.local.example).',
    );
  }
  return { url, anonKey };
}

/**
 * Returns a memoised anon Supabase client. Created lazily so that pages which
 * do not (yet) query the database still build when env vars are absent.
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (!browserClient) {
    const { url, anonKey } = readPublicEnv();
    browserClient = createClient<Database>(url, anonKey, {
      // v1 holds no personal data and has no auth (ARCHITECTURE.md §3, §13).
      auth: { persistSession: false },
    });
  }
  return browserClient;
}
