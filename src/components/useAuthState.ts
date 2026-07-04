'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';

export type AuthState = 'loading' | 'in' | 'out';

// Client-only session probe for the header's sign-in / account affordance. It
// lives OUTSIDE the Server-Component Header on purpose (Header.tsx doc comment,
// ARCHITECTURE.md §5/§6): the header markup ships signed-out on every cached /
// ISR page, and this hook upgrades it to the signed-in affordance after mount
// for a logged-in visitor, then tracks live sign-in/out via onAuthStateChange —
// so no page is forced dynamic and no cookie is read at render time.
//
// SSR and the first client render both see 'loading' (→ signed-out markup), so
// hydration matches; the swap only happens in the effect.
export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>('loading');

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) setState(data.session ? 'in' : 'out');
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? 'in' : 'out');
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
