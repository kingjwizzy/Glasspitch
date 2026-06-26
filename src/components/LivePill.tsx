// The "Live" status pill (DESIGN.md §2, §5). Shared so the home hero and the
// match header can't drift on this a11y-sensitive element.
//
// Solid red with dark text clears AA (≈4.96:1); a red tint behind red text does
// NOT. The pulsing dot is decorative (aria-hidden) — the word "Live" carries the
// meaning, so colour is never the only signal (§2). The ping respects
// prefers-reduced-motion via the global rule in globals.css (§5).
export default function LivePill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-live px-2.5 py-1 text-xs font-semibold text-bg">
      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bg opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-bg" />
      </span>
      Live
    </span>
  );
}
