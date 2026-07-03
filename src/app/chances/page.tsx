import type { Metadata } from 'next';
import Link from 'next/link';
import SectionHeader from '@/components/SectionHeader';
import ChancesCloud from '@/components/chances/ChancesCloud';
import ChancesEmpty from '@/components/chances/ChancesEmpty';
import ChancesProvenance from '@/components/chances/ChancesProvenance';
import TeamFlag from '@/components/TeamFlag';
import { getChancesData, type TeamChance } from '@/lib/queries/chances';
import { pct } from '@/lib/format';
import { SITE_NAME } from '@/lib/constants';

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
            <ChancesCloud teams={teams} />
            <ChancesProvenance sims={sims} snapshotDate={snapshotDate} />
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
