import Link from 'next/link';
import AuthNav from '@/components/AuthNav';
import Logo from '@/components/Logo';

// Static Server Component — no "use client", no auth/session awareness: the
// header is rendered by every public page, including cached ISR pages, so it
// must never branch on signed-in state at render time (that would force the
// whole page dynamic). The signed-in vs signed-out affordance is the ONE thing
// that can't be static, so it's delegated to two tiny client islands —
// <AuthNav /> (desktop, rendered here) and MobileNav (below md, rendered as
// BottomTabBar's 5th "More" slot since RAMBO wave 3 #6 — no longer rendered
// in this header row) — that read the session on the client and swap
// "Sign in" for "Account". Everything else here stays static.
//
// Exported so BottomTabBar and MobileNav — the below-md client islands —
// render the same destinations from one source of truth instead of a
// duplicate list.
export const NAV = [
  { href: '/', label: 'Home' },
  { href: '/matches', label: 'Matches' },
  // W6: the daily-simulated World Cup chances — the owner's flagship public
  // surface; a quiet link like every other item.
  { href: '/chances', label: 'Chances' },
  { href: '/leagues', label: 'Leagues' },
  // Quiet, same weight as every other item (DESIGN.md §6 — no attention
  // mechanics). /play itself renders a static explainer for anonymous
  // visitors, so this stays a plain link with no auth awareness.
  { href: '/play', label: 'Play' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/ledger', label: 'Track record' },
  { href: '/about', label: 'About' },
] as const;

// RAMBO wave 3 #6: the 4 destinations promoted into the persistent below-md
// bottom tab bar (BottomTabBar.tsx) — thumb-reachable one-tap, rather than
// two taps deep behind the hamburger. Kept here, beside NAV, as the single
// place this split is decided: BottomTabBar renders these four as tabs (plus
// a 5th "More" trigger for the rest), and MobileNav's hamburger panel renders
// whatever's LEFT in NAV — the overflow — so the two never duplicate each
// other's destinations.
export const BOTTOM_TAB_HREFS = ['/', '/matches', '/play', '/ledger'] as const;

export default function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-screen-md items-center gap-2 px-4 py-1.5 lg:max-w-6xl">
        <Link href="/" className="inline-flex min-h-11 shrink-0 items-center">
          <Logo />
        </Link>
        {/* Below md there's no room for this many inline links (a phone-width
            viewport clips this row hard) — they move into MobileNav's
            hamburger overlay instead, so this row is desktop-only. */}
        <nav aria-label="Primary" className="hidden min-w-0 flex-1 md:block">
          <ul className="flex items-center text-sm">
            {NAV.map((item) => (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  className="inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-2.5 text-fg-dim transition-colors hover:text-fg"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {process.env.NEXT_PUBLIC_PREMIUM_LIVE === '1' ? (
          // The single sitewide premium affordance (DESIGN.md §6: visible is
          // fine, pressure is not — solid amber pill, no motion, no urgency
          // copy). Env-gated so it appears only once live payments are on.
          // Desktop-only here — MobileNav lists it as a plain row instead, so
          // it never has to compete with the hamburger for phone-width space.
          <Link
            href="/premium"
            className="hidden min-h-11 shrink-0 items-center whitespace-nowrap rounded-full bg-away px-3.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90 md:inline-flex"
          >
            Go Premium
          </Link>
        ) : null}
        <AuthNav />
      </div>
    </header>
  );
}
