import Link from 'next/link';
import { SITE_NAME } from '@/lib/constants';

// Static Server Component — no "use client", no auth/session awareness (v3
// amendment): the header is rendered by every public page, including cached
// ISR pages, so it must never branch on signed-in state (that would force the
// whole page dynamic). The "Sign in" link is a plain, static link to /login,
// which itself redirects an already-signed-in visitor to /account
// (src/middleware.ts) — so the header stays correct for every visitor without
// ever reading a cookie itself.
const NAV = [
  { href: '/', label: 'Home' },
  { href: '/matches', label: 'Matches' },
  { href: '/leagues', label: 'Leagues' },
  { href: '/ledger', label: 'Track record' },
  { href: '/about', label: 'About' },
] as const;

export default function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-screen-md items-center gap-2 px-4 py-1.5 lg:max-w-6xl">
        <Link
          href="/"
          className="inline-flex min-h-11 shrink-0 items-center font-display text-lg font-semibold tracking-tight text-fg"
        >
          {SITE_NAME}
        </Link>
        {/* min-w-0 lets this flex item shrink below its content width so it
            can scroll horizontally instead of pushing "Sign in" off-screen on
            narrow phones — a zero-JS way to fit five nav items plus the brand
            and "Sign in" at once (DESIGN.md §4 tap-target floor still holds:
            every link stays ≥44px tall, just visually scrollable as a row). */}
        <nav aria-label="Primary" className="min-w-0 flex-1 overflow-x-auto">
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
        <Link
          href="/login"
          className="-ml-1 inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-2.5 text-sm text-fg-dim transition-colors hover:text-fg"
        >
          Sign in
        </Link>
      </div>
    </header>
  );
}
