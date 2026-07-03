// Floodlit-stadium hero flourish (W6 visual pack; ROADMAP.md §4 item 9
// "hero scene"). Original line art, football-but-generic: an anonymous bowl
// silhouette and two floodlight pylons — no real ground, no marks
// (ARCHITECTURE.md §13). Sits ABSOLUTELY behind the homepage hero content at
// whisper opacity so every text/background pair keeps WCAG AA untouched
// (DESIGN.md §7); the parent `.floodlight` section already isolates, so
// -z-10 layers it with the existing radial pool + grain pseudo-elements.
// Inline SVG: zero requests, zero JS, aria-hidden.

export default function StadiumHero() {
  return (
    <svg
      viewBox="0 0 1200 340"
      preserveAspectRatio="xMidYMin slice"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full"
    >
      {/* floodlight beams — the two pylons throw soft light into the bowl */}
      <path d="M208 58 L360 340 L96 340 Z" fill="var(--green)" opacity="0.045" />
      <path d="M992 58 L1104 340 L840 340 Z" fill="var(--green)" opacity="0.045" />

      {/* upper tier — the far rim of the bowl */}
      <path
        d="M60 300 Q600 118 1140 300"
        stroke="var(--fg)"
        strokeWidth="1.5"
        opacity="0.10"
      />
      {/* lower tier */}
      <path
        d="M140 336 Q600 190 1060 336"
        stroke="var(--fg)"
        strokeWidth="1.5"
        opacity="0.07"
      />
      {/* roof truss ticks along the far rim */}
      <path
        d="M300 243v-14M450 212v-14M600 200v-14M750 212v-14M900 243v-14"
        stroke="var(--fg)"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.08"
      />

      {/* left pylon — mast, cross-brace and lamp head */}
      <path d="M208 62v210" stroke="var(--fg)" strokeWidth="2" opacity="0.13" />
      <path d="M197 272l11-52 11 52" stroke="var(--fg)" strokeWidth="1.5" opacity="0.09" />
      <rect x="190" y="46" width="36" height="14" rx="3" fill="var(--fg)" opacity="0.14" />
      <path d="M196 52h24M196 56h24" stroke="var(--bg)" strokeWidth="1.4" opacity="0.5" />

      {/* right pylon */}
      <path d="M992 62v210" stroke="var(--fg)" strokeWidth="2" opacity="0.13" />
      <path d="M981 272l11-52 11 52" stroke="var(--fg)" strokeWidth="1.5" opacity="0.09" />
      <rect x="974" y="46" width="36" height="14" rx="3" fill="var(--fg)" opacity="0.14" />
      <path d="M980 52h24M980 56h24" stroke="var(--bg)" strokeWidth="1.4" opacity="0.5" />
    </svg>
  );
}
