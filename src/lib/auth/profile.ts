import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

// Records the 18+ attestation the /login form requires on every sign-in
// attempt (ARCHITECTURE.md §13, DESIGN.md §6 — no dark patterns, no skipping
// it) onto the visitor's `profiles` row.
//
// The row itself is guaranteed to already exist by the time this runs: the
// backend-jobs migration auto-creates it via a `handle_new_user()` trigger on
// `auth.users` insert (the standard Supabase pattern), which fires as part of
// the sign-up that happens inside `verifyOtp`/`exchangeCodeForSession` before
// either ever returns. So this is a plain UPDATE, not an upsert — which also
// matches the actual RLS grants exactly (profiles has an owner-UPDATE policy
// but deliberately NO owner-INSERT policy; an upsert whose INSERT path RLS
// then rejects would just be a confusing way to get the same result).
//
// The attestation travels as Supabase auth `user_metadata` (set via the
// `options.data` passed to `signInWithOtp` in src/app/login/actions.ts) rather
// than a URL query param, because a magic-link click often happens on a
// different device/browser than the one that submitted the form — metadata
// attached to the auth request itself survives that round trip; a query
// param on the emailRedirectTo would not reliably.
//
// Uses the USER'S OWN per-request client (never the service-role key).
// Best-effort: a failure here must never block sign-in itself, since the
// profile is a secondary compliance record, not the auth session.
export async function ensureProfile(
  supabase: SupabaseClient<Database>,
  user: User,
): Promise<void> {
  const is18Plus = user.user_metadata?.is_18_plus === true;
  if (!is18Plus) return; // nothing new to record; the row already defaults to false.

  try {
    const { error } = await supabase
      .from('profiles')
      .update({ is_18_plus: true })
      .eq('id', user.id);
    if (error) console.error('ensureProfile: failed to update profile row', error.message);
  } catch (err) {
    console.error('ensureProfile: failed to update profile row', err);
  }
}
