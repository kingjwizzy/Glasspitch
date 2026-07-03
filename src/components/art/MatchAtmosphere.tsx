// Match-page atmosphere header backdrop (W6 visual pack; ROADMAP.md §4
// item 9 "match atmosphere blocks"). An anonymous stadium roofline with two
// floodlight beams crossing the night sky — original, flat, generic: no real
// venue, no marks (ARCHITECTURE.md §13). The schema carries no venue/city
// field, so the block stays purely graphic (the header's own text carries
// competition + kickoff). Rendered absolutely behind the MatchHeader card's
// content at whisper opacity — AA on the header text is untouched
// (DESIGN.md §7). Inline SVG, aria-hidden, zero JS.

export default function MatchAtmosphere() {
  return (
    <svg
      viewBox="0 0 800 140"
      preserveAspectRatio="xMidYMax slice"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full"
    >
      {/* crossing floodlight beams from the top corners */}
      <path d="M-40 -20 L360 140 L120 140 Z" fill="var(--green)" opacity="0.05" />
      <path d="M840 -20 L680 140 L440 140 Z" fill="var(--green)" opacity="0.05" />

      {/* stand roofline silhouette along the bottom */}
      <path
        d="M0 126 L90 126 L110 108 L250 108 L268 120 L532 120 L550 108 L690 108 L710 126 L800 126"
        stroke="var(--fg)"
        strokeWidth="1.5"
        opacity="0.10"
      />
      {/* roof stanchions */}
      <path
        d="M140 126v-18M210 126v-18M590 126v-18M660 126v-18"
        stroke="var(--fg)"
        strokeWidth="1.2"
        opacity="0.07"
      />
      {/* far floodlight heads above the roofline */}
      <rect x="164" y="88" width="20" height="8" rx="2" fill="var(--fg)" opacity="0.12" />
      <path d="M174 96v12" stroke="var(--fg)" strokeWidth="1.5" opacity="0.10" />
      <rect x="616" y="88" width="20" height="8" rx="2" fill="var(--fg)" opacity="0.12" />
      <path d="M626 96v12" stroke="var(--fg)" strokeWidth="1.5" opacity="0.10" />
    </svg>
  );
}
