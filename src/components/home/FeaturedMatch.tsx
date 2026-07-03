import Link from 'next/link';
import ProbabilityBar from '@/components/ProbabilityBar';
import LivePill from '@/components/LivePill';
import TeamFlag from '@/components/TeamFlag';
import {
  favoured,
  formatDateTimeShort,
  kickoffPhrase,
  pct,
  scoreLine,
} from '@/lib/format';
import { isLocked } from '@/components/LockStatusLine';
import type { MatchResult } from '@/lib/types';
import type { FixtureView } from '@/lib/queries/homepage';

// The featured match — the product as the hero (W4 spec §1): the live match if
// any, else the next kickoff, on the page's only .glass-raised + floodlight
// surface. Big Archivo team names, display-scale mono probabilities in the
// blue/grey/amber data colours, our locked call, and factual liveness — the
// kickoff line and the live score share one slot so the card morphs
// upcoming → live with zero layout shift.

// Favoured-outcome tint, applied ONLY at display size (the 28/40px trio):
// --home and --away pass AA there; --draw (#8A938F) stays --text because the
// grey only passes contrast at display sizes and tinting it buys nothing.
const TINT: Record<MatchResult, string> = {
  home: 'text-home',
  draw: 'text-fg',
  away: 'text-away',
};

const OUTCOMES = [
  { key: 'home' as const, letter: 'H', label: 'Home', chip: 'bg-home' },
  { key: 'draw' as const, letter: 'D', label: 'Draw', chip: 'bg-draw' },
  { key: 'away' as const, letter: 'A', label: 'Away', chip: 'bg-away' },
];

export default function FeaturedMatch({
  fixture,
  renderedAt,
}: {
  fixture: FixtureView;
  renderedAt: string;
}) {
  const isLive = fixture.status === 'live';
  const pred = fixture.prediction;
  const hasLiveScore =
    isLive && fixture.final_home_goals !== null && fixture.final_away_goals !== null;
  const fav = pred
    ? favoured({ home: pred.prob_home, draw: pred.prob_draw, away: pred.prob_away })
    : null;
  const probs = pred
    ? { home: pred.prob_home, draw: pred.prob_draw, away: pred.prob_away }
    : null;

  return (
    <Link
      href={`/match/${fixture.id}`}
      className="glass-raised card-interactive block rounded-2xl p-5 lg:p-8"
    >
      {/* Competition line. */}
      <p className="text-[13px] text-fg-dim">{fixture.league}</p>

      {/* Teams — plain text first (§13); flags are decorative (aria-hidden). */}
      <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight text-fg lg:text-[32px] lg:leading-tight">
        <span className="flex items-center gap-2.5">
          <TeamFlag name={fixture.home} size="hero" />
          {fixture.home}
        </span>
        <span
          className="my-0.5 block font-sans text-sm font-normal text-fg-dim"
          aria-hidden="true"
        >
          v
        </span>
        <span className="flex items-center gap-2.5">
          <TeamFlag name={fixture.away} size="hero" />
          {fixture.away}
        </span>
      </h2>

      {/* The kickoff-or-live-score slot: one fixed block, so upcoming → live
          morphs with zero layout shift. */}
      <div className="mt-4 flex min-h-11 items-center gap-3">
        {isLive ? (
          <>
            <LivePill />
            {hasLiveScore && (
              <span className="font-mono text-[32px] font-medium leading-none text-fg">
                {scoreLine(fixture.final_home_goals!, fixture.final_away_goals!)}
              </span>
            )}
          </>
        ) : (
          <p className="text-sm text-fg-dim">
            {kickoffPhrase(fixture.kickoff_utc, renderedAt)}
          </p>
        )}
      </div>

      {pred && fav && probs ? (
        <div className="mt-5">
          {/* The probability trio — the dominant element. Colour is never the
              only signal: every figure prints its %, letter chip and word. */}
          <dl className="grid grid-cols-3 gap-2">
            {OUTCOMES.map((o) => (
              <div key={o.key} className="flex flex-col gap-1.5">
                <dd
                  className={`order-2 font-mono text-[28px] font-medium leading-none lg:text-[40px] ${
                    fav.key === o.key ? TINT[o.key] : 'text-fg'
                  }`}
                >
                  {pct(probs[o.key])}
                </dd>
                <dt className="order-1 flex items-center gap-1.5 text-xs text-fg-dim">
                  <span
                    aria-hidden="true"
                    className={`${o.chip} inline-flex h-4 w-4 items-center justify-center rounded-[3px] text-[10px] font-semibold text-bg`}
                  >
                    {o.letter}
                  </span>
                  {o.label}
                </dt>
              </div>
            ))}
          </dl>

          <ProbabilityBar
            variant="hero"
            home={pred.prob_home}
            draw={pred.prob_draw}
            away={pred.prob_away}
            className="mt-4"
          />

          <p className="mt-4 text-[13px] text-fg-dim">
            predicted score{' '}
            <span className="ml-1 font-mono text-xl font-medium text-fg">
              {scoreLine(pred.predicted_home_goals, pred.predicted_away_goals)}
            </span>
          </p>

          {/* Provenance microline — every claim checkable (W4 spec §1). */}
          <p className="mt-4 font-mono text-[11px] leading-4 text-fg-dim">
            third-party model · published {formatDateTimeShort(pred.published_at)} ·{' '}
            {isLocked(pred.status) ? 'locked at kickoff' : 'locks at kickoff'} · scored
            either way
          </p>
        </div>
      ) : (
        <p className="mt-5 text-sm text-fg-dim">
          Probabilities are published once the model has run.
        </p>
      )}

      <p className="mt-5 text-sm font-medium text-green">Full analysis &rarr;</p>
    </Link>
  );
}
