import type { Metadata } from 'next';
import LoginForm from './LoginForm';
import { safeNextPath } from '@/lib/auth/redirect';

// /login — v2 premium auth (ARCHITECTURE.md §4). Kept OUT of the public nav,
// noindexed and out of the sitemap until the owner flips premium live
// (ARCHITECTURE.md §13). Middleware (src/middleware.ts) already redirects an
// already-signed-in visitor straight to /account, so this page only ever
// renders for a genuinely anonymous visitor.
export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to Glass Pitch with a magic link — no password.',
  robots: { index: false, follow: false },
};

interface LoginPageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next, error } = await searchParams;
  const safeNext = safeNextPath(next);

  // A sign-in link that failed verification bounces back here with ?error
  // (see /auth/confirm + /auth/callback). Without surfacing it, the visitor
  // just sees the plain form again and assumes the site is broken — so say
  // plainly what happened and that a fresh link fixes it.
  const linkFailed = error === 'confirm' || error === 'callback';

  // Resume-to-Stripe (audit #21): a visitor arrives here mid-checkout when
  // /api/stripe/checkout redirected them to sign in first — say so plainly,
  // rather than a generic "Sign in" that makes it look like they lost their
  // place. Checks /checkout/resume (not /api/stripe/checkout — that route is
  // POST-only since the CSRF fix, so it's no longer a redirect target).
  const isCheckoutResume = safeNext.startsWith('/checkout/resume');

  // "Currently a test-mode preview" is an internal-status disclosure that
  // must never linger once premium is actually live (same env gate as the
  // header's "Go Premium" affordance and /premium's indexability).
  const premiumIsLive = process.env.NEXT_PUBLIC_PREMIUM_LIVE === '1';

  return (
    <article className="mx-auto max-w-sm space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          {isCheckoutResume ? 'Sign in to finish subscribing' : 'Sign in'}
        </h1>
        <p className="text-sm leading-relaxed text-fg-dim">
          Enter your email and we&rsquo;ll send you a one-time link — no
          password to remember. Every prediction and the full ledger stay free
          and public whether or not you sign in.
        </p>
      </header>

      {linkFailed ? (
        <p
          role="alert"
          className="rounded-xl border border-line bg-surface px-4 py-3 text-sm leading-relaxed text-miss-bright"
        >
          That sign-in link didn&rsquo;t work — it may have expired or already
          been used. Enter your email below and we&rsquo;ll send you a fresh
          one.
        </p>
      ) : null}

      <section className="space-y-2 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-sm font-medium text-fg">
          What a Glass Pitch account is for, today
        </h2>
        <ul className="space-y-1.5 text-sm leading-relaxed text-fg-dim">
          <li>
            {premiumIsLive ? (
              <>
                Managing a Glass Pitch Premium subscription — see{' '}
                <a
                  href="/premium"
                  className="text-green underline transition-colors hover:text-green-bright"
                >
                  what it adds
                </a>
                .
              </>
            ) : (
              <>
                Managing a Glass Pitch Premium subscription (currently a
                test-mode preview — see{' '}
                <a
                  href="/premium"
                  className="text-green underline transition-colors hover:text-green-bright"
                >
                  what it adds
                </a>
                ).
              </>
            )}
          </li>
          <li>No newsletter or marketing email yet — we don&rsquo;t send any.</li>
          <li>No password: we email a one-time link, nothing else.</li>
        </ul>
      </section>

      <LoginForm next={safeNext} />
    </article>
  );
}
