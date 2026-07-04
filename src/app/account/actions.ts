'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { LEADERBOARD_DISPLAY_NAME_MAX } from '@/lib/constants';

// Self-serve GDPR account deletion (ARCHITECTURE.md §4 v2; requires the
// visitor to type DELETE as a confirm step — see /account/delete/page.tsx —
// so this is never a single accidental click).
//
// This is the ONE other sanctioned use of the service-role client besides the
// Stripe webhook (src/app/api/stripe/webhook/route.ts): deleting the
// `auth.users` row is an identity-lifecycle operation the user themselves
// triggered, not an ordinary billing-table write. It CASCADES to `profiles`
// and `subscriptions` via their FK constraints (the backend-jobs migration),
// so this action never directly writes to a billing table itself — the
// invariant "only the Stripe webhook writes billing tables" still holds for
// every *billing* write; this is a DB-level cascade of an auth deletion.
export async function deleteAccountAction(formData: FormData): Promise<void> {
  const typedConfirmation = String(formData.get('confirm') ?? '');
  if (typedConfirmation !== 'DELETE') {
    redirect('/account/delete?error=confirm');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = getSupabaseAdmin();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error('deleteAccountAction: deleteUser failed', error);
    redirect('/account/delete?error=failed');
  }

  // The user row (and its session) is already gone server-side; sign-out here
  // just clears the now-invalid session cookie from this browser.
  await supabase.auth.signOut();
  redirect('/?accountDeleted=1');
}

// ── leaderboard opt-in (RAMBO wave 2 improvement #5) ───────────────────────
//
// Writes go through the SIGNED-IN visitor's own per-request client — never
// the service-role key — under the existing owner-update RLS policy on
// `profiles` (the same grant `lib/auth/profile.ts`'s `ensureProfile` already
// relies on to update `is_18_plus`; this just updates two more columns on the
// same row). This is a genuine, explicit, reversible PRIVACY control: opting
// in publishes the chosen display name plus the visitor's Brier-vs-model
// record on the public /leaderboard page; it is off by default, and opting
// back out removes the row from the NEXT nightly rebuild (the leaderboard
// table is a jobs-written snapshot, not updated live).

const DISPLAY_NAME_MIN = 1;

function cleanDisplayName(raw: FormDataEntryValue | null): string | null {
  const s = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length >= DISPLAY_NAME_MIN && s.length <= LEADERBOARD_DISPLAY_NAME_MAX
    ? s
    : null;
}

export async function updateLeaderboardOptInAction(formData: FormData): Promise<void> {
  const optIn = formData.get('leaderboardOptIn') === 'on';
  const displayName = cleanDisplayName(formData.get('leaderboardDisplayName'));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/account');

  // Opting IN requires a valid name to publish — reject rather than silently
  // opt someone into a public page with no name to show. Opting OUT never
  // requires one: a visitor can untick the box without also being forced to
  // clear a name they might want to keep for next time.
  if (optIn && !displayName) {
    redirect('/account?leaderboardError=name');
  }

  const update: { leaderboard_opt_in: boolean; leaderboard_display_name?: string } = {
    leaderboard_opt_in: optIn,
  };
  if (displayName) update.leaderboard_display_name = displayName;

  const { error } = await supabase.from('profiles').update(update).eq('id', user.id);
  if (error) {
    console.error('updateLeaderboardOptInAction: update failed', error.message);
    redirect('/account?leaderboardError=save');
  }

  redirect('/account?leaderboardSaved=1');
}
