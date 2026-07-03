import { type EmailOtpType } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ensureProfile } from '@/lib/auth/profile';
import { safeNextPath } from '@/lib/auth/redirect';

// Magic-link / OTP verification route, per the official @supabase/ssr Next.js
// pattern. This is the target when the Supabase project's email templates are
// customised to link here with `token_hash`/`type` (the documented recipe for
// "email based auth with PKCE for SSR") — a Supabase Dashboard → Auth → Email
// Templates change that is an OWNER/ops step, not code; see the frontend-dev
// report for the exact template string. /auth/callback (below) is the
// fallback that handles Supabase's DEFAULT template shape instead, so sign-in
// works whichever template is actually configured.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const safeNext = safeNextPath(searchParams.get('next'));

  if (tokenHash && type) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (!error) {
      if (data.user) await ensureProfile(supabase, data.user);
      return NextResponse.redirect(new URL(safeNext, origin));
    }
    console.error('auth/confirm: verifyOtp failed', error);
  }

  return NextResponse.redirect(new URL('/login?error=confirm', origin));
}
