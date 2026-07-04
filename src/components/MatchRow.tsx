import Link from 'next/link';
import ResultBadge from '@/components/ResultBadge';
import ProbabilityBar from '@/components/ProbabilityBar';
import TeamFlag from '@/components/TeamFlag';
import { favoured, formatTimeUtc, formatDateShort, liveMinuteLabel } from '@/lib/format';
import type { MatchResult, FixtureStatus, PredictionStatus } from '@/lib/types';

// The canonical match row (RAMBO wave 3 #8) — one presentation of "one match,
// one row" consolidating what used to be two near-identical, drifting
// components: FixtureRow (bordered `list` rows on team/league/matches pages)
// and StreamCard (`glass` matchday-stream cards on the home page). Anatomy,
// shared by both variants: a fixed left status gutter (kickoff time / "Full
// time" / live + minute), two stacked team lines with typographic winner
// emphasis (winner keeps weight, loser dims — the no-crest answer, §13), a
// right-aligned mono score column in a reserved slot (zero shift as the row
// morphs upcoming → live → finished), and a slim H/D/A bar with its
// percentages always printed (colour is never the only signal, §2).
//
// `variant="list"` preserves FixtureRow's exact prior markup/sizing (3.5rem
// gutter, text-h3 team names, the aria-hidden H/A side chip); `variant="card"`
// preserves StreamCard's (glass card, 3.25rem gutter, text-base team names,
// the "analysis" content cue on upcoming published calls, no side chip) — the
// visual difference between them is intentional and unchanged, only the
// implementation is now shared.

export interface MatchRowPrediction {
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  status: PredictionStatus;
}

export interface MatchRowFixture {
  id: number;
  kickoffUtc: string;
  status: FixtureStatus;
  home: string;
  away: string;
  finalHomeGoals: number | null;
  finalAwayGoals: number | null;
  prediction: MatchRowPrediction | null;
  /** Live-match clock columns (RAMBO wave 3 #1) — nullable until the fetch
   *  sweep has touched this fixture since kickoff; render defensively via
   *  `lib/format.ts`'s `liveMinuteLabel()`. Optional so a caller that hasn't
   *  threaded them through yet still type-checks (treated as null). */
  statusShort?: string | null;
  elapsedMinute?: number | null;
  elapsedExtraMinute?: number | null;
}

export type MatchRowVariant = 'list' | 'card';

export interface MatchRowProps {
  fixture: MatchRowFixture;
  variant?: MatchRowVariant;
}

const SIDE_CHIP = {
  home: { letter: 'H', chip: 'bg-home' },
  away: { letter: 'A', chip: 'bg-away' },
} as const;

// Decorative H/A letter chip beside the team name (list variant only — see
// the file-level note on why the two variants intentionally differ here).
// aria-hidden: the letter is a secondary marker, never the sole signal (§2),
// and the plain-text team name stays the primary identifier.
function SideChip({ side }: { side: 'home' | 'away' }) {
  const { letter, chip } = SIDE_CHIP[side];
  return (
    <span
      aria-hidden="true"
      className={`${chip} inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] text-[9px] font-semibold text-bg`}
    >
      {letter}
    </span>
  );
}

function StatusGutter({ f, variant }: { f: MatchRowFixture; variant: MatchRowVariant }) {
  const isList = variant === 'list';
  const liveTextCls = isList ? 'text-small' : 'text-[13px]';
  const dimTextCls = isList ? 'text-micro' : 'text-[11px] leading-tight';

  if (f.status === 'live') {
    // Only trusted while status === 'live' (RAMBO wave 3 #1); a fixture the
    // fetch sweep hasn't touched yet renders null here, and the "live" word
    // alone still carries the meaning — never a blank or literal "null'".
    const minute = liveMinuteLabel({
      statusShort: f.statusShort ?? null,
      elapsedMinute: f.elapsedMinute ?? null,
      elapsedExtraMinute: f.elapsedExtraMinute ?? null,
    });
    return (
      <span className={`flex items-center gap-1.5 font-medium text-live ${liveTextCls}`}>
        <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
        </span>
        live
        {minute && <span className="font-mono tabular-nums">{minute}</span>}
      </span>
    );
  }
  if (f.status === 'finished') {
    if (isList) {
      return (
        <span className="flex flex-col">
          <span className={`${dimTextCls} text-fg-dim`}>Full time</span>
          <time dateTime={f.kickoffUtc} className="mt-0.5 font-mono text-micro text-fg-dim">
            {formatDateShort(f.kickoffUtc)}
          </time>
        </span>
      );
    }
    return <span className={`${dimTextCls} text-fg-dim`}>Full time</span>;
  }
  if (f.status === 'postponed') {
    return <span className={`${dimTextCls} text-fg-dim`}>Postponed</span>;
  }
  return (
    <span className="flex flex-col">
      <time dateTime={f.kickoffUtc} className="font-mono text-sm text-fg">
        {formatTimeUtc(f.kickoffUtc)}
      </time>
      <span className={`${isList ? 'text-micro' : 'text-[11px]'} text-fg-dim`}>UTC</span>
    </span>
  );
}

export default function MatchRow({ fixture: f, variant = 'list' }: MatchRowProps) {
  const isCard = variant === 'card';
  const pred = f.prediction;
  const hasScore =
    (f.status === 'finished' || f.status === 'live') &&
    f.finalHomeGoals !== null &&
    f.finalAwayGoals !== null;
  // Typographic winner emphasis for finished matches only.
  const result: MatchResult | null =
    f.status === 'finished' && hasScore
      ? f.finalHomeGoals! > f.finalAwayGoals!
        ? 'home'
        : f.finalAwayGoals! > f.finalHomeGoals!
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
  const fav = pred
    ? favoured({ home: pred.prob_home, draw: pred.prob_draw, away: pred.prob_away })
    : null;
  // ✓/✗ only for a genuinely scored prediction with a resolved result (§10) —
  // the same criterion the ledger uses, so a row's badge can never disagree
  // with the headline record.
  const hit =
    pred && pred.status === 'scored' && result !== null && fav ? fav.key === result : null;

  const linkCls = isCard
    ? 'glass card-interactive block p-4'
    : 'card-interactive block rounded-lg px-2 py-3 transition-colors hover:bg-surface-2';
  const gridCls = isCard
    ? 'grid-cols-[3.25rem_minmax(0,1fr)_auto]'
    : 'grid-cols-[3.5rem_minmax(0,1fr)_auto]';
  const teamStackCls = isCard ? 'space-y-1.5' : 'space-y-1';
  const teamTextCls = isCard ? 'text-base' : 'text-h3';
  const scoreStackCls = isCard ? 'space-y-1.5' : 'space-y-1';
  const barRowCls = isCard
    ? 'mt-3 flex items-end gap-3'
    : 'mt-2 flex items-end gap-3 pl-[calc(3.5rem+0.75rem)]';
  const barCls = isCard ? 'min-w-0 flex-1' : 'min-w-0 max-w-56 flex-1';

  return (
    <li>
      <Link href={`/match/${f.id}`} className={linkCls}>
        <div className={`grid ${gridCls} items-center gap-x-3`}>
          <StatusGutter f={f} variant={variant} />
          <div className={`min-w-0 ${teamStackCls}`}>
            <p className={`flex items-center gap-2 truncate ${teamTextCls} ${homeCls}`}>
              {!isCard && <SideChip side="home" />}
              <TeamFlag name={f.home} />
              {f.home}
            </p>
            <p className={`flex items-center gap-2 truncate ${teamTextCls} ${awayCls}`}>
              {!isCard && <SideChip side="away" />}
              <TeamFlag name={f.away} />
              {f.away}
            </p>
          </div>
          {/* Reserved score slot — filled once there is a score, so the row
              morphs upcoming → live → finished with zero layout shift. */}
          <div className={`w-5 ${scoreStackCls} text-right font-mono ${teamTextCls} font-medium text-fg`}>
            {hasScore ? (
              <>
                <p className={result === 'away' ? 'text-fg-dim' : ''}>{f.finalHomeGoals}</p>
                <p className={result === 'home' ? 'text-fg-dim' : ''}>{f.finalAwayGoals}</p>
              </>
            ) : null}
          </div>
        </div>

        <div className={barRowCls}>
          {pred ? (
            <ProbabilityBar
              variant="row"
              home={pred.prob_home}
              draw={pred.prob_draw}
              away={pred.prob_away}
              favoured={fav?.key}
              className={barCls}
            />
          ) : (
            <span className="flex-1 text-xs text-fg-dim">Call pending</span>
          )}
          {hit !== null && <ResultBadge hit={hit} />}
          {/* Quiet content cue (card variant only, matching StreamCard's prior
              behaviour): the written read exists — never betting copy. */}
          {isCard && pred && f.status === 'scheduled' && (
            <span className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-fg-dim">
              analysis
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}
