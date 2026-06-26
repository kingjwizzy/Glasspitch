import { CheckIcon, CrossIcon } from '@/components/icons';

// The ✓ / ✗ outcome badge — the signature honesty marker (DESIGN.md §1, §4).
// Colour is never the only signal: the icon shape (tick vs cross) and the
// aria-label both carry the meaning, so it parses in greyscale and to a screen
// reader (§2 hard rule). Shared by the home "recent calls" strip and the match
// result panel so the ✓/✗ can never disagree between the two surfaces.

export interface ResultBadgeProps {
  hit: boolean;
  /** `lg` for the first-class match-result verdict; default for dense rows. */
  size?: 'sm' | 'lg';
  className?: string;
}

export default function ResultBadge({ hit, size = 'sm', className }: ResultBadgeProps) {
  const box = size === 'lg' ? 'h-10 w-10 rounded-xl' : 'h-7 w-7 rounded-lg';
  const icon = size === 'lg' ? 'h-5 w-5' : 'h-4 w-4';
  return (
    <span
      role="img"
      aria-label={hit ? 'Correct call' : 'Missed call'}
      className={`inline-flex shrink-0 items-center justify-center ${box} ${
        hit ? 'bg-green/15 text-green' : 'bg-miss/15 text-miss'
      } ${className ?? ''}`}
    >
      {hit ? <CheckIcon className={icon} /> : <CrossIcon className={icon} />}
    </span>
  );
}
