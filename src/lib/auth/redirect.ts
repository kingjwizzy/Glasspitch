// Shared `next=` redirect-target validation for the auth flow (/login,
// /auth/callback, /auth/confirm). A naive `path.startsWith('/')` check is NOT
// enough: a protocol-relative target like `//evil.com` also starts with `/`,
// but `new URL('//evil.com', 'https://glasspitch.com')` resolves to
// `https://evil.com` — browsers treat a leading `//` as "same scheme, new
// host". Worse, the WHATWG URL parser strips ASCII tab/newline/CR wherever
// they appear and treats `\` as `/` in special URLs, so `/\t//evil.com` and
// `/\/evil.com` ALSO resolve cross-origin despite passing a plain prefix
// check. Reject control characters and backslashes outright, then prove the
// survivor resolves same-origin before trusting it.
export function safeNextPath(raw: string | null | undefined, fallback = '/account'): string {
  if (!raw) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  try {
    // Final belt-and-braces: resolved against any origin, a safe path must
    // keep that origin. Catches anything the character checks above missed.
    if (new URL(raw, 'https://o.test').origin !== 'https://o.test') return fallback;
  } catch {
    return fallback;
  }
  return raw;
}
