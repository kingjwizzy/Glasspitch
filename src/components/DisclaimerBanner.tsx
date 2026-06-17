import { DISCLAIMER } from '@/lib/constants';

// Persistent compliance banner rendered on EVERY page by the root layout
// (ARCHITECTURE.md §13 — baked in, never bolted on). Not dismissible.
export default function DisclaimerBanner() {
  return (
    <div
      role="note"
      aria-label="Compliance disclaimer"
      className="bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100"
    >
      <p className="mx-auto w-full max-w-screen-md px-4 py-2 text-center text-xs font-medium sm:text-sm">
        {DISCLAIMER}
      </p>
    </div>
  );
}
