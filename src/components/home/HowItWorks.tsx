import LedgerPipeline from '@/components/home/LedgerPipeline';

// The honest-loop strip (RAMBO wave 3 #7b): promotes the lock → whistle →
// scored pipeline glyph from empty-state-only decoration into an
// always-present, labelled explanation of the ledger mechanism — the site's
// whole credibility rests on this loop, previously only stated in prose deep
// in the ledger page (DESIGN.md §1 "visible honesty"). Fills the gap the
// empty `home-top` ad slot leaves right after the hero. Purely explanatory:
// no counts, no urgency, no per-visitor state, zero client JS.

const STEPS = [
  'We publish before kickoff',
  "It locks and can't be edited",
  'We score it after full-time, misses included',
] as const;

export default function HowItWorks() {
  return (
    <div className="glass flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:gap-8 lg:p-6">
      <div className="flex shrink-0 items-center gap-3">
        <LedgerPipeline />
        <h2 id="how-it-works-heading" className="text-small font-medium text-fg">
          How it works
        </h2>
      </div>
      <ol className="grid gap-2.5 sm:grid-cols-3 sm:gap-4 lg:flex-1">
        {STEPS.map((step, i) => (
          <li key={step} className="flex items-baseline gap-2 text-small text-fg-dim">
            <span aria-hidden="true" className="font-mono text-fg-faint">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
