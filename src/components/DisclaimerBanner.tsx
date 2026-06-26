import { DISCLAIMER } from '@/lib/constants';

// Persistent compliance banner rendered on EVERY page by the root layout
// (ARCHITECTURE.md §13 — baked in, never bolted on). Not dismissible. Kept
// understated but legible (text-fg-dim clears AA on this surface) so it reads as
// a standing notice without competing with matchday content (DESIGN.md §2, §7).
export default function DisclaimerBanner() {
  return (
    <div
      role="note"
      aria-label="Compliance disclaimer"
      className="border-b border-line bg-surface-2"
    >
      {/* Render the canonical constant verbatim — single source of truth for the
          sign-off-gated compliance copy (constants.ts), so it can never drift
          from the footer / responsible-gambling page. */}
      <p className="mx-auto w-full max-w-screen-md px-4 py-2 text-center text-xs text-fg-dim sm:text-[13px]">
        {DISCLAIMER}
      </p>
    </div>
  );
}
