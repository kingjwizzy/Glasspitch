import { brierVerdict, metric3, type BrierVerdictTier } from '@/lib/format';

// The plain-language Brier verdict (kick plan #5) — reusable wherever a
// settled "Beat the Model" pick's score needs translating into a kind,
// instructive read, not just a bare number. See `brierVerdict` in
// lib/format.ts for the documented, geometry-grounded thresholds. Colour is
// never the only signal here either: the label text always carries the
// meaning, the tone colour is a reinforcement (DESIGN.md §2 hard rule).
// No "use client" — plain, prop-driven JSX with no browser-only APIs, so it
// can be imported by a Server Component OR (as here) a client reveal island.

const TIER_CHIP_CLASS: Record<BrierVerdictTier, string> = {
  'bang-on': 'bg-green/15 text-green-bright',
  sharp: 'bg-green/10 text-green',
  close: 'bg-surface-2 text-fg-dim',
  off: 'bg-miss/15 text-miss-bright',
};

export interface BrierVerdictChipProps {
  /** This pick's own Brier score (0 best, 2 worst). */
  brier: number;
  /** Show the one-line elaboration beneath the chip (default). Set false for
   *  a dense context that only wants the short label (e.g. a future
   *  leaderboard headline). */
  showDetail?: boolean;
  className?: string;
}

export default function BrierVerdictChip({
  brier,
  showDetail = true,
  className,
}: BrierVerdictChipProps) {
  const verdict = brierVerdict(brier);
  return (
    <div className={className}>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${TIER_CHIP_CLASS[verdict.tier]}`}
      >
        {verdict.label}
        <span className="font-mono font-normal opacity-80">{metric3(brier)}</span>
      </span>
      {showDetail && (
        <p className="mt-1.5 text-sm leading-relaxed text-fg-dim">{verdict.detail}</p>
      )}
    </div>
  );
}
