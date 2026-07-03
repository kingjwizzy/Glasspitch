import Link from 'next/link';
import { pct, templateRead } from '@/lib/format';
import type { FixtureView } from '@/lib/queries/homepage';

// "What we're watching" (W4 spec §3) — 1–2 featured matchups, kept lean and
// quiet so the promoted surfaces keep meaning: teams in Archivo, the one-line
// hook derived honestly from the numbers (never "guaranteed" — §9, §13), the
// probability trio in small mono with H/D/A letter chips, and a green
// arrow-link. No thick bars here — display-scale data hierarchy lives in the
// hero.

const OUTCOMES = [
  { key: 'home' as const, letter: 'H', chip: 'bg-home' },
  { key: 'draw' as const, letter: 'D', chip: 'bg-draw' },
  { key: 'away' as const, letter: 'A', chip: 'bg-away' },
];

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
  const probs = pred
    ? { home: pred.prob_home, draw: pred.prob_draw, away: pred.prob_away }
    : null;

  return (
    <Link href={`/match/${f.id}`} className="glass card-interactive block p-4 lg:p-5">
      <h3 className="font-display text-lg font-semibold tracking-tight text-fg">
        {f.home} <span className="font-sans text-sm font-normal text-fg-dim">v</span>{' '}
        {f.away}
      </h3>
      {read && <p className="mt-2 text-base leading-relaxed text-fg-dim">{read}</p>}
      {probs && (
        <p
          className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5"
          aria-label={`Win probability — home ${pct(probs.home)}, draw ${pct(probs.draw)}, away ${pct(probs.away)}`}
        >
          {OUTCOMES.map((o) => (
            <span key={o.key} className="flex items-center gap-1.5" aria-hidden="true">
              <span
                className={`${o.chip} inline-flex h-4 w-4 items-center justify-center rounded-[3px] text-[10px] font-semibold text-bg`}
              >
                {o.letter}
              </span>
              <span className="font-mono text-base font-medium text-fg">
                {pct(probs[o.key])}
              </span>
            </span>
          ))}
        </p>
      )}
      <p className="mt-3 text-sm font-medium text-green">
        Read the full analysis &rarr;
      </p>
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
      <p className="glass px-4 py-6 text-sm text-fg-dim">
        Nothing flagged yet — featured matchups appear here once predictions are
        in.
      </p>
    );
  }
  return (
    <ul className="grid list-none gap-4 sm:grid-cols-2">
      {fixtures.slice(0, 2).map((f) => (
        <li key={f.id}>
          <WatchCard f={f} />
        </li>
      ))}
    </ul>
  );
}
