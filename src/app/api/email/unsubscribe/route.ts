import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { SITE_URL } from '@/lib/constants';
import { isMissingTableError, validTokenShape } from '@/lib/email/capture';

// GET /api/email/unsubscribe?token=… — one-click unsubscribe (GDPR;
// ARCHITECTURE.md §5 v3 email-capture amendment, §13). Deliberately NOT gated
// on EMAIL_CAPTURE_ENABLED: opting out must always work, whatever state the
// capture form is in. Idempotent — clicking twice lands on the same page.
// Also accepts POST for RFC 8058 one-click List-Unsubscribe (mail clients
// POST to the same URL).
export const dynamic = 'force-dynamic';

function invalidLink(): Response {
  return new Response(
    'This unsubscribe link isn’t valid. If you keep receiving email from us, reply to any of them and a human will remove you.',
    { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
}

async function unsubscribe(request: Request): Promise<Response> {
  const token = validTokenShape(new URL(request.url).searchParams.get('token'));
  if (!token) return invalidLink();

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    console.error('email/unsubscribe: admin client unavailable', err);
    return invalidLink();
  }

  // Unsubscribing DELETES the row — the address is removed from our records
  // entirely, not merely flagged (the schema has no status column by design;
  // this is also the cleanest GDPR outcome). Idempotent in effect: a second
  // click finds no row and gets the invalid-link text below.
  const { data: deleted, error } = await admin
    .from('email_subscribers')
    .delete()
    .eq('unsubscribe_token', token)
    .select('id');

  if (error) {
    if (!isMissingTableError(error)) {
      console.error('email/unsubscribe: delete failed', error.message);
    }
    return invalidLink();
  }
  if (!deleted || deleted.length === 0) return invalidLink();

  return NextResponse.redirect(new URL('/email/unsubscribed', SITE_URL), 303);
}

export async function GET(request: Request): Promise<Response> {
  return unsubscribe(request);
}

// RFC 8058 one-click unsubscribe: mail clients POST with no body we need.
export async function POST(request: Request): Promise<Response> {
  return unsubscribe(request);
}
