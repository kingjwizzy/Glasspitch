import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// v2 premium auth middleware (ARCHITECTURE.md §0/§5 v2 amendment, §7).
//
// Scoped to EXACTLY the five auth/premium/billing prefixes below via
// `config.matcher` — every public, DB-read page (/, /match/[id], /team/[slug],
// /league/[slug], /ledger, /about, /responsible-gambling, the new /privacy,
// /terms, /refunds) never enters this file at all, so their ISR/full-route
// cache is completely untouched (verified in the build output — see the
// frontend-dev report). Two jobs happen here:
//
//   1. Refresh the Supabase session cookie for the routes that need it (a
//      Server Component render cannot itself set a refreshed cookie — see
//      lib/supabase/server.ts's doc comment — so middleware is what actually
//      persists a renewed session for these routes).
//   2. Redirect an unauthenticated visitor away from the routes that require
//      a signed-in user (/account/*, /premium/ledger) to /login, preserving
//      where they were headed via `?next=`.
//
// /premium itself (the pricing page) and /login are intentionally NOT
// redirect-gated here — they must render for anonymous visitors.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    // Misconfigured env — let the request through rather than hard-crash the
    // whole auth surface; the pages themselves already throw a clear error
    // when they actually try to read Supabase (see lib/supabase/server.ts).
    return response;
  }

  const supabase = createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANT: this call is what actually refreshes an expiring session and
  // must not be removed or reordered — see the @supabase/ssr Next.js guide.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const requiresAuth =
    pathname.startsWith('/account') || pathname.startsWith('/premium/ledger');

  if (!user && requiresAuth) {
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // A signed-in visitor landing on /login has nothing to do there.
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/account', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/login', '/auth/:path*', '/account/:path*', '/premium/:path*', '/api/stripe/:path*'],
};
