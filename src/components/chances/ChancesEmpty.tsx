import EmptyStateSpot from '@/components/art/EmptyStateSpot';

// Honest structural empty state for the World Cup Chances surfaces
// (Golden-Boot-slot convention: reserved space, dash-for-data, plain copy —
// never a spinner, never invented numbers). Shown until migration 0007 is
// applied and jobs/simulate_chances.py first runs.

export default function ChancesEmpty() {
  return (
    <div className="glass flex min-h-44 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
      <EmptyStateSpot variant="chances" className="h-16 w-auto" />
      <p className="max-w-[44ch] text-sm leading-relaxed text-fg-dim">
        Tournament chances appear here after tonight&rsquo;s first simulation
        run — every nation&rsquo;s shot at the trophy, sized by probability
        and re-simulated daily.
      </p>
    </div>
  );
}
