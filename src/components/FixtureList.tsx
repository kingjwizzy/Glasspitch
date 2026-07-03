import type { FixtureRowView } from '@/lib/queries/fixtures';
import FixtureRow from '@/components/FixtureRow';

// A bordered list of fixture rows, or an honest empty state when there are none
// (DESIGN.md §9: "Empty states invite action"). Used by both the team and league
// pages so the empty-state border and text-dim style are consistent everywhere.

export default function FixtureList({
  fixtures,
  emptyMessage = 'No fixtures yet.',
}: {
  fixtures: FixtureRowView[];
  emptyMessage?: string;
}) {
  if (fixtures.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-6 text-sm text-fg-dim">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-surface px-2">
      {fixtures.map((f) => (
        <FixtureRow key={f.id} fixture={f} />
      ))}
    </ul>
  );
}
