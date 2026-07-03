import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ensureProfile } from '@/lib/auth/profile';
import { safeNextPath } from '@/lib/auth/redirect';

// PKCE code-exchange callback, per the official @supabase/ssr Next.js pattern.
// This is the target for: (a) Supabase's DEFAULT magic-link email template
// (its `{{ .ConfirmationURL }}` redirects here with a `?code=` once the
// project's redirect_to allow-list includes this route), and (b) Google OAuth
// once it's configured (ARCHITECTURE.md §4 — "ready but unconfigured"): both
// flows exchange a `code` for a session the same way. /auth/confirm handles
// the alternate token_hash-based template shape instead.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const safeNext = safeNextPath(searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (data.user) await ensureProfile(supabase, data.user);
      return NextResponse.redirect(new URL(safeNext, origin));
    }
    console.error('auth/callback: exchangeCodeForSession failed', error);
  }

  return NextResponse.redirect(new URL('/login?error=callback', origin));
}
