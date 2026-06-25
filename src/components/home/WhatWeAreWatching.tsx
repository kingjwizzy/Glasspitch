import Link from 'next/link';
import { formatKickoff, templateRead } from '@/lib/format';
import type { FixtureView } from '@/lib/queries/homepage';

// 1–3 featured matchups, each with a short plain-language read derived from the
// numbers (DESIGN.md §4). Honest framing only — never "guaranteed" (§9, §13).

function WatchCard({ f }: { f: FixtureView }) {
  const pred = f.prediction;
  const read = pred
    ? templateRead({
        home: pred.prob_home,
        draw: pred.prob_draw,
        away: pred.prob_away,
        home_name: f.home,
        away_name: f.away,
        predicted_home_goals: pred.predicted_home_goals,
        predicted_away_goals: pred.predicted_away_goals,
      })
    : null;

  return (
    <Link
      href={`/match/${f.id}`}
      className="block rounded-xl border border-line bg-surface p-4 transition-colors hover:border-fg/20 hover:bg-surface-2"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base font-semibold tracking-tight text-fg">
          {f.home} <span className="font-sans font-normal text-fg-dim">v</span>{' '}
          {f.away}
        </h3>
        <time
          dateTime={f.kickoff_utc}
          className="shrink-0 font-mono text-xs text-fg-dim"
        >
          {formatKickoff(f.kickoff_utc)}
        </time>
      </div>
      {read && <p className="mt-2 text-sm leading-relaxed text-fg-dim">{read}</p>}
    </Link>
  );
}

export default function WhatWeAreWatching({
  fixtures,
}: {
  fixtures: FixtureView[];
}) {
  if (fixtures.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-6 text-sm text-fg-dim">
        Nothing flagged yet — featured matchups appear here once predictions are
        in.
      </p>
    );
  }
  return (
    <ul className="grid list-none gap-3 sm:grid-cols-2">
      {fixtures.map((f) => (
        <li key={f.id}>
          <WatchCard f={f} />
        </li>
      ))}
    </ul>
  );
}
