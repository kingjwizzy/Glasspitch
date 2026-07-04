'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The tiny `usePathname` island behind each persistent bottom tab (RAMBO wave
// 3 #6) — same sanctioned "small client component beside a static tree"
// pattern as AuthNav/MobileNav (ARCHITECTURE.md §6). BottomTabBar itself stays
// a server-rendered `<nav>` of plain `<Link>`s; only the ACTIVE-state
// highlighting needs the client. `usePathname()` resolves from the requested
// URL on both the server render pass and the first client render, so there is
// no async gap and no hydration flash (unlike AuthNav's genuinely-async
// session probe) — the active tab is correct from first paint.
//
// `icon` is a pre-rendered element (not a component reference) — a Server
// Component may pass rendered JSX to a Client Component as a prop, but never
// a bare function/component reference across that boundary.

export interface BottomTabLinkProps {
  href: string;
  label: string;
  icon: ReactNode;
}

/** Exact match for "/", prefix match (own segment) for everything else — so
 *  `/play/pools/42` still lights up the "Play" tab without `/ledger` ever
 *  matching `/leaderboard` or similar false positives. */
function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function BottomTabLink({ href, label, icon }: BottomTabLinkProps) {
  const pathname = usePathname();
  const active = isActive(pathname, href);

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex h-14 w-full flex-col items-center justify-center gap-0.5 text-micro transition-colors ${
        active ? 'text-fg' : 'text-fg-dim'
      }`}
    >
      {icon}
      <span className={active ? 'font-medium' : ''}>{label}</span>
    </Link>
  );
}
