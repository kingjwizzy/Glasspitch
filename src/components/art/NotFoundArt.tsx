// 404 illustration (W6 visual pack): the ball rolled wide of an empty goal —
// honest, quiet humour in the brand voice (DESIGN.md §9: errors give
// direction, not mood). Original flat vector, generic football scene, no
// marks (ARCHITECTURE.md §13). Inline SVG, aria-hidden (the page copy says
// "page not found" — the picture only decorates it), palette-locked to
// DESIGN.md token variables.

export default function NotFoundArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 180 120"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {/* ground */}
      <path d="M6 108h168" stroke="var(--line)" strokeWidth="2" strokeLinecap="round" />

      {/* goal frame */}
      <path
        d="M34 108V38a3 3 0 0 1 3-3h86a3 3 0 0 1 3 3v70"
        stroke="var(--fg-dim)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* net */}
      <g stroke="var(--fg-faint)" strokeWidth="1" opacity="0.45">
        <path d="M46 35v73M58 35v73M70 35v73M82 35v73M94 35v73M106 35v73M118 35v73" />
        <path d="M34 50h92M34 65h92M34 80h92M34 95h92" />
      </g>

      {/* the miss: dotted trajectory curling past the post */}
      <path
        d="M14 96 Q 92 58 150 92"
        stroke="var(--fg-faint)"
        strokeWidth="1.8"
        strokeDasharray="1 7"
        strokeLinecap="round"
      />
      {/* ball, settled wide right */}
      <circle cx="156" cy="99" r="8" fill="var(--fg)" opacity="0.9" />
      <path
        d="M156 95l3.4 2.5-1.3 4h-4.2l-1.3-4z"
        fill="var(--bg)"
        opacity="0.85"
      />
      {/* penalty spot it came from */}
      <circle cx="14" cy="100" r="1.8" fill="var(--fg-faint)" />
    </svg>
  );
}
