'use client';

// The one necessary client island on the whole auth surface (per the
// frontend-dev brief: "keep it tiny"). It exists only to show inline
// pending/sent/error state without a full page reload — the actual work
// (validating the 18+ attestation, calling Supabase Auth) happens in the
// server action (actions.ts), not here.

import { useActionState } from 'react';
import { sendMagicLink } from './actions';
import { INITIAL_LOGIN_STATE } from './state';

export default function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(sendMagicLink, INITIAL_LOGIN_STATE);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="next" value={next} />

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium text-fg">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-base text-fg placeholder:text-fg-faint focus-visible:outline-none"
          placeholder="you@example.com"
        />
      </div>

      <div className="flex items-start gap-3">
        <input
          id="is18"
          name="is18"
          type="checkbox"
          required
          className="mt-1 h-5 w-5 shrink-0 rounded border-line bg-surface-2 accent-green"
        />
        <label htmlFor="is18" className="text-sm leading-relaxed text-fg-dim">
          I confirm I am 18 or over. (Required — Glass Pitch Premium is a
          gambling-adjacent product; see our{' '}
          <a href="/responsible-gambling" className="text-green underline hover:text-green-bright">
            responsible gambling
          </a>{' '}
          page.)
        </label>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-green px-4 text-sm font-medium text-bg transition-colors hover:bg-green-bright disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Send magic link'}
      </button>

      <div role="status" aria-live="polite">
        {state.status !== 'idle' && (
          <p
            className={`text-sm leading-relaxed ${
              state.status === 'error' ? 'text-miss-bright' : 'text-fg-dim'
            }`}
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
