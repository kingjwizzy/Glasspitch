// Small inline SVG icons (no emoji — DESIGN.md / a11y). Stroke 2, currentColor,
// decorative by default (aria-hidden); the surrounding element carries the label.

type IconProps = { className?: string };

const base = (className?: string) =>
  `inline-block shrink-0 ${className ?? 'h-4 w-4'}`;

export function CheckIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function CrossIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function LockClosedIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function LockOpenIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}

export function ArrowRightIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

// ── Bottom tab bar icons (RAMBO wave 3 #6) — decorative (aria-hidden); the
// tab's visible text label carries the accessible name. Same stroke-2,
// currentColor, round-cap language as every other icon above.

export function HomeTabIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.5V19a1 1 0 0 0 1 1h3v-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5h3a1 1 0 0 0 1-1V9.5" />
    </svg>
  );
}

export function MatchesTabIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16" />
    </svg>
  );
}

/** "Play" tab — concentric rings read as a prediction target, distinct from a
 *  generic media play-triangle (which would misleadingly suggest video). */
export function PlayTabIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TrackRecordTabIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 19V11M12 19V5M19 19v-7" />
    </svg>
  );
}
