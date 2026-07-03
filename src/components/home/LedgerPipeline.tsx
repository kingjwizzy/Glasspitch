import { ArrowRightIcon, CheckIcon, CrossIcon, LockClosedIcon } from '@/components/icons';

// The tiny static lock → whistle → scored pipeline used by the young-ledger
// empty states (proof rail + receipts). Purely decorative (aria-hidden) — the
// adjacent sentence carries the meaning; no motion, no spinners.

function WhistleGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="14" r="5" />
      <path d="M13 11.5 20 7v4l-5 2.5" />
    </svg>
  );
}

export default function LedgerPipeline({ className }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-2 text-fg-dim ${className ?? ''}`}
      aria-hidden="true"
    >
      <LockClosedIcon className="h-5 w-5" />
      <ArrowRightIcon className="h-3.5 w-3.5" />
      <WhistleGlyph className="h-5 w-5 shrink-0" />
      <ArrowRightIcon className="h-3.5 w-3.5" />
      <span className="inline-flex h-5 items-center gap-1">
        <CheckIcon className="h-4 w-4 text-green" />
        <CrossIcon className="h-4 w-4 text-miss" />
      </span>
    </div>
  );
}
