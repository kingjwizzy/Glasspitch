'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// Shared sign-out Server Action (ARCHITECTURE.md §4 v2) — a plain <form
// action={signOut}> needs no client JS at all. Used by /account today; kept
// here rather than colocated so any future auth-aware surface can reuse it
// without duplicating the sign-out call.
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}
