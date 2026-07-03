import Link from 'next/link';
import ProbabilityBar from '@/components/ProbabilityBar';
import ResultBadge from '@/components/ResultBadge';
import TeamFlag from '@/components/TeamFlag';
import { dayLabel, favoured, formatTimeUtc, utcDateKey } from '@/lib/format';
import type { MatchResult } from '@/lib/types';
import type { FixtureView } from '@/lib/queries/homepage';

// The matchday stream (W4 spec §2) — day-grouped fixture CARDS on an ad-free,
// odds-free canvas. Sparse WC knockout days (2–4 fixtures) render as weighty
// .glass cards in a grid so the day reads as an event, not an empty list.
// Anatomy per card: left status gutter (kickoff time / "Full time" / live),
// stacked team lines with typographic winner emphasis (the no-crest answer —
// winner keeps weight, loser dims to --text-dim, which passes AA), a
// right-aligned mono score column, and a slim H/D/A bar with its percentages
// always printed. Finished rows carry the ✓/✗ only once the prediction is
// actually `scored` (same criterion as the ledger — §10).

function StatusGutter({ f }: { f: FixtureView }) {
  if (f.status === 'live') {
    return (
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-live">
        <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
        </span>
        live
      </span>
    );
  }
  if (f.status === 'finished') {
    return <span className="text-[11px] leading-tight text-fg-dim">Full time</span>;
  }
  if (f.status === 'postponed') {
    return <span className="text-[11px] leading-tight text-fg-dim">Postponed</span>;
  }
  return (
    <span className="flex flex-col">
      <time dateTime={f.kickoff_utc} className="font-mono text-sm text-fg">
        {formatTimeUtc(f.kickoff_utc)}
      </time>
      <span className="text-[11px] text-fg-dim">UTC</span>
    </span>
  );
}

function StreamCard({ f }: { f: FixtureView }) {
  const pred = f.prediction;
  const hasScore =
    (f.status === 'finished' || f.status === 'live') &&
    f.final_home_goals !== null &&
    f.final_away_goals !== null;
  // Typographic winner emphasis for finished matches only.
  const result: MatchResult | null =
    f.status === 'finished' && hasScore
      ? f.final_home_goals! > f.final_away_goals!
        ? 'home'
        : f.final_away_goals! > f.final_home_goals!
          ? 'away'
          : 'draw'
      : null;
  const homeCls =
    result === null || result === 'home' || result === 'draw'
      ? 'font-medium text-fg'
      : 'text-fg-dim';
  const awayCls =
    result === null || result === 'away' || result === 'draw'
      ? 'font-medium text-fg'
      : 'text-fg-dim';
  // ✓/✗ only for a genuinely scored prediction with a resolved result (§10).
  const hit =
    pred && pred.status === 'scored' && result !== null
      ? favoured({ home: pred.prob_home, draw: pred.prob_draw, away: pred.prob_away })
          .key === result
      : null;

  return (
    <li>
      <Link href={`/match/${f.id}`} className="glass card-interactive block p-4">
        <div className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-x-3">
          <StatusGutter f={f} />
          <div className="min-w-0 space-y-1.5">
            <p className={`flex items-center gap-2 truncate text-base ${homeCls}`}>
              <TeamFlag name={f.home} />
              {f.home}
            </p>
            <p className={`flex items-center gap-2 truncate text-base ${awayCls}`}>
              <TeamFlag name={f.away} />
              {f.away}
            </p>
          </div>
          {/* The score slot — reserved even when upcoming, so the card morphs
              upcoming → live → finished with zero layout shift. */}
          <div className="w-5 space-y-1.5 text-right font-mono text-base font-medium text-fg">
            {hasScore ? (
              <>
                <p className={result === 'away' ? 'text-fg-dim' : ''}>
                  {f.final_home_goals}
                </p>
                <p className={result === 'home' ? 'text-fg-dim' : ''}>
                  {f.final_away_goals}
                </p>
              </>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex items-end gap-3">
          {pred ? (
            <ProbabilityBar
              variant="row"
              home={pred.prob_home}
              draw={pred.prob_draw}
              away={pred.prob_away}
              className="min-w-0 flex-1"
            />
          ) : (
            <span className="flex-1 text-xs text-fg-dim">Call pending</span>
          )}
          {hit !== null && <ResultBadge hit={hit} />}
          {pred && f.status === 'scheduled' && (
            /* Quiet content cue: the written read exists — never betting copy. */
            <span className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-fg-dim">
              analysis
            </span>
          )}
        </div>
      </Link>
    </li>
  );
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
              <StreamCard key={f.id} f={f} />
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
