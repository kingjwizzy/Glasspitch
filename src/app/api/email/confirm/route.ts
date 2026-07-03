import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { SITE_URL } from '@/lib/constants';
import { isMissingTableError, newToken, validTokenShape } from '@/lib/email/capture';

// GET /api/email/confirm?token=… — step two of double opt-in (ARCHITECTURE.md
// §5 v3 email-capture amendment): the click that turns a pending address into
// a confirmed subscriber. Deliberately NOT gated on EMAIL_CAPTURE_ENABLED — a
// link that was legitimately emailed must keep working even if the owner
// later flips the capture form off. Idempotent: re-clicking a used link lands
// on the same confirmation page.
export const dynamic = 'force-dynamic';

function invalidLink(): Response {
  return new Response(
    'This confirmation link isn’t valid — it may have been replaced by a newer email. You can subscribe again from the site footer.',
    { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
}

export async function GET(request: Request): Promise<Response> {
  const token = validTokenShape(new URL(request.url).searchParams.get('token'));
  if (!token) return invalidLink();

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    console.error('email/confirm: admin client unavailable', err);
    return invalidLink();
  }

  const { data: row, error: readError } = await admin
    .from('email_subscribers')
    .select('id, confirmed_at')
    .eq('confirm_token', token)
    .maybeSingle();

  if (readError) {
    if (!isMissingTableError(readError)) {
      console.error('email/confirm: read failed', readError.message);
    }
    return invalidLink();
  }
  // No row: unknown token, an already-used (rotated) link, or an address
  // that unsubscribed (its row was deleted — a later opt-out always wins).
  if (!row) return invalidLink();

  // Set confirmed_at and ROTATE the token — the emailed link is single-use,
  // per the migration's documented convention.
  const { error } = await admin
    .from('email_subscribers')
    .update({
      confirmed_at: row.confirmed_at ?? new Date().toISOString(),
      confirm_token: newToken(),
    })
    .eq('id', row.id);
  if (error) {
    console.error('email/confirm: update failed', error.message);
    return invalidLink();
  }

  return NextResponse.redirect(new URL('/email/confirmed', SITE_URL), 303);
}
