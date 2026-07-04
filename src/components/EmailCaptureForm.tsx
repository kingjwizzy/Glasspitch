// The quiet footer email-capture form (ARCHITECTURE.md §5 v3 email-capture
// amendment; ROADMAP.md §4 item 4). A plain <form> POST — zero client JS, so
// every static/ISR page stays static. Server Component: the env checks run at
// render (build) time, and the whole surface is double-gated:
//   EMAIL_CAPTURE_ENABLED unset  → renders NOTHING (feature off; today's
//                                  state until migration 0007 + owner switch);
//   enabled but no RESEND_API_KEY → a quiet "coming soon" line;
//   both set                      → the form.
// This is email capture (a newsletter), deliberately quieter than — and
// distinct from — the homepage's single account-signup affordance
// (DESIGN.md §6: no second competing signup surface, no urgency copy).

import { emailCaptureEnabled, emailSendConfigured } from '@/lib/email/capture';

export default function EmailCaptureForm() {
  if (!emailCaptureEnabled()) return null;

  if (!emailSendConfigured()) {
    return (
      <p className="mt-5 border-t border-line pt-4 text-xs text-fg-dim">
        Matchday email — the scored record in your inbox — is coming soon.
      </p>
    );
  }

  return (
    <form
      method="post"
      action="/api/email/subscribe"
      className="mt-5 border-t border-line pt-4"
    >
      <label htmlFor="email-capture" className="block text-sm font-medium text-fg">
        The scored record, by email
      </label>
      <p className="mt-1 text-xs leading-relaxed text-fg-dim">
        One plain email after each matchday — wins and losses at identical
        prominence. No streaks, no nudges.
      </p>
      <div className="mt-2 flex max-w-md gap-2">
        <input
          id="email-capture"
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="min-h-11 w-full min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-sm text-fg placeholder:text-fg-faint"
        />
        {/* Honeypot — hidden from real visitors and assistive tech alike. */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="hidden"
        />
        <button
          type="submit"
          className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-line bg-surface-2 px-4 text-sm font-medium text-fg transition-colors hover:text-green-bright"
        >
          Subscribe
        </button>
      </div>
      {/* fg-dim, not fg-faint (a11y audit fix): a consent/legal-basis
          statement, not an incidental hint — fg-faint fails WCAG AA below
          18px. */}
      <p className="mt-2 max-w-md text-xs leading-relaxed text-fg-dim">
        Double opt-in: we send one confirmation email and nothing more until
        you click it. Unsubscribe with one click, any time. Consent is the
        lawful basis — details in the privacy notice above.
      </p>
    </form>
  );
}
