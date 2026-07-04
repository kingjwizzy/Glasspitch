import type { Metadata } from 'next';
import Link from 'next/link';
import TeamFlag from '@/components/TeamFlag';
import {
  difficultyOf,
  getBoardData,
  tickerRows,
} from '@/lib/queries/board';
import { formatDateShort, pct } from '@/lib/format';

// /board/ticker — the free Probability Fixture Ticker (ROADMAP.md §2 "paid
// utility arc", free WC edition; ARCHITECTURE.md §5 v3). PUBLIC + ISR, anon
// reads only, zero client JS. World Cup edition: knockout football means most
// teams show a single upcoming fixture — the grid is deliberately built
// per-team × per-fixture so the club-era multi-gameweek version slots into
// the same layout with more columns, not a rewrite.
export const revalidate = 3600;

const TITLE = 'Fixture ticker — upcoming difficulty per team';
const DESCRIPTION =
  'Each team’s upcoming fixtures rated 1–5 for difficulty from our in-house Elo win probabilities. Free, updated nightly.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/board/ticker' },
  openGraph: {
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    url: '/board/ticker',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

// Difficulty is ALWAYS printed as its number + win % — the border tint is a
// secondary cue only (colour never the sole signal, DESIGN.md §2), and the
// scale reuses existing data tokens rather than inventing a palette.
const DIFFICULTY_STYLE: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'border-green/60',
  2: 'border-home/60',
  3: 'border-draw/60',
  4: 'border-away/60',
  5: 'border-miss/60',
};

const DIFFICULTY_LABEL: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'very favourable',
  2: 'favourable',
  3: 'balanced',
  4: 'hard',
  5: 'very hard',
};

function EmptyTicker() {
  return (
    <div className="glass min-h-80 px-4 py-2">
      <ol aria-hidden="true" className="divide-y divide-line">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg-dim">—</p>
            </div>
            <span className="h-11 w-24 rounded-lg border border-line" />
          </li>
        ))}
      </ol>
      <p className="py-3 text-sm text-fg-dim">
        The ticker appears once the nightly snapshot job first runs.
      </p>
    </div>
  );
}

export default async function TickerPage() {
  const { snapshotDate, rows } = await getBoardData();
  const teams = tickerRows(rows);
  const maxCells = teams.reduce((m, t) => Math.max(m, t.cells.length), 0);
  const columns = Math.max(1, maxCells);

  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <Link
          href="/board"
          className="inline-flex min-h-11 items-center text-sm font-medium text-fg-dim transition-colors hover:text-fg"
        >
          ← Gameweek board
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg lg:text-3xl">
          Fixture ticker
        </h1>
        <p className="max-w-[52ch] text-sm leading-relaxed text-fg-dim">
          Every team&rsquo;s upcoming fixtures, rated 1 (very favourable) to 5
          (very hard) from our in-house Elo win probabilities. Knockout
          football shows one match at a time; the club-season version will run
          several gameweeks deep in the same grid.
        </p>
        {snapshotDate && (
          <p className="font-mono text-xs text-fg-dim">
            Snapshot {formatDateShort(`${snapshotDate}T00:00:00Z`)} · refreshed
            nightly
          </p>
        )}
      </header>

      {teams.length === 0 ? (
        <EmptyTicker />
      ) : (
        <div className="glass px-4 py-1">
          {/* Below sm: each team's upcoming fixtures wrap into a vertical
              stack of the same difficulty chips, instead of a fixed-width
              table row — the table's hard-coded min-width otherwise forced
              horizontal scroll with no cue on a 393px phone, clipping
              fixtures off-screen (audit #10/#13/#14). The sm+ column table
              below is unchanged. */}
          <ul className="divide-y divide-line sm:hidden">
            {teams.map((t) => (
              <li key={t.teamId} className="py-3.5">
                <span className="flex items-center gap-2 text-[15px] font-medium text-fg">
                  <TeamFlag name={t.team} />
                  {t.team}
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {t.cells.map((cell) => {
                    const difficulty = difficultyOf(cell.probWin);
                    return (
                      <Link
                        key={cell.fixtureId}
                        href={`/match/${cell.fixtureId}`}
                        aria-label={`${cell.isHome ? 'Versus' : 'At'} ${cell.opponent}, difficulty ${difficulty} of 5 (${DIFFICULTY_LABEL[difficulty]}), win probability ${pct(cell.probWin)}`}
                        className={`inline-flex min-h-11 min-w-28 flex-col justify-center rounded-lg border-l-4 ${DIFFICULTY_STYLE[difficulty]} border border-line bg-surface px-2.5 py-1.5 transition-colors hover:bg-surface-2`}
                      >
                        <span className="truncate text-[13px] text-fg">
                          {cell.isHome ? 'v' : 'at'} {cell.opponent}
                        </span>
                        <span
                          aria-hidden="true"
                          className="mt-0.5 font-mono text-[11px] text-fg-dim"
                        >
                          D{difficulty} · win {pct(cell.probWin)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[26rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-fg-dim">
                  <th scope="col" className="py-2.5 pr-3 font-normal">
                    Team
                  </th>
                  {Array.from({ length: columns }).map((_, i) => (
                    <th key={i} scope="col" className="py-2.5 pr-2 font-normal">
                      {i === 0 ? 'Next match' : `Then +${i}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {teams.map((t) => (
                  <tr key={t.teamId}>
                    <td className="py-3 pr-3 align-top">
                      <span className="flex items-center gap-2 text-[15px] font-medium text-fg">
                        <TeamFlag name={t.team} />
                        {t.team}
                      </span>
                    </td>
                    {Array.from({ length: columns }).map((_, i) => {
                      const cell = t.cells[i];
                      if (!cell) {
                        return (
                          <td key={i} className="py-3 pr-2 align-top">
                            {/* fg-dim, not fg-faint (a11y audit fix): a real
                                "no fixture that far out" data reading, not
                                incidental — fg-faint fails AA below 18px. */}
                            <span className="font-mono text-xs text-fg-dim">—</span>
                          </td>
                        );
                      }
                      const difficulty = difficultyOf(cell.probWin);
                      return (
                        <td key={cell.fixtureId} className="py-3 pr-2 align-top">
                          <Link
                            href={`/match/${cell.fixtureId}`}
                            aria-label={`${cell.isHome ? 'Versus' : 'At'} ${cell.opponent}, difficulty ${difficulty} of 5 (${DIFFICULTY_LABEL[difficulty]}), win probability ${pct(cell.probWin)}`}
                            className={`inline-flex min-h-11 min-w-28 flex-col justify-center rounded-lg border-l-4 ${DIFFICULTY_STYLE[difficulty]} border border-line bg-surface px-2.5 py-1.5 transition-colors hover:bg-surface-2`}
                          >
                            <span className="truncate text-[13px] text-fg">
                              {cell.isHome ? 'v' : 'at'} {cell.opponent}
                            </span>
                            <span
                              aria-hidden="true"
                              className="mt-0.5 font-mono text-[11px] text-fg-dim"
                            >
                              D{difficulty} · win {pct(cell.probWin)}
                            </span>
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
        Difficulty comes from our own nightly Elo win probabilities — context,
        not the locked match calls in{' '}
        <Link href="/ledger" className="text-green underline hover:text-green-bright">
          the public record
        </Link>
        , and not betting advice.
      </p>
    </article>
  );
}
