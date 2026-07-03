import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { joinPoolAction } from '@/app/play/actions';
import { ArrowRightIcon } from '@/components/icons';

// /play/join/[code] — a pool invite link (ARCHITECTURE.md §5 v3 game-picks
// amendment). The pool's name is deliberately NOT shown before joining:
// resolving a pool by code is something only the join_pool() RPC may do, at
// the moment of joining — the page never claims to know more than RLS lets
// it. Authed + dynamic; anonymous visitors get a sign-in path that returns
// here. Private surface: noindexed.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Join a pool',
  robots: { index: false, follow: false },
};

// Server-generated codes are 12 hex chars (gen_random_bytes(6)); accept a
// slightly wider shape so a future code format doesn't 404 old links.
const CODE_RE = /^[a-z0-9-]{4,64}$/;

const ERROR_COPY: Record<string, string> = {
  'join-invalid': 'Enter a display name of up to 24 characters.',
  'join-badcode':
    'This invite link doesn’t match an open pool — it may have been deleted. Ask your friend for a fresh link.',
  'join-failed': 'Could not join the pool right now. Please try again shortly.',
};

interface JoinPageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function JoinPoolPage({ params, searchParams }: JoinPageProps) {
  const [{ code: rawCode }, { error }] = await Promise.all([params, searchParams]);
  const code = rawCode.toLowerCase();
  if (!CODE_RE.test(code)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const returnPath = `/play/join/${code}`;
  const errorMessage = error ? ERROR_COPY[error] : undefined;

  return (
    <article className="mx-auto max-w-xl space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          You&rsquo;re invited to a pool
        </h1>
        <p className="text-sm leading-relaxed text-fg-dim">
          A friend wants you in their &ldquo;Beat the model&rdquo; pool: call
          each match before kickoff, get Brier-scored after full time, and see
          who reads the game best. Free, and prize-free forever.
        </p>
      </header>

      {!user ? (
        <section className="glass-raised px-5 py-5">
          <p className="text-sm leading-relaxed text-fg-dim">
            Sign in to join — a free account needs just an email and an 18+
            confirmation. You&rsquo;ll come straight back here.
          </p>
          <Link
            href={`/login?next=${encodeURIComponent(returnPath)}`}
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-green px-4 text-sm font-medium text-bg transition-colors hover:bg-green-bright"
          >
            Sign in to join
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </section>
      ) : (
        <section className="glass px-4 py-4">
          {errorMessage && (
            <p role="alert" className="mb-3 text-sm text-miss-bright">
              {errorMessage}
            </p>
          )}
          <form action={joinPoolAction} className="space-y-3">
            <input type="hidden" name="return" value={returnPath} />
            <input type="hidden" name="code" value={code} />
            <div className="space-y-1">
              <label htmlFor="display-name" className="block text-xs text-fg-dim">
                Your display name in this pool
              </label>
              <input
                id="display-name"
                name="displayName"
                type="text"
                required
                maxLength={24}
                placeholder="Shown to pool members only"
                className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg placeholder:text-fg-faint"
              />
            </div>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-lg bg-green px-4 text-sm font-medium text-bg transition-colors hover:bg-green-bright"
            >
              Join the pool
            </button>
          </form>
        </section>
      )}

      <p className="text-xs leading-relaxed text-fg-faint">
        Pool members see your display name and, once a fixture has kicked
        off, your picks for it — never your email. Details in the{' '}
        <Link href="/privacy" className="text-green underline hover:text-green-bright">
          privacy notice
        </Link>
        .
      </p>
    </article>
  );
}
