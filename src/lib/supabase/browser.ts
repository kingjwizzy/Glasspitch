// Browser-side, session-aware Supabase client (v2 premium). Used ONLY by the
// tiny client-side pieces of the auth surface (currently none need it directly
// — the login form is a Server Action, see src/app/login/actions.ts — but this
// is the sanctioned factory if a future client island needs to read the
// session directly, per the official @supabase/ssr pattern). Still the
// publishable key under RLS; never the secret key (ARCHITECTURE.md §7, §12).

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      'Supabase public env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.local.example).',
    );
  }
  return createBrowserClient<Database>(url, publishableKey);
}
