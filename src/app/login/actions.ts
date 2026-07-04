'use server';

// Server Action behind the login form (ARCHITECTURE.md §4 v2; keeps the client
// JS on /login to a minimum — see LoginForm.tsx). Runs entirely server-side:
// validates the 18+ attestation is present, then asks Supabase Auth to send a
// magic link. Never creates a session itself — that only happens once the
// visitor clicks the link and lands on /auth/confirm or /auth/callback.

import { createClient } from '@/lib/supabase/server';
import { SITE_URL } from '@/lib/constants';
import { safeNextPath } from '@/lib/auth/redirect';
import type { LoginFormState } from './state';

// NOTE: a "use server" file can export ONLY async functions. The LoginFormState
// type and the INITIAL_LOGIN_STATE object live in ./state.ts — exporting a
// non-function value from here throws at runtime and crashes /login.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendMagicLink(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const email = String(formData.get('email') ?? '').trim();
  const is18Plus = formData.get('is18') === 'on';
  const next = safeNextPath(String(formData.get('next') ?? ''));

  if (!is18Plus) {
    return {
      status: 'error',
      message: 'Please confirm you are 18 or over to continue.',
    };
  }
  if (!EMAIL_RE.test(email)) {
    return { status: 'error', message: 'Enter a valid email address.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Both /auth/confirm and /auth/callback are wired to handle whichever
      // shape the confirmation link takes (token_hash-based or PKCE code-
      // based) — see their route handlers' doc comments.
      emailRedirectTo: `${SITE_URL}/auth/confirm?next=${encodeURIComponent(next)}`,
      // Carried on the auth request itself (not a URL param) so it survives
      // the visitor opening the link on a different device — see
      // lib/auth/profile.ts.
      data: { is_18_plus: true },
    },
  });

  if (error) {
    console.error('sendMagicLink: signInWithOtp failed', error);
    return {
      status: 'error',
      message: 'Could not send a magic link right now. Please try again shortly.',
    };
  }

  return {
    status: 'sent',
    message: `Check ${email} for a sign-in link. It expires shortly, so use it soon after it arrives.`,
  };
}
