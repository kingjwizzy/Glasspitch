'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

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
