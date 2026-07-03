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
          password to remember. This is only needed for a Glass Pitch Premium
          account; every prediction and the full ledger stay free and public
          without signing in at all.
        </p>
      </header>

      <LoginForm next={safeNext} />
    </article>
  );
}
