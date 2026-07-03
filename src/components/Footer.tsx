import Link from 'next/link';
import { DISCLAIMER, SITE_NAME } from '@/lib/constants';

// The disclaimer also lives in the global footer (ARCHITECTURE.md §13), in
// addition to the persistent banner.
export default function Footer() {
  return (
    <footer className="mt-auto border-t border-line bg-surface">
      <div className="mx-auto w-full max-w-screen-md px-4 py-7 text-sm">
        <p className="font-medium text-fg">{DISCLAIMER}</p>
        <nav aria-label="Footer" className="mt-2">
          {/* ≥44px tap targets (DESIGN.md §4); -mx offset keeps the row flush. */}
          <ul className="-mx-2 flex flex-wrap gap-x-2 text-fg-dim">
            <li>
              <Link
                href="/about"
                className="inline-flex min-h-11 items-center rounded-md px-2 transition-colors hover:text-fg"
              >
                About
              </Link>
            </li>
            <li>
              <Link
                href="/ledger"
                className="inline-flex min-h-11 items-center rounded-md px-2 transition-colors hover:text-fg"
              >
                Track record
              </Link>
            </li>
            <li>
              <Link
                href="/stats/golden-boot"
                className="inline-flex min-h-11 items-center rounded-md px-2 transition-colors hover:text-fg"
              >
                Golden Boot
              </Link>
            </li>
            <li>
              <Link
                href="/responsible-gambling"
                className="inline-flex min-h-11 items-center rounded-md px-2 transition-colors hover:text-fg"
              >
                Responsible gambling
              </Link>
            </li>
            <li>
              <Link
                href="/privacy"
                className="inline-flex min-h-11 items-center rounded-md px-2 transition-colors hover:text-fg"
              >
                Privacy
              </Link>
            </li>
            <li>
              <Link
                href="/terms"
                className="inline-flex min-h-11 items-center rounded-md px-2 transition-colors hover:text-fg"
              >
                Terms
              </Link>
            </li>
            <li>
              <Link
                href="/refunds"
                className="inline-flex min-h-11 items-center rounded-md px-2 transition-colors hover:text-fg"
              >
                Refunds
              </Link>
            </li>
          </ul>
        </nav>
        <p className="mt-4 text-xs text-fg-dim">
          {SITE_NAME} — football analysis, not betting advice. Plain-text team
          data only; no affiliation with any league, club, or competition.
        </p>
      </div>
    </footer>
  );
}
