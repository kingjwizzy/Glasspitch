// Empty-state spot illustrations (W6 visual pack; ROADMAP.md §4 item 9).
// One tiny original flat-vector scene per honest empty state — they decorate
// the "nothing here YET, and that's the truth" copy, never replace it
// (DESIGN.md §9: empty states invite action). All generic football/data
// iconography, no marks (ARCHITECTURE.md §13). Inline SVG, aria-hidden,
// palette-locked to DESIGN.md token variables; each variant is well under
// the 4KB budget.

export type SpotVariant = 'ledger' | 'receipts' | 'board' | 'chances' | 'play';

function LedgerSpot() {
  return (
    <>
      {/* open ledger book */}
      <rect x="18" y="14" width="60" height="44" rx="4" stroke="var(--fg-faint)" strokeWidth="2" />
      <path d="M48 14v44" stroke="var(--fg-faint)" strokeWidth="1.5" opacity="0.6" />
      {/* left page: rows with a hit and a miss recorded honestly */}
      <path d="M25 26h10M25 36h10M25 46h10" stroke="var(--fg-faint)" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      <path d="M39 24l2.5 2.5L46 22" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M40 34l5 5M45 34l-5 5" stroke="var(--miss)" strokeWidth="2" strokeLinecap="round" />
      {/* right page: still blank — the record not yet written */}
      <path d="M55 26h16M55 36h16M55 46h16" stroke="var(--line)" strokeWidth="2" strokeLinecap="round" />
    </>
  );
}

function ReceiptsSpot() {
  return (
    <>
      {/* receipt slip with a zig-zag tear-off edge */}
      <path
        d="M28 12h40v42l-5 5-5-5-5 5-5-5-5 5-5-5-5 5-5-5z"
        stroke="var(--fg-faint)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M35 22h26M35 30h26M35 38h16" stroke="var(--fg-faint)" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      {/* the stamp cell, waiting for full time */}
      <circle cx="59" cy="42" r="6" stroke="var(--green)" strokeWidth="2" opacity="0.8" />
      <path d="M56.5 42l1.8 1.8 3.2-3.6" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function BoardSpot() {
  return (
    <>
      {/* the board grid */}
      <rect x="16" y="14" width="64" height="44" rx="4" stroke="var(--fg-faint)" strokeWidth="2" />
      <path d="M16 28h64M16 42h64M44 14v44" stroke="var(--fg-faint)" strokeWidth="1.5" opacity="0.5" />
      {/* one row's figures ticking up, one down — movement, both shown */}
      <path d="M50 38l6-5 5 3 8-7" stroke="var(--home)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M66 29h3v3" stroke="var(--home)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 50h12M22 22h12M50 50h20" stroke="var(--line)" strokeWidth="2.5" strokeLinecap="round" />
    </>
  );
}

function ChancesSpot() {
  return (
    <>
      {/* the circle cloud, before the first simulation sizes it */}
      <circle cx="38" cy="32" r="16" stroke="var(--green)" strokeWidth="2" strokeDasharray="3 4" opacity="0.85" />
      <circle cx="64" cy="26" r="9" stroke="var(--home)" strokeWidth="2" strokeDasharray="3 4" opacity="0.8" />
      <circle cx="62" cy="48" r="6" stroke="var(--away)" strokeWidth="2" strokeDasharray="3 4" opacity="0.8" />
      <circle cx="20" cy="52" r="4.5" stroke="var(--fg-faint)" strokeWidth="2" strokeDasharray="2.5 3.5" opacity="0.7" />
      {/* percent placeholder in the biggest circle */}
      <path d="M33 37l10-10M34.5 28.5h.1M41.5 35.5h.1" stroke="var(--fg-faint)" strokeWidth="2" strokeLinecap="round" />
    </>
  );
}

function PlaySpot() {
  return (
    <>
      {/* your three-way call, waiting to be made */}
      <rect x="16" y="18" width="30" height="10" rx="3" fill="var(--home)" opacity="0.8" />
      <rect x="48" y="18" width="16" height="10" rx="3" fill="var(--draw)" opacity="0.7" />
      <rect x="66" y="18" width="14" height="10" rx="3" fill="var(--away)" opacity="0.8" />
      {/* the slider being fine-tuned */}
      <path d="M16 44h64" stroke="var(--line)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="46" cy="44" r="6" fill="var(--surface-2)" stroke="var(--fg-dim)" strokeWidth="2" />
      {/* locked at kickoff */}
      <rect x="41" y="56" width="14" height="10" rx="2" stroke="var(--fg-faint)" strokeWidth="2" />
      <path d="M44.5 56v-2.5a3.5 3.5 0 0 1 7 0V56" stroke="var(--fg-faint)" strokeWidth="2" />
    </>
  );
}

const SPOTS: Record<SpotVariant, () => React.ReactElement> = {
  ledger: LedgerSpot,
  receipts: ReceiptsSpot,
  board: BoardSpot,
  chances: ChancesSpot,
  play: PlaySpot,
};

export default function EmptyStateSpot({
  variant,
  className,
}: {
  variant: SpotVariant;
  className?: string;
}) {
  const Spot = SPOTS[variant];
  return (
    <svg
      viewBox="0 0 96 72"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className ?? 'h-16 w-auto'}
    >
      <Spot />
    </svg>
  );
}
