import Link from 'next/link';
import { ArrowRightIcon } from '@/components/icons';

// The one quiet "deeper read" affordance on the public match page (DESIGN.md
// §6: no more than one quiet upgrade affordance per page, no urgency, no dark
// patterns). Identical markup for every visitor — it must NOT read cookies or
// know entitlement, or it would force the cached /match/[id] page dynamic
// (ARCHITECTURE.md §7 v2 amendment). The link always points at the dynamic
// /match/[id]/insights route, which decides for itself whether to show the
// real content or a plain upgrade note (see that page).
export default function DeeperReadCallout({ fixtureId }: { fixtureId: number }) {
  return (
    <section aria-labelledby="deeper-read-heading">
      <h2
        id="deeper-read-heading"
        className="mb-2 font-display text-base font-semibold tracking-tight text-fg"
      >
        Deeper read
      </h2>
      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm leading-relaxed text-fg-dim">
        Prediction detail and post-match stats for this fixture are part of
        Glass Pitch Premium — the full ledger and every match&rsquo;s
        probabilities stay free forever either way.{' '}
        <Link
          href={`/match/${fixtureId}/insights`}
          className="inline-flex min-h-11 items-center gap-1 font-medium text-green transition-colors hover:text-green-bright"
        >
          See the deeper read
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </Link>
      </p>
    </section>
  );
}
