import 'server-only';

// Email capture infrastructure (ARCHITECTURE.md §5 v3 email-capture
// amendment; ROADMAP.md §4 item 4). The route handlers under
// src/app/api/email/* are the ONE sanctioned writer of `email_subscribers` —
// they write that table only, via the service-role client (the table has zero
// anon/authenticated access, so the publishable key cannot touch it).
//
// Double-gated by design:
//   1. EMAIL_CAPTURE_ENABLED=1 — the owner's explicit switch. Absent → the
//      footer form renders NOTHING and the routes 503.
//   2. RESEND_API_KEY — the send provider. Absent → the form renders a quiet
//      "coming soon" line and the subscribe route 503s (never a crash).
//   3. The table itself lands with the concurrent migration 0007 — until it
//      exists, writes fail with a missing-table error the routes translate
//      into the same quiet 503 (isMissingTableError below).
//
// GDPR (§13): double opt-in (nothing is ever sent beyond the single
// confirmation email until the subscriber clicks its link), one-click
// unsubscribe in every email (List-Unsubscribe headers + a plain link), and
// the whole thing is described in /privacy.
//
// State model (matches migration 0007 exactly — there is no status column):
//   confirmed_at IS NULL  → pending double opt-in;
//   confirmed_at set      → confirmed subscriber;
//   unsubscribe           → the row is DELETED (the address is removed from
//                           our records entirely, the strongest opt-out).
// confirm_token is ROTATED once used (single-use, per the migration's
// documented convention); tokens are uuids generated here.

import { createHash, randomUUID } from 'node:crypto';

export function emailCaptureEnabled(): boolean {
  return process.env.EMAIL_CAPTURE_ENABLED === '1';
}

export function emailSendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Deliberately simple shape check (the confirmation email is the real
 *  validator — that's what double opt-in is for). */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: unknown): string | null {
  const email = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (email.length === 0 || email.length > 254) return null;
  return EMAIL_RE.test(email) ? email : null;
}

/** Confirm/unsubscribe link tokens — uuids, matching the columns' type. */
export function newToken(): string {
  return randomUUID();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validTokenShape(raw: unknown): string | null {
  const token = String(raw ?? '').trim();
  return UUID_RE.test(token) ? token.toLowerCase() : null;
}

/**
 * True when a Supabase/PostgREST error means `email_subscribers` (or one of
 * the columns this build expects) doesn't exist yet — i.e. migration 0007
 * hasn't landed. Callers translate this into the quiet "not switched on yet"
 * 503 rather than an error page.
 *   42P01  undefined_table (raw Postgres)
 *   42703  undefined_column (schema-shape drift from the expected contract)
 *   PGRST205  PostgREST schema cache has no such table
 */
export function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST205') {
    return true;
  }
  return /email_subscribers/i.test(error.message ?? '') && /find|exist/i.test(error.message ?? '');
}

// ── Send throttle support (audit fix #1) ────────────────────────────────────
// Backs the `request_email_send(p_email, p_ip_hash)` atomic RPC the subscribe
// route calls, server-side, before ever asking Resend to send. We never
// store or log a raw IP (GDPR-conscious, matches the rest of §13) — only a
// one-way SHA-256 hash of it goes anywhere, and only into the service-role-
// only `email_send_log` table via the RPC.

/**
 * Best-effort client IP for throttling purposes ONLY — never stored raw, only
 * hashed (see `hashIp`). `x-forwarded-for` is set by Vercel/most proxies as
 * `client, proxy1, proxy2, …`; the first entry is the original client. Falls
 * back to `x-real-ip`, then a constant sentinel so a request with neither
 * header still throttles (as one shared "unknown" bucket) rather than
 * bypassing the limit entirely.
 */
export function clientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const first = forwardedFor?.split(',')[0]?.trim();
  if (first) return first;
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  return 'unknown';
}

/** One-way SHA-256 hex digest of an IP address — what actually reaches the
 *  database via `request_email_send`'s `p_ip_hash` param. The raw IP itself
 *  is never persisted or logged anywhere. */
export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  /** Unsubscribe URL — set on every send as one-click List-Unsubscribe. */
  unsubscribeUrl: string;
}

/**
 * Send one plain-text email through the Resend HTTP API. Returns false on any
 * failure (callers degrade to a 503 — the capture surface never crashes a
 * page). Server-only; the API key never leaves this module.
 */
export async function sendEmail(mail: OutboundEmail): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const from = process.env.EMAIL_FROM ?? 'Glass Pitch <post@glasspitch.com>';

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        headers: {
          'List-Unsubscribe': `<${mail.unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
    if (!res.ok) {
      console.error('sendEmail: Resend responded', res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error('sendEmail: request failed', err);
    return false;
  }
}
