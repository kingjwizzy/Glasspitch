import Link from 'next/link';
import { SITE_NAME } from '@/lib/constants';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/ledger', label: 'Track record' },
  { href: '/about', label: 'About' },
] as const;

export default function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-screen-md items-center justify-between gap-4 px-4 py-1.5">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center font-display text-lg font-semibold tracking-tight text-fg"
        >
          {SITE_NAME}
        </Link>
        <nav aria-label="Primary">
          {/* Links sized to a ≥44px tap target (DESIGN.md §4); horizontal
              padding gives the spacing so adjacent targets don't collide. */}
          <ul className="-mr-2 flex items-center text-sm">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="inline-flex min-h-11 items-center rounded-md px-3 text-fg-dim transition-colors hover:text-fg"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
