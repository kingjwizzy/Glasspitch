import Link from 'next/link';
import { ArrowRightIcon } from './icons';

interface SectionHeaderProps {
  id: string;
  title: string;
  /** Optional "see all" style link. */
  href?: string;
  linkLabel?: string;
}

export default function SectionHeader({
  id,
  title,
  href,
  linkLabel,
}: SectionHeaderProps) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2
        id={id}
        className="font-display text-base font-semibold tracking-tight text-fg"
      >
        {title}
      </h2>
      {href && linkLabel && (
        <Link
          href={href}
          // -my offset keeps the ≥44px tap target from growing the row.
          className="-my-2 inline-flex min-h-11 items-center gap-1 text-sm text-green transition-colors hover:text-green-bright"
        >
          {linkLabel}
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
