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
  searchParams: Promise<{ next?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next } = await searchParams;
  const safeNext = safeNextPath(next);

  return (
    <article className="mx-auto max-w-sm space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Sign in
        </h1>
        <p className="text-sm leading-relaxed text-fg-dim">
          Enter your email and we&rsquo;ll send you a one-time link — no
          password to remember. Every prediction and the full ledger stay free
          and public whether or not you sign in.
        </p>
      </header>

      <section className="space-y-2 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-sm font-medium text-fg">
          What a Glass Pitch account is for, today
        </h2>
        <ul className="space-y-1.5 text-sm leading-relaxed text-fg-dim">
          <li>
            Managing a Glass Pitch Premium subscription (currently a test-mode
            preview — see{' '}
            <a
              href="/premium"
              className="text-green underline transition-colors hover:text-green-bright"
            >
              what it adds
            </a>
            ).
          </li>
          <li>No newsletter or marketing email yet — we don&rsquo;t send any.</li>
          <li>No password: we email a one-time link, nothing else.</li>
        </ul>
      </section>

      <LoginForm next={safeNext} />
    </article>
  );
}
