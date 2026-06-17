import Link from 'next/link';
import { DISCLAIMER, SITE_NAME } from '@/lib/constants';

// The disclaimer also lives in the global footer (ARCHITECTURE.md §13), in
// addition to the persistent banner.
export default function Footer() {
  return (
    <footer className="mt-auto border-t border-black/10 dark:border-white/15">
      <div className="mx-auto w-full max-w-screen-md px-4 py-6 text-sm">
        <p className="font-medium">{DISCLAIMER}</p>
        <nav aria-label="Footer" className="mt-3">
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            <li>
              <Link href="/about" className="hover:underline">
                About
              </Link>
            </li>
            <li>
              <Link href="/ledger" className="hover:underline">
                Track record
              </Link>
            </li>
            <li>
              <Link href="/responsible-gambling" className="hover:underline">
                Responsible gambling
              </Link>
            </li>
          </ul>
        </nav>
        <p className="mt-4 text-xs text-black/60 dark:text-white/60">
          {SITE_NAME} — football analysis, not betting advice. Plain-text team
          data only; no affiliation with any league, club, or competition.
        </p>
      </div>
    </footer>
  );
}
