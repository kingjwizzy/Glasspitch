import Link from 'next/link';
import { ArrowRightIcon } from './icons';

interface SectionHeaderProps {
  id: string;
  title: string;
  /** Optional one-line description under the title — capped at 38ch,
   *  --text-dim (W4 spec: "hierarchy without boxes"). */
  description?: string;
  /** Optional green arrow-link action, e.g. "Full record →". */
  href?: string;
  linkLabel?: string;
}

// Promoted section header (W4 spec item 4): Archivo steps up against 16px body
// at lg so rhythm and scale carry hierarchy instead of boxes; per-section
// actions demote to a quiet green arrow-link.
export default function SectionHeader({
  id,
  title,
  description,
  href,
  linkLabel,
}: SectionHeaderProps) {
  return (
    <div className="mb-3 lg:mb-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id={id}
          className="font-display text-lg font-semibold tracking-tight text-fg lg:text-2xl"
        >
          {title}
        </h2>
        {href && linkLabel && (
          <Link
            href={href}
            // -my offset keeps the ≥44px tap target from growing the row.
            className="-my-2 inline-flex min-h-11 shrink-0 items-center gap-1 text-sm text-green transition-colors hover:text-green-bright"
          >
            {linkLabel}
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      {description && (
        <p className="mt-1 max-w-[38ch] text-sm text-fg-dim">{description}</p>
      )}
    </div>
  );
}
