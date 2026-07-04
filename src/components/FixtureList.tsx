import type { FixtureRowView } from '@/lib/queries/fixtures';
import MatchRow, { type MatchRowFixture } from '@/components/MatchRow';

// A bordered list of fixture rows, or an honest empty state when there are none
// (DESIGN.md §9: "Empty states invite action"). Used by both the team and league
// pages so the empty-state border and text-dim style are consistent everywhere.

/** Adapt the team/league/matches read layer's FixtureRowView onto MatchRow's
 *  variant-agnostic shape (RAMBO wave 3 #8). */
function toMatchRowFixture(f: FixtureRowView): MatchRowFixture {
  return {
    id: f.id,
    kickoffUtc: f.kickoff_utc,
    status: f.status,
    home: f.home,
    away: f.away,
    finalHomeGoals: f.final_home_goals,
    finalAwayGoals: f.final_away_goals,
    statusShort: f.status_short,
    elapsedMinute: f.elapsed_minute,
    elapsedExtraMinute: f.elapsed_extra_minute,
    prediction: f.prediction
      ? {
          prob_home: f.prediction.prob_home,
          prob_draw: f.prediction.prob_draw,
          prob_away: f.prediction.prob_away,
          status: f.prediction.status,
        }
      : null,
  };
}

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
        <MatchRow key={f.id} variant="list" fixture={toMatchRowFixture(f)} />
      ))}
    </ul>
  );
}
