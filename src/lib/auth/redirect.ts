// Shared `next=` redirect-target validation for the auth flow (/login,
// /auth/callback, /auth/confirm). A naive `path.startsWith('/')` check is NOT
// enough: a protocol-relative target like `//evil.com` also starts with `/`,
// but `new URL('//evil.com', 'https://glasspitch.com')` resolves to
// `https://evil.com` — browsers treat a leading `//` as "same scheme, new
// host". Left unchecked, that turns the post-login redirect into an
// open-redirect phishing vector (attacker sends a victim a link to our own
// /login?next=//evil.com; after a genuine sign-in, we'd bounce them
// cross-origin). Reject anything that isn't a plain, same-origin path.
export function safeNextPath(raw: string | null | undefined, fallback = '/account'): string {
  if (!raw) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  return raw;
}
