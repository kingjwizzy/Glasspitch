import type { Metadata } from 'next';
import Link from 'next/link';
import SectionHeader from '@/components/SectionHeader';
import ShareRow from '@/components/ShareRow';
import ChancesEmpty from '@/components/chances/ChancesEmpty';
import ChancesProvenance from '@/components/chances/ChancesProvenance';
import TeamFlag from '@/components/TeamFlag';
import { flagCodeForTeam } from '@/lib/flags';
import { getChancesData, type TeamChance } from '@/lib/queries/chances';
import { pct } from '@/lib/format';
import { SITE_NAME, SITE_URL } from '@/lib/constants';

// /chances — World Cup chances, the owner's flagship concept (ROADMAP.md §4
// item 7). PUBLIC + ISR: anon reads only, no cookies, no client JS — the
// circle cloud is pure RSC + CSS. Data is the nightly Monte Carlo simulation
// (jobs/simulate_chances.py, DB-only — no football-API call, ARCHITECTURE.md
// §5); until migration 0007 is applied and the sim first runs, the page
// renders its honest structural empty state.
export const revalidate = 3600;

const TITLE = 'World Cup chances — every nation, simulated daily';
const DESCRIPTION =
  'Every surviving nation’s chance of winning the World Cup, reaching the final and reaching the semi-finals — from a Monte Carlo simulation of the remaining bracket, re-run daily. Analysis, not betting advice.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/chances' },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    url: '/chances',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

/** Movement figure for the story table — arrow + printed pp value, colour as
 *  reinforcement only (DESIGN.md §2). */
function MoveFigure({ delta }: { delta: number | null }) {
  if (delta === null) {
    return (
      <span aria-label="No previous simulation to compare" className="font-mono text-fg-faint">
        —
      </span>
    );
  }
  const pp = Math.abs(delta * 100).toFixed(1);
  if (Math.abs(delta) < 0.0005) {
    return <span className="font-mono text-fg-dim">0.0</span>;
  }
  const up = delta > 0;
  return (
    <span
      aria-label={`${up ? 'Up' : 'Down'} ${pp} percentage points since the previous simulation`}
      className={`font-mono ${up ? 'text-green' : 'text-miss-bright'}`}
    >
      {up ? '▲' : '▼'} {pp}
    </span>
  );
}

/** Biggest absolute day-over-day movers, ready-sorted. */
function movers(teams: TeamChance[], limit = 6): Array<TeamChance & { delta: number }> {
  return teams
    .filter((t): t is TeamChance & { delta: number } => t.delta !== null)
    .filter((t) => Math.abs(t.delta) >= 0.005)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit);
}

/**
 * Circle sizing for the flagship cloud (audit #16 — encoding). AREA, not
 * diameter, tracks probability (diameter ∝ √p) — the dataviz-correct
 * encoding for a circle mark. The floor below is an AREA floor rather than a
 * diameter floor: a diameter floor gets stretched by the √ into roughly a
 * THIRD of the max diameter (~10% of its area), which is why a genuine
 * near-0% nation used to render as a surprisingly large, brand-undercutting
 * circle. A small area floor keeps a longshot reading as a longshot — while
 * never vanishing entirely, so ranking still reads at a glance on mobile.
 */
const CLOUD_MAX_PX = 132;
const CLOUD_MIN_PX = 14;
const CLOUD_FLOOR_AREA_RATIO = 0.012; // ~1.2% of the favourite's area

function circleDiameter(pWin: number, maxPWin: number): number {
  if (maxPWin <= 0) return CLOUD_MIN_PX;
  const areaRatio = Math.max(pWin / maxPWin, CLOUD_FLOOR_AREA_RATIO);
  const px = Math.round(CLOUD_MAX_PX * Math.sqrt(areaRatio));
  return Math.max(CLOUD_MIN_PX, Math.min(CLOUD_MAX_PX, px));
}

/** Flag disc at an arbitrary computed diameter — plain <img>, not TeamFlag
 *  (which only ships fixed 18/28px sizes). Same degrade-to-initials contract
 *  as TeamFlag: an unmapped team never renders a broken image, and the
 *  plain-text name label underneath stays the real identifier (§13). */
function CloudMark({ team, px }: { team: string; px: number }) {
  const code = flagCodeForTeam(team);
  const style = { width: px, height: px };
  if (!code) {
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

/** The flagship circle cloud — every surviving nation, sized by AREA (see
 *  above). Pure RSC + CSS, zero client JS (ARCHITECTURE.md §5/§8). Size is
 *  never the only signal: the exact % is always printed under every circle,
 *  with the day-over-day move beside it (DESIGN.md §2). */
function ChanceCircles({ teams }: { teams: TeamChance[] }) {
  if (teams.length === 0) return null;
  const maxPWin = teams[0].pWin; // teams arrive pWin-descending (getChancesData)

  return (
    <ol className="flex flex-wrap items-end justify-center gap-x-5 gap-y-7 py-2">
      {teams.map((t) => (
        <li
          key={t.teamId}
          className="flex max-w-32 flex-col items-center gap-1.5 text-center"
        >
          <CloudMark team={t.team} px={circleDiameter(t.pWin, maxPWin)} />
          <span className="max-w-full truncate text-[13px] leading-tight text-fg">
            {t.team}
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="font-mono text-sm font-medium text-fg">
              {pct(t.pWin)}
            </span>
            <MoveFigure delta={t.delta} />
          </span>
        </li>
      ))}
    </ol>
  );
}

export default async function ChancesPage() {
  const { snapshotDate, sims, teams, gone } = await getChancesData();
  const moved = movers(teams);

  return (
    <article className="space-y-10">
      <header className="floodlight space-y-2 pt-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg lg:text-3xl">
          World Cup chances
        </h1>
        <p className="max-w-[52ch] text-sm leading-relaxed text-fg-dim">
          Every nation still in the tournament, sized by its chance of lifting
          the trophy. We re-simulate the remaining bracket daily from our
          in-house ratings, so the circles grow and shrink after every
          full-time — and the day-over-day story is printed, not implied.
        </p>
      </header>

      {teams.length === 0 ? (
        <ChancesEmpty />
      ) : (
        <>
          <section aria-labelledby="cloud-heading">
            <h2 id="cloud-heading" className="sr-only">
              Chance of winning the tournament, by nation
            </h2>
            <ChanceCircles teams={teams} />
            <ChancesProvenance sims={sims} snapshotDate={snapshotDate} />
            {/* Share loop (audit #9) — the model's current favourite, honestly
                framed; teams[0] is the top of the pWin-descending order. */}
            <div className="mt-4 flex justify-center">
              <ShareRow
                url={`${SITE_URL}/chances`}
                title="World Cup chances — Glass Pitch"
                text={`Glass Pitch's model currently gives ${teams[0].team} the best chance of winning the World Cup — ${pct(teams[0].pWin)}.`}
              />
            </div>
          </section>

          {moved.length > 0 && (
            <section aria-labelledby="movers-heading">
              <SectionHeader
                id="movers-heading"
                title="Since yesterday"
                description="Biggest day-over-day change in title chance."
              />
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {moved.map((t) => (
                  <li key={t.teamId} className="glass px-4 py-3">
                    <p className="flex items-center gap-2 text-[15px] font-medium text-fg">
                      <TeamFlag name={t.team} />
                      {t.team}
                    </p>
                    <p className="mt-1 flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-fg-dim">
                        now {pct(t.pWin)} to win it all
                      </span>
                      <MoveFigure delta={t.delta} />
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="table-heading">
            <SectionHeader
              id="table-heading"
              title="The full picture"
              description="Semi-final, final and title chances for every surviving nation."
            />
            <div
              role="region"
              aria-label="Tournament chances by nation"
              tabIndex={0}
              className="glass overflow-x-auto px-4 py-1"
            >
              <table className="w-full min-w-[30rem] text-sm">
                <caption className="sr-only">
                  Tournament chances by nation — reach the semi-finals, reach
                  the final, win the tournament, and the day-over-day move
                </caption>
                <thead>
                  <tr className="text-left text-xs text-fg-dim">
                    <th scope="col" className="py-2.5 pr-3 font-normal">
                      Nation
                    </th>
                    <th scope="col" className="py-2.5 pr-3 text-right font-normal">
                      Semis
                    </th>
                    <th scope="col" className="py-2.5 pr-3 text-right font-normal">
                      Final
                    </th>
                    <th scope="col" className="py-2.5 pr-3 text-right font-normal">
                      Wins it
                    </th>
                    <th scope="col" className="py-2.5 text-right font-normal">
                      Day move
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {teams.map((t) => (
                    <tr key={t.teamId}>
                      <td className="py-3 pr-3">
                        <span className="flex items-center gap-2 text-[15px] font-medium text-fg">
                          <TeamFlag name={t.team} />
                          {t.team}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-right font-mono text-fg-dim">
                        {t.pSemi === null ? '—' : pct(t.pSemi)}
                      </td>
                      <td className="py-3 pr-3 text-right font-mono text-fg-dim">
                        {t.pFinal === null ? '—' : pct(t.pFinal)}
                      </td>
                      <td className="py-3 pr-3 text-right font-mono font-medium text-fg">
                        {pct(t.pWin)}
                      </td>
                      <td className="py-3 text-right">
                        <MoveFigure delta={t.delta} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {gone.length > 0 && (
            <section aria-labelledby="gone-heading">
              <SectionHeader
                id="gone-heading"
                title="Out of the running"
                description="Eliminated since we started simulating — the record keeps them."
              />
              <ul className="flex flex-wrap gap-x-5 gap-y-3">
                {gone.map((t) => (
                  <li
                    key={t.teamId}
                    className="flex items-center gap-1.5 text-[13px] text-fg-dim"
                  >
                    {/* Small + desaturated: gone, not erased. */}
                    <TeamFlag name={t.team} className="opacity-45 grayscale" />
                    {t.team}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
        These are estimates from a Monte Carlo simulation of the remaining
        bracket, built on our own simple in-house ratings and re-run daily —
        shown for context, with the trial count printed above. They are not
        the locked, scored match calls that make up{' '}
        <Link href="/ledger" className="text-green underline hover:text-green-bright">
          the public record
        </Link>
        , and like everything here they are analysis, not betting advice.
      </p>
    </article>
  );
}
