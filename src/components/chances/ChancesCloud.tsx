import { flagCodeForTeam } from '@/lib/flags';
import { pct } from '@/lib/format';
import type { TeamChance } from '@/lib/queries/chances';

// The World Cup Chances circles — the owner's flagship concept (ROADMAP.md
// §4 item 7): every surviving nation as a circle flag SIZED by its chance of
// winning the tournament, shrinking or growing after every full-time. Pure
// RSC + CSS (a flex cloud with computed diameters) — ZERO client JS, so the
// public pages stay static/ISR (ARCHITECTURE.md §5/§8).
//
// Honest sizing: circle AREA is proportional to probability (diameter ∝ √p),
// scaled relative to the current favourite — the dataviz-correct encoding
// for circle marks. Size is never the only signal: the exact % is printed
// under every circle, with the day-over-day move beside it (DESIGN.md §2
// "colour/size never the sole carrier"). Flags are sanctioned national
// symbols; an unmapped team degrades to a plain-text initial disc and the
// name label stays the identifier everywhere (§13).

const MAX_PX = 128; // the favourite (spec floor: largest ≥ 96px)
const MIN_PX = 40; // long shots stay legible + tappable label underneath

function diameter(pWin: number, maxPWin: number): number {
  if (maxPWin <= 0) return MIN_PX;
  const px = Math.round(MAX_PX * Math.sqrt(pWin / maxPWin));
  return Math.max(MIN_PX, Math.min(MAX_PX, px));
}

/** Signed day-over-day move in percentage points ("▲ 1.2"). Arrow + sign
 *  carry direction; colour is reinforcement only. */
function MoveTick({ delta }: { delta: number | null }) {
  if (delta === null) return null;
  const pp = Math.abs(delta * 100).toFixed(1);
  if (Math.abs(delta) < 0.0005) {
    return <span className="font-mono text-[11px] text-fg-dim">0.0</span>;
  }
  const up = delta > 0;
  return (
    <span
      aria-label={`${up ? 'Up' : 'Down'} ${pp} percentage points since the previous simulation`}
      className={`font-mono text-[11px] ${up ? 'text-green' : 'text-miss-bright'}`}
    >
      {up ? '▲' : '▼'} {pp}
    </span>
  );
}

function CircleMark({ team, px }: { team: string; px: number }) {
  const code = flagCodeForTeam(team);
  const style = { width: px, height: px };
  if (!code) {
    // Unmapped team: plain-text initial disc — never a broken image.
    return (
      <span
        aria-hidden="true"
        style={style}
        className="flex items-center justify-center rounded-full border border-line bg-surface-2 font-display font-semibold text-fg-dim"
      >
        {team.slice(0, 3).toUpperCase()}
      </span>
    );
  }
  return (
    // Tiny local SVGs — plain <img> (see components/TeamFlag.tsx); explicit
    // width/height means zero CLS at every computed diameter.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/flags/${code}.svg`}
      alt=""
      aria-hidden="true"
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      style={style}
      className="rounded-full"
    />
  );
}

export default function ChancesCloud({ teams }: { teams: TeamChance[] }) {
  if (teams.length === 0) return null;
  const maxPWin = teams[0].pWin; // callers pass pWin-descending order

  return (
    // List order = ranking order (favourite first) — the reading order a
    // screen reader gets matches what sighted visitors see.
    <ol className="flex flex-wrap items-end justify-center gap-x-5 gap-y-7 py-2">
      {teams.map((t) => (
        <li
          key={t.teamId}
          className="flex max-w-32 flex-col items-center gap-1.5 text-center"
        >
          <CircleMark team={t.team} px={diameter(t.pWin, maxPWin)} />
          <span className="max-w-full truncate text-[13px] leading-tight text-fg">
            {t.team}
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="font-mono text-sm font-medium text-fg">
              {pct(t.pWin)}
            </span>
            <MoveTick delta={t.delta} />
          </span>
        </li>
      ))}
    </ol>
  );
}
