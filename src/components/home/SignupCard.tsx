import Link from 'next/link';

// The sign-up end-cap (W4 spec §7) — the ONLY sign-up affordance in the page
// body, placed after the page has demonstrated its value (the header's dim
// "Sign in" is navigation, not a CTA). One card, one primary button, one plain
// link. Deliberately absent, by construction (DESIGN.md §6): modals, sticky
// bars, interstitials, countdowns, member counts, guilt/scarcity copy, and any
// premium/upgrade mention. The "…stay free" disclosure sits beside the button
// — it removes perceived risk instead of manufacturing urgency.

export default function SignupCard() {
  return (
    <div className="glass mx-auto max-w-xl p-6 text-center lg:p-8">
      <h2
        id="signup-heading"
        className="font-display text-xl font-semibold tracking-tight text-fg"
      >
        Keep your own watch on the record
      </h2>
      <p className="mx-auto mt-2 max-w-prose text-base text-fg-dim">
        A free account lets you follow teams and get results after the final
        whistle. The ledger and every prediction stay free.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-green px-5 text-sm font-medium text-bg transition-colors hover:bg-green-bright"
        >
          Create a free account
        </Link>
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center text-sm text-green-bright transition-colors hover:text-green"
        >
          Already have one? Sign in
        </Link>
      </div>
    </div>
  );
}
