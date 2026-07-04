import { type EmailOtpType } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ensureProfile } from '@/lib/auth/profile';
import { safeNextPath } from '@/lib/auth/redirect';

// Magic-link / OTP verification route, per the official @supabase/ssr Next.js
// pattern. It accepts BOTH confirmation-link shapes so sign-in works no matter
// which Supabase email template is configured:
//   1. `?token_hash=&type=`  — the CUSTOM "PKCE for SSR" template recipe
//      (Dashboard → Auth → Email Templates); verified with `verifyOtp`, and
//      works cross-device (no PKCE code_verifier cookie required).
//   2. `?code=`              — Supabase's DEFAULT magic-link template, whose
//      `{{ .ConfirmationURL }}` routes through GoTrue's /verify and redirects
//      back here with a PKCE `code`; exchanged with `exchangeCodeForSession`
//      (works when the link is opened in the same browser that requested it).
// Handling both here is what makes the default template work out of the box —
// previously this route only handled shape (1), so a default-template `?code=`
// link fell straight through to `/login?error=confirm` and sign-in failed.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const code = searchParams.get('code');
  const safeNext = safeNextPath(searchParams.get('next'));

  const supabase = await createClient();

  // Shape (1): custom token_hash template — cross-device safe.
  if (tokenHash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      if (data.user) await ensureProfile(supabase, data.user);
      return NextResponse.redirect(new URL(safeNext, origin));
    }
    console.error('auth/confirm: verifyOtp failed', error);
    return NextResponse.redirect(new URL('/login?error=confirm', origin));
  }

  // Shape (2): default template PKCE code — same-browser flow.
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (data.user) await ensureProfile(supabase, data.user);
      return NextResponse.redirect(new URL(safeNext, origin));
    }
    console.error('auth/confirm: exchangeCodeForSession failed', error);
    return NextResponse.redirect(new URL('/login?error=confirm', origin));
  }

  return NextResponse.redirect(new URL('/login?error=confirm', origin));
}
