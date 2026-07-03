// Original flat-vector golden-boot trophy motif (W6 visual pack;
// ROADMAP.md §4 item 9). Generic football iconography only — a stylised
// trophy, not any real award's protected design, and no player/kit/crest
// imagery (ARCHITECTURE.md §13). Inline SVG (no request), aria-hidden
// (decorative — the page copy carries the meaning), palette-locked: the boot
// takes `currentColor` from the caller (use a token text class, e.g.
// `text-away` for the amber trophy read) and every other fill is a DESIGN.md
// token variable.

export default function GoldenBootMotif({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {/* plinth */}
      <rect
        x="13"
        y="55"
        width="38"
        height="6"
        rx="1.5"
        fill="var(--surface-2)"
        stroke="var(--line)"
      />
      {/* studs */}
      <rect x="11" y="50" width="5" height="3.5" rx="1" fill="currentColor" opacity="0.55" />
      <rect x="26" y="50" width="5" height="3.5" rx="1" fill="currentColor" opacity="0.55" />
      <rect x="45" y="50" width="5" height="3.5" rx="1" fill="currentColor" opacity="0.55" />
      {/* sole */}
      <path
        d="M6 43h52v3a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"
        fill="currentColor"
        opacity="0.65"
      />
      {/* boot body — ankle shaft right, toe left */}
      <path
        d="M41 12c2.4 0 3.9 1.5 3.9 3.9v11.3c5.8 2 9.9 5.9 11.8 11.4.6 1.7-.5 2.9-2.2 2.9H8.2c-1.3 0-2.2-.9-2.2-2.2 0-8.6 6.8-13.6 15.6-14.6l8.5-10.6c1-1.3 2.3-2.1 4-2.1z"
        fill="currentColor"
      />
      {/* lace slits — cut in page-background colour so they read at any size */}
      <path
        d="M29.5 25.5l5 3M33.5 20.5l5 3M37.5 15.5l5 3"
        stroke="var(--bg)"
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.75"
      />
    </svg>
  );
}
