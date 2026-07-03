import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { deleteAccountAction } from '../actions';

export const metadata: Metadata = {
  title: 'Delete account',
  robots: { index: false, follow: false },
};

interface DeletePageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function DeleteAccountPage({ searchParams }: DeletePageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/account/delete');

  const { error } = await searchParams;

  return (
    <article className="mx-auto max-w-sm space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Delete your account
        </h1>
        <p className="text-sm leading-relaxed text-fg-dim">
          This permanently deletes your Glass Pitch account ({user.email}) and
          any subscription record we hold about you. It does not cancel a
          Stripe subscription for you — do that first from{' '}
          <Link href="/account" className="text-green underline hover:text-green-bright">
            your account
          </Link>{' '}
          if you don&rsquo;t want to be charged again. This cannot be undone.
        </p>
      </header>

      {error && (
        <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-miss-bright">
          {error === 'confirm'
            ? 'Type DELETE exactly to confirm.'
            : 'Something went wrong deleting your account. Please try again.'}
        </p>
      )}

      <form action={deleteAccountAction} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="confirm" className="block text-sm font-medium text-fg">
            Type DELETE to confirm
          </label>
          <input
            id="confirm"
            name="confirm"
            type="text"
            required
            autoComplete="off"
            className="min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 font-mono text-base text-fg focus-visible:outline-none"
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-miss px-4 text-sm font-medium text-fg transition-colors hover:bg-miss-bright"
          >
            Permanently delete
          </button>
          <Link
            href="/account"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-line bg-surface-2 px-4 text-sm font-medium text-fg transition-colors hover:bg-line"
          >
            Cancel
          </Link>
        </div>
      </form>
    </article>
  );
}
