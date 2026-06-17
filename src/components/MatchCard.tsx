import Link from 'next/link';
import type { Fixture, Prediction, Team } from '@/lib/types';
import ProbabilityBar from './ProbabilityBar';

export interface MatchCardProps {
  fixture: Fixture;
  homeTeam: Team;
  awayTeam: Team;
  /** The primary (third-party, labelled — §9) prediction, if available. */
  prediction?: Prediction | null;
}

function formatKickoff(iso: string): string {
  // Render a stable UTC string server-side to avoid hydration mismatches and
  // keep times unambiguous (ARCHITECTURE.md §7: all times are UTC).
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toUTCString();
}

export default function MatchCard({
  fixture,
  homeTeam,
  awayTeam,
  prediction,
}: MatchCardProps) {
  return (
    <article className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <Link href={`/match/${fixture.id}`} className="block hover:opacity-80">
        <h3 className="text-base font-semibold">
          {homeTeam.name}{' '}
          <span className="text-black/40 dark:text-white/40">v</span>{' '}
          {awayTeam.name}
        </h3>
        <p className="mt-1 text-xs text-black/60 dark:text-white/60">
          <time dateTime={fixture.kickoff_utc}>
            {formatKickoff(fixture.kickoff_utc)}
          </time>
        </p>
        {prediction ? (
          <ProbabilityBar
            className="mt-3"
            home={prediction.prob_home}
            draw={prediction.prob_draw}
            away={prediction.prob_away}
          />
        ) : (
          <p className="mt-3 text-xs text-black/50 dark:text-white/50">
            Probabilities pending.
          </p>
        )}
      </Link>
    </article>
  );
}
