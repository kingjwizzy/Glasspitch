import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { SITE_URL } from '@/lib/constants';
import {
  emailCaptureEnabled,
  emailSendConfigured,
  isMissingTableError,
  newToken,
  normalizeEmail,
  sendEmail,
} from '@/lib/email/capture';

// POST /api/email/subscribe — step one of double opt-in (ARCHITECTURE.md §5
// v3 email-capture amendment). Plain form POST from the footer (no JS): store
// the address as `pending` with fresh tokens and send ONE confirmation email;
// nothing else is ever sent until its link is clicked. This route (plus
// confirm/unsubscribe beside it) is the single sanctioned writer of
// `email_subscribers`, and writes that table only.
//
// Degradation is deliberate and quiet (the table lands with the concurrent
// migration 0007): env switch off / no send key / table missing → 503 with a
// plain sentence, never a crash and never a fake success.
export const dynamic = 'force-dynamic';

function unavailable(): Response {
  return new Response(
    'Email updates are not switched on yet — check back soon.',
    { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!emailCaptureEnabled() || !emailSendConfigured()) return unavailable();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('Bad request.', { status: 400 });
  }

  // Honeypot: a hidden field real visitors never fill. Bots that do get the
  // same redirect and nothing stored — no error to learn from.
  if (String(form.get('website') ?? '') !== '') {
    return NextResponse.redirect(new URL('/email/sent', SITE_URL), 303);
  }

  const email = normalizeEmail(form.get('email'));
  if (!email) {
    return new Response('Enter a valid email address.', { status: 400 });
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    console.error('email/subscribe: admin client unavailable', err);
    return unavailable();
  }

  const { data: existing, error: readError } = await admin
    .from('email_subscribers')
    .select('id, confirmed_at, unsubscribe_token')
    .eq('email', email)
    .maybeSingle();

  if (readError) {
    if (isMissingTableError(readError)) return unavailable();
    console.error('email/subscribe: read failed', readError.message);
    return unavailable();
  }

  // Already confirmed: nothing to store, nothing to send — same redirect as
  // every other outcome, so the form never leaks whether an address is on
  // the list. (An unsubscribed address has no row at all — unsubscribe
  // deletes it — so re-subscribing lands in the insert branch below.)
  if (existing?.confirmed_at) {
    return NextResponse.redirect(new URL('/email/sent', SITE_URL), 303);
  }

  let confirmToken: string;
  let unsubscribeToken: string;

  if (existing) {
    // Still pending (double-tap / lost email): rotate the confirm token,
    // refresh the consent timestamp, keep the unsubscribe token.
    confirmToken = newToken();
    unsubscribeToken = existing.unsubscribe_token;
    const { error } = await admin
      .from('email_subscribers')
      .update({
        confirm_token: confirmToken,
        consented_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) {
      if (isMissingTableError(error)) return unavailable();
      console.error('email/subscribe: update failed', error.message);
      return unavailable();
    }
  } else {
    confirmToken = newToken();
    unsubscribeToken = newToken();
    const { error } = await admin.from('email_subscribers').insert({
      email,
      confirm_token: confirmToken,
      unsubscribe_token: unsubscribeToken,
      consented_at: new Date().toISOString(),
    });
    if (error) {
      if (isMissingTableError(error)) return unavailable();
      console.error('email/subscribe: insert failed', error.message);
      return unavailable();
    }
  }

  const confirmUrl = `${SITE_URL}/api/email/confirm?token=${confirmToken}`;
  const unsubscribeUrl = `${SITE_URL}/api/email/unsubscribe?token=${unsubscribeToken}`;

  const sent = await sendEmail({
    to: email,
    subject: 'Confirm your Glass Pitch email',
    text: [
      'You (or someone using this address) asked for the Glass Pitch scored record by email — one plain email after each matchday, wins and losses alike.',
      '',
      `Confirm here: ${confirmUrl}`,
      '',
      'If this wasn’t you, ignore this email — nothing will ever be sent to this address without that confirmation.',
      '',
      `Unsubscribe at any time, one click: ${unsubscribeUrl}`,
      '',
      'Glass Pitch — analysis and probabilities only, not betting advice. 18+. Please gamble responsibly.',
    ].join('\n'),
    unsubscribeUrl,
  });

  if (!sent) {
    console.error('email/subscribe: confirmation send failed');
    return unavailable();
  }

  return NextResponse.redirect(new URL('/email/sent', SITE_URL), 303);
}
