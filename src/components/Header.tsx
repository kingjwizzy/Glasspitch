import Link from 'next/link';
import { SITE_NAME } from '@/lib/constants';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/ledger', label: 'Track record' },
  { href: '/about', label: 'About' },
] as const;

export default function Header() {
  return (
    <header className="border-b border-black/10 dark:border-white/15">
      <div className="mx-auto flex w-full max-w-screen-md items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-bold tracking-tight">
          {SITE_NAME}
        </Link>
        <nav aria-label="Primary">
          <ul className="flex items-center gap-4 text-sm">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="hover:underline">
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
