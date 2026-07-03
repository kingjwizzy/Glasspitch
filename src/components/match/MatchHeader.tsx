import Link from 'next/link';
import LivePill from '@/components/LivePill';
import { formatKickoff, scoreLine } from '@/lib/format';
import type { FixtureStatus } from '@/lib/types';

// The match header — the focal point of the page (DESIGN.md §4). Competition +
// status, the two teams as PLAIN TEXT (no crests/images — §13), the score (final
// when played, live when in play, "v" when upcoming) and the kickoff in UTC.
// One <h1> for the match: best for SEO and screen-reader navigation.

// Each team name links to its team page — the internal link that lets the
// team pages actually rank rather than only exist in the sitemap. A plain
// span→Link swap: with Tailwind preflight the anchor inherits colour and has no
// underline, so it looks identical to the text it replaces (no restyle). Falls
// back to plain text when a slug is missing, so a slugless row can never render
// a broken "/team/" link (mirrors the team-page guard).
function TeamName({
  name,
  slug,
  className,
}: {
  name: string;
  slug: string;
  className: string;
}) {
  if (!slug) return <span className={className}>{name}</span>;
  return (
    <Link href={`/team/${slug}`} className={className}>
      {name}
    </Link>
  );
}

// The competition name links to its league page (mirrors TeamName above) —
// internal-link equity for /league pages, which otherwise are reachable only
// from team-page headers and the sitemap (§11). Falls back to plain text when
// a slug is missing.
function CompetitionName({ name, slug }: { name: string; slug: string }) {
  if (!slug) return <p className="truncate text-xs text-fg-dim">{name}</p>;
  return (
    <p className="truncate text-xs">
      <Link href={`/league/${slug}`} className="text-fg-dim transition-colors hover:text-fg">
        {name}
      </Link>
    </p>
  );
}

function StatusPill({ status }: { status: FixtureStatus }) {
  if (status === 'live') return <LivePill />;
  const label =
    status === 'finished'
      ? 'Full time'
      : status === 'postponed'
        ? 'Postponed'
        : 'Upcoming';
  return (
    <span className="inline-flex items-center rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg-dim">
      {label}
    </span>
  );
}

export interface MatchHeaderProps {
  league: string;
  leagueSlug: string;
  home: string;
  away: string;
  homeSlug: string;
  awaySlug: string;
  kickoffUtc: string;
  status: FixtureStatus;
  finalHome: number | null;
  finalAway: number | null;
}

export default function MatchHeader({
  league,
  leagueSlug,
  home,
  away,
  homeSlug,
  awaySlug,
  kickoffUtc,
  status,
  finalHome,
  finalAway,
}: MatchHeaderProps) {
  const hasScore =
    (status === 'finished' || status === 'live') &&
    finalHome !== null &&
    finalAway !== null;

  return (
    <header className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        {league ? <CompetitionName name={league} slug={leagueSlug} /> : <span />}
        <StatusPill status={status} />
      </div>

      <h1 className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 font-display text-xl font-semibold tracking-tight text-fg sm:text-2xl">
        <TeamName name={home} slug={homeSlug} className="text-right" />
        <span className="shrink-0 text-center" aria-hidden={!hasScore || undefined}>
          {hasScore ? (
            <span className="font-mono text-2xl font-medium sm:text-3xl">
              {scoreLine(finalHome!, finalAway!)}
            </span>
          ) : (
            <span className="text-sm font-normal text-fg-dim">v</span>
          )}
        </span>
        <TeamName name={away} slug={awaySlug} className="text-left" />
      </h1>

      <p className="mt-3 text-center text-xs text-fg-dim">
        <time dateTime={kickoffUtc} className="font-mono">
          {formatKickoff(kickoffUtc)}
        </time>
      </p>
    </header>
  );
}
