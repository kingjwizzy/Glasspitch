import Link from 'next/link';
import MatchRow, { type MatchRowFixture } from '@/components/MatchRow';
import { dayLabel, utcDateKey } from '@/lib/format';
import type { FixtureView } from '@/lib/queries/homepage';

// The matchday stream (W4 spec §2) — day-grouped fixture CARDS on an ad-free,
// odds-free canvas. Sparse WC knockout days (2–4 fixtures) render as weighty
// .glass cards (MatchRow's `card` variant — RAMBO wave 3 #8) in a grid so the
// day reads as an event, not an empty list.

/** Adapt the home read layer's FixtureView onto MatchRow's variant-agnostic
 *  shape (RAMBO wave 3 #8). */
function toMatchRowFixture(f: FixtureView): MatchRowFixture {
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

export default function UpcomingFixtures({
  fixtures,
  renderedAt,
}: {
  fixtures: FixtureView[];
  renderedAt: string;
}) {
  if (fixtures.length === 0) {
    return (
      <p className="glass px-4 py-6 text-sm text-fg-dim">
        No upcoming fixtures right now — they&rsquo;ll appear here as soon as the
        next matches are scheduled.
      </p>
    );
  }

  // Day groups, in kickoff order (matching how fans think about the schedule).
  const groups = new Map<string, FixtureView[]>();
  for (const f of [...fixtures].sort((a, b) =>
    a.kickoff_utc.localeCompare(b.kickoff_utc),
  )) {
    const key = utcDateKey(f.kickoff_utc);
    const group = groups.get(key);
    if (group) group.push(f);
    else groups.set(key, [f]);
  }
  const todayKey = utcDateKey(renderedAt);

  return (
    <div className="space-y-6">
      {[...groups.entries()].map(([key, group]) => (
        <div key={key}>
          {/* The today group is introduced by the section header itself. */}
          {key !== todayKey && (
            <h3 className="mb-2 font-mono text-xs font-medium text-fg-dim">
              {dayLabel(group[0].kickoff_utc, renderedAt)}
            </h3>
          )}
          <ul
            className={`grid gap-3 ${
              group.length >= 5 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
            }`}
          >
            {group.map((f) => (
              <MatchRow key={f.id} variant="card" fixture={toMatchRowFixture(f)} />
            ))}
          </ul>
        </div>
      ))}

      {/* Probability literacy — why we score our misses (W4 spec §2). */}
      <p className="text-[13px] leading-relaxed text-fg-dim">
        64% means: played 100 times, we&rsquo;d expect that result in about 64 —
        which is why we{' '}
        <Link
          href="/about"
          className="text-green underline decoration-green/50 underline-offset-2 transition-colors hover:text-green-bright"
        >
          score our misses too
        </Link>
        .
      </p>
    </div>
  );
}
