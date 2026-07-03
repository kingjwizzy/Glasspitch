import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createPoolAction, joinPoolAction } from '@/app/play/actions';
import { getMyPools } from '@/lib/queries/play';
import { ArrowRightIcon } from '@/components/icons';

// /play/pools — your pools, plus create/join (ARCHITECTURE.md §5 v3 game-picks
// amendment). Authed + dynamic like the rest of /play; plain forms posting to
// Server Actions (the user's own RLS-scoped client — no client JS needed
// here). Private surface: noindexed, not in the sitemap.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your pools',
  robots: { index: false, follow: false },
};

const ERROR_COPY: Record<string, string> = {
  'create-invalid':
    'Pool names can be up to 60 characters and display names up to 24 — both are needed.',
  'create-failed': 'Could not create the pool right now. Please try again shortly.',
  'join-invalid':
    'Enter the invite code and a display name (up to 24 characters).',
  'join-badcode': 'That invite code doesn’t match an open pool — check it and try again.',
  'join-failed': 'Could not join the pool right now. Please try again shortly.',
};

interface PoolsPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function PoolsPage({ searchParams }: PoolsPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/play/pools');

  const [{ error }, pools] = await Promise.all([
    searchParams,
    getMyPools(supabase, user.id),
  ]);
  const errorMessage = error ? ERROR_COPY[error] : undefined;

  const inputCls =
    'min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg placeholder:text-fg-faint';
  const labelCls = 'block text-xs text-fg-dim';

  return (
    <article className="mx-auto max-w-xl space-y-8">
      <header className="space-y-2">
        <Link
          href="/play"
          className="inline-flex min-h-11 items-center text-sm font-medium text-fg-dim transition-colors hover:text-fg"
        >
          ← Beat the model
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Your pools
        </h1>
        <p className="text-sm leading-relaxed text-fg-dim">
          A pool is a private leaderboard over the same picks you already make
          — invite friends with one link. Prize-free forever.
        </p>
      </header>

      {errorMessage && (
        <p
          role="alert"
          className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-miss-bright"
        >
          {errorMessage}
        </p>
      )}

      <section aria-labelledby="my-pools-heading">
        <h2
          id="my-pools-heading"
          className="mb-3 font-display text-lg font-semibold tracking-tight text-fg"
        >
          Pools you&rsquo;re in
        </h2>
        {pools.length === 0 ? (
          <div className="glass px-4 py-5">
            <p className="text-sm leading-relaxed text-fg-dim">
              You&rsquo;re not in a pool yet — create one below, or join with a
              friend&rsquo;s invite code.
            </p>
          </div>
        ) : (
          <ul className="glass divide-y divide-line px-4">
            {pools.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/play/pools/${p.id}`}
                  className="flex min-h-14 items-center justify-between gap-3 py-2 transition-colors hover:text-green-bright"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium text-fg">
                      {p.name}
                    </span>
                    <span className="block text-xs text-fg-dim">
                      {p.memberCount === null
                        ? ''
                        : `${p.memberCount} member${p.memberCount === 1 ? '' : 's'}`}
                      {p.isOwner ? (p.memberCount === null ? 'Yours' : ' · yours') : ''}
                    </span>
                  </span>
                  <ArrowRightIcon className="h-4 w-4 shrink-0 text-green" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="create-pool-heading" className="glass px-4 py-4">
        <h2
          id="create-pool-heading"
          className="font-display text-base font-semibold tracking-tight text-fg"
        >
          Start a pool
        </h2>
        <form action={createPoolAction} className="mt-3 space-y-3">
          <input type="hidden" name="return" value="/play/pools" />
          <div className="space-y-1">
            <label htmlFor="pool-name" className={labelCls}>
              Pool name
            </label>
            <input
              id="pool-name"
              name="name"
              type="text"
              required
              maxLength={60}
              placeholder="e.g. The back office"
              className={inputCls}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="create-display-name" className={labelCls}>
              Your display name in this pool
            </label>
            <input
              id="create-display-name"
              name="displayName"
              type="text"
              required
              maxLength={24}
              placeholder="Shown to pool members only"
              className={inputCls}
            />
          </div>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-lg bg-green px-4 text-sm font-medium text-bg transition-colors hover:bg-green-bright"
          >
            Create the pool
          </button>
        </form>
      </section>

      <section aria-labelledby="join-pool-heading" className="glass px-4 py-4">
        <h2
          id="join-pool-heading"
          className="font-display text-base font-semibold tracking-tight text-fg"
        >
          Join with an invite code
        </h2>
        <form action={joinPoolAction} className="mt-3 space-y-3">
          <input type="hidden" name="return" value="/play/pools" />
          <div className="space-y-1">
            <label htmlFor="join-code" className={labelCls}>
              Invite code
            </label>
            <input
              id="join-code"
              name="code"
              type="text"
              required
              maxLength={64}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="From your friend's invite link"
              className={`${inputCls} font-mono`}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="join-display-name" className={labelCls}>
              Your display name in this pool
            </label>
            <input
              id="join-display-name"
              name="displayName"
              type="text"
              required
              maxLength={24}
              placeholder="Shown to pool members only"
              className={inputCls}
            />
          </div>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
          >
            Join the pool
          </button>
        </form>
      </section>
    </article>
  );
}
