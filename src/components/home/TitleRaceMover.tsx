import TeamFlag from '@/components/TeamFlag';
import { pct } from '@/lib/format';
import type { TeamChance } from '@/lib/queries/chances';

// The homepage's one-line "title race" highlight (RAMBO wave 2 #2) — the
// single biggest day-over-day mover in World Cup title chance, spelled out as
// a plain factual sentence rather than left implicit in a delta tick. Placed
// on the HOMEPAGE rather than at the top of /chances: /chances already has
// its own "Since yesterday" grid of every meaningful mover further down that
// page, so a duplicate single-mover card there would repeat information
// already on-screen. The homepage has no equivalent story-of-the-day line at
// all today (its chances section only shows small per-circle delta ticks —
// components/chances/ChancesCloud.tsx), and is the highest-traffic surface,
// so this is where a one-line "what changed" narrative adds the most without
// requiring a click-through. Pure RSC + CSS, zero client JS (ARCHITECTURE.md
// §5/§8) — plain-text team name is the identifier; the flag is decorative.
//
// Callers only render this when `biggestMover()` (lib/queries/chances.ts)
// returns non-null — no prior snapshot, or nothing moved meaningfully, means
// this renders nothing rather than an empty/placeholder card.

export interface TitleRaceMoverProps {
  mover: TeamChance & { delta: number };
}

export default function TitleRaceMover({ mover }: TitleRaceMoverProps) {
  const prevPWin = mover.pWin - mover.delta;
  const prevPct = pct(prevPWin);
  const curPct = pct(mover.pWin);
  // pct()'s honest rounding (whole percent, with <1%/>99% caps) can — right
  // at the edges — round two genuinely different values to the same printed
  // figure. Rather than show a "rose N pts today — 18% → 18%" sentence that
  // contradicts itself, omit the card: the underlying delta is real, but
  // there is nothing legible to say about it at this precision.
  if (prevPct === curPct) return null;

  const up = mover.delta > 0;
  const pts = Math.abs(mover.delta * 100).toFixed(1);

  return (
    <p className="glass flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-sm leading-relaxed text-fg">
      <TeamFlag name={mover.team} />
      <span>
        <span className="font-medium">{mover.team}</span>&rsquo;s title chance{' '}
        {up ? 'rose' : 'fell'}{' '}
        <span className={`font-mono font-medium ${up ? 'text-green' : 'text-miss-bright'}`}>
          {pts} pts
        </span>{' '}
        today — <span className="font-mono text-fg-dim">{prevPct} → {curPct}</span>.
      </span>
    </p>
  );
}
