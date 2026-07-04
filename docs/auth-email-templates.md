# Auth email templates + login method (owner-configured)

## Recommendation: keep magic-link (passwordless), fix the email

The login mechanics are fine — the problem the owner hit is that Supabase's
**default** email is unbranded and confusing ("Confirm your signup / verify
email"). That's a 5-minute template change, **not** a reason to switch to
usernames + passwords.

Why magic-link stays the right call for Glass Pitch:

- No passwords to forget, reset, or leak → far less support burden and a smaller
  security surface for a small team.
- Lower friction for casual football fans — no password to invent.
- Passwords would add a signup flow, a strength meter, a reset flow, and breach
  risk, for a free predictions game. Not worth it.

Optional future upgrade: **"Continue with Google"** one-tap sign-in (no email at
all) — highest-conversion option. Needs Google OAuth credentials; say the word.

## Fix the email now (Supabase Dashboard → Authentication → Email Templates)

Supabase sends the **"Confirm signup"** template to a first-time email and the
**"Magic Link"** template to a returning one — so brand **both** identically or
the first-ever sign-in still looks like the default. For each:

- **Subject:** `Sign in to Glass Pitch`
- **Message body (HTML):** paste the template below.

```html
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f4f6f5;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:440px;background:#ffffff;border:1px solid #e3e8e5;border-radius:14px;overflow:hidden;">
      <tr><td style="background:#0e1311;padding:20px 28px;">
        <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#eaf0ec;">Glass Pitch</span>
      </td></tr>
      <tr><td style="padding:28px;">
        <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#111111;">Sign in to Glass Pitch</h1>
        <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#444444;">Tap the button below to sign in. This link works once and expires shortly, so use it soon after it arrives.</p>
        <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#35b27a;color:#0e1311;font-size:15px;font-weight:600;text-decoration:none;padding:13px 26px;border-radius:10px;">Sign in</a>
        <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#777777;">If the button doesn't work, copy and paste this link into your browser:<br><a href="{{ .ConfirmationURL }}" style="color:#1f8f5f;word-break:break-all;">{{ .ConfirmationURL }}</a></p>
        <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#777777;">Didn't request this? You can safely ignore this email — no one can sign in without the link.</p>
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #eef1f0;">
        <p style="margin:0;font-size:12px;line-height:1.5;color:#9aa3a0;">Glass Pitch — football analysis, not betting advice. 18+. Please gamble responsibly.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
```

`{{ .ConfirmationURL }}` works with the current `/auth/confirm` + `/auth/callback`
handlers, and is enough for **same-browser** sign-in (the common case).

## Cross-device robustness (optional but recommended)

To make a link **requested on one device but opened on another** work, swap the
two `{{ .ConfirmationURL }}` occurrences for the token-hash recipe (already
handled by `src/app/auth/confirm/route.ts`):

- **Magic Link** template: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next=/account`
- **Confirm signup** template: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/account`

Ensure **Site URL** (Auth → URL Configuration) is `https://glasspitch.com` and
`https://glasspitch.com/auth/confirm` is in the **Redirect URLs** allow-list.
