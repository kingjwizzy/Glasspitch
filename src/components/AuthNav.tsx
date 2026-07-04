'use client';

import Link from 'next/link';
import { useAuthState } from '@/components/useAuthState';

// Desktop (md+) sign-in / account affordance — the one auth-aware island in the
// otherwise-static Header. Renders "Sign in" during SSR and until the session
// resolves (so the static markup matches), then swaps to "Account" for a
// signed-in visitor. Below md the same choice is made inside MobileNav instead.
export default function AuthNav() {
  const signedIn = useAuthState() === 'in';

  return (
    <Link
      href={signedIn ? '/account' : '/login'}
      className="-ml-1 hidden min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-2.5 text-sm text-fg-dim transition-colors hover:text-fg md:inline-flex"
    >
      {signedIn ? 'Account' : 'Sign in'}
    </Link>
  );
}
