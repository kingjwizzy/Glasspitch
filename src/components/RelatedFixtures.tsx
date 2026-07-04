import Link from 'next/link';
import TeamFlag from '@/components/TeamFlag';
import { formatDateShort, formatTimeUtc, scoreLine } from '@/lib/format';
import type { RelatedFixtureItem } from '@/lib/queries/related';

// Dense internal-linking block shared by match/team/league pages
// (ARCHITECTURE.md §11 "the growth engine"; RAMBO wave 2 improvement #4).
// Deliberately lighter than FixtureRow/FixtureList (no probability bar, no
// ✓/✗): the point of this surface is link density and crawl depth to OTHER
// pages, not repeating the full match card a visitor already saw above.
// Zero client JS — plain <Link>s only. Renders nothing when every group is
// empty, so a quiet section never appears with nothing in it.

export interface RelatedFixtureGroup {
  heading: string;
  items: RelatedFixtureItem[];
}

function RelatedRow({ item }: { item: RelatedFixtureItem }) {
  const finished =
    item.status === 'finished' &&
    item.final_home_goals !== null &&
    item.final_away_goals !== null;

  return (
    <li>
      <Link
        href={`/match/${item.id}`}
        className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-2"
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate text-sm text-fg">
          <TeamFlag name={item.home} />
          <span className="truncate">{item.home}</span>
          <span className="shrink-0 text-fg-dim">v</span>
          <TeamFlag name={item.away} />
          <span className="truncate">{item.away}</span>
        </span>
        <span className="shrink-0 font-mono text-xs text-fg-dim">
          {finished
            ? scoreLine(item.final_home_goals!, item.final_away_goals!)
            : `${formatDateShort(item.kickoff_utc)} ${formatTimeUtc(item.kickoff_utc)}`}
        </span>
      </Link>
    </li>
  );
}

export default function RelatedFixtures({
  headingId,
  heading,
  description,
  groups,
}: {
  headingId: string;
  heading: string;
  description?: string;
  groups: RelatedFixtureGroup[];
}) {
  const populated = groups.filter((g) => g.items.length > 0);
  if (populated.length === 0) return null;

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="font-display text-lg font-semibold tracking-tight text-fg lg:text-2xl"
      >
        {heading}
      </h2>
      {description && (
        <p className="mt-1 max-w-[42ch] text-sm text-fg-dim">{description}</p>
      )}
      <div className="mt-3 space-y-4">
        {populated.map((g) => (
          <div key={g.heading}>
            <h3 className="mb-1.5 text-xs font-medium text-fg-dim">{g.heading}</h3>
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface px-2">
              {g.items.map((item) => (
                <RelatedRow key={item.id} item={item} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
