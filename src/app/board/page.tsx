import type { Metadata } from 'next';
import Link from 'next/link';
import SectionHeader from '@/components/SectionHeader';
import TeamFlag from '@/components/TeamFlag';
import EmptyStateSpot from '@/components/art/EmptyStateSpot';
import {
  boardByTeam,
  boardMovers,
  getBoardData,
  type BoardSnapshotRow,
} from '@/lib/queries/board';
import { formatDateShort, pct } from '@/lib/format';

// /board — the free Gameweek Board (ROADMAP.md §2 "free daily habit";
// ARCHITECTURE.md §5 v3). PUBLIC + ISR: anon reads only, no cookies, no
// client JS — refreshed hourly, though the underlying snapshot job runs
// nightly. Data is IN-HOUSE Elo-derived context (labelled as such below) —
// deliberately distinct from the locked third-party match calls that make up
// the scored ledger.
export const revalidate = 3600;

const TITLE = 'Gameweek board — team probabilities, updated nightly';
const DESCRIPTION =
  'Every team’s next-match win probability, clean-sheet chance and expected goals from our in-house Elo ratings — with day-over-day movers. Free, updated nightly.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/board' },
  openGraph: { type: 'website', title: TITLE, description: DESCRIPTION, url: '/board' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

/** Signed day-over-day move in percentage points: "▲ 2.1" / "▼ 1.4". The
 *  arrow + sign carry the direction (colour is never the sole signal). */
function MoveFigure({ delta }: { delta: number | null }) {
  if (delta === null) {
    return (
      <span aria-label="No previous snapshot to compare" className="font-mono text-fg-faint">
        —
      </span>
    );
  }
  const pp = Math.abs(delta * 100).toFixed(1);
  const up = delta > 0;
  if (Math.abs(delta) < 0.0005) {
    return <span className="font-mono text-fg-dim">0.0</span>;
  }
  return (
    <span
      aria-label={`${up ? 'Up' : 'Down'} ${pp} percentage points since yesterday`}
      className={`font-mono ${up ? 'text-green' : 'text-miss-bright'}`}
    >
      {up ? '▲' : '▼'} {pp}
    </span>
  );
}

function EmptyBoard() {
  return (
    <div className="glass min-h-80 px-4 py-2">
      <ol aria-hidden="true" className="divide-y divide-line">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg-dim">—</p>
              <p className="text-xs text-fg-faint">—</p>
            </div>
            <span className="shrink-0 font-mono text-sm text-fg-dim">—</span>
            <span className="shrink-0 font-mono text-sm text-fg-dim">—</span>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-4 py-3">
        {/* Spot illustration (W6 visual pack) — decorative. */}
        <EmptyStateSpot variant="board" className="h-12 w-auto shrink-0" />
        <p className="text-sm text-fg-dim">
          The board appears once the nightly snapshot job first runs — no
          numbers are invented in the meantime.
        </p>
      </div>
    </div>
  );
}

export default async function BoardPage() {
  const { snapshotDate, rows } = await getBoardData();
  const teams = boardByTeam(rows);
  const movers = boardMovers(rows);

  return (
    <article className="space-y-8">
      <header className="floodlight space-y-2 pt-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg lg:text-3xl">
          Gameweek board
        </h1>
        <p className="max-w-[52ch] text-sm leading-relaxed text-fg-dim">
          Every team&rsquo;s next match, as our in-house Elo ratings see it:
          win probability, clean-sheet chance, expected goals — and who moved
          overnight. Context numbers, refreshed nightly; the locked match
          calls live on each{' '}
          <Link href="/matches" className="text-green underline hover:text-green-bright">
            match page
          </Link>{' '}
          and in the{' '}
          <Link href="/ledger" className="text-green underline hover:text-green-bright">
            ledger
          </Link>
          .
        </p>
        {snapshotDate && (
          <p className="font-mono text-xs text-fg-dim">
            Snapshot {formatDateShort(`${snapshotDate}T00:00:00Z`)} · refreshed
            nightly
          </p>
        )}
      </header>

      {teams.length === 0 ? (
        <EmptyBoard />
      ) : (
        <>
          {movers.length > 0 && (
            <section aria-labelledby="movers-heading" className="reveal">
              <SectionHeader
                id="movers-heading"
                title="Overnight movers"
                description="Biggest day-over-day change in win probability."
              />
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {movers.map((m) => (
                  <li key={`${m.teamId}-${m.fixtureId}`} className="glass px-4 py-3">
                    <p className="flex items-center gap-2 text-[15px] font-medium text-fg">
                      <TeamFlag name={m.team} />
                      {m.team}
                    </p>
                    <p className="mt-1 flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-fg-dim">
                        now {pct(m.probWin)} to beat {m.opponent}
                      </span>
                      <MoveFigure delta={m.delta} />
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="board-heading" className="reveal">
            <SectionHeader
              id="board-heading"
              title="The board"
              description="One row per team — its next fixture, sorted by win probability."
              href="/board/ticker"
              linkLabel="Fixture ticker"
            />
            <div className="glass overflow-x-auto px-4 py-1">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-fg-dim">
                    <th scope="col" className="py-2.5 pr-3 font-normal">
                      Team
                    </th>
                    <th scope="col" className="py-2.5 pr-3 font-normal">
                      Next
                    </th>
                    <th scope="col" className="py-2.5 pr-3 text-right font-normal">
                      Win
                    </th>
                    <th scope="col" className="py-2.5 pr-3 text-right font-normal">
                      Clean sheet
                    </th>
                    <th scope="col" className="py-2.5 pr-3 text-right font-normal">
                      xG for / against
                    </th>
                    <th scope="col" className="py-2.5 text-right font-normal">
                      Day move
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {teams.map((t: BoardSnapshotRow) => (
                    <tr key={t.teamId}>
                      <td className="py-3 pr-3">
                        <span className="flex items-center gap-2 text-[15px] font-medium text-fg">
                          <TeamFlag name={t.team} />
                          {t.team}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-fg-dim">
                        <Link
                          href={`/match/${t.fixtureId}`}
                          className="transition-colors hover:text-fg"
                        >
                          {t.isHome ? 'v' : 'at'} {t.opponent}
                        </Link>
                      </td>
                      <td className="py-3 pr-3 text-right font-mono font-medium text-fg">
                        {pct(t.probWin)}
                      </td>
                      <td className="py-3 pr-3 text-right font-mono text-fg-dim">
                        {pct(t.probCleanSheet)}
                      </td>
                      <td className="py-3 pr-3 text-right font-mono text-fg-dim">
                        {t.xgFor.toFixed(1)} / {t.xgAgainst.toFixed(1)}
                      </td>
                      <td className="py-3 text-right">
                        <MoveFigure delta={t.deltaProbWin} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
        These are estimates from our own Elo ratings — a deliberately simple
        in-house model, shown for context and refreshed nightly. They are not
        the locked, scored match calls that make up{' '}
        <Link href="/ledger" className="text-green underline hover:text-green-bright">
          the public record
        </Link>
        , and like everything here they are analysis, not betting advice.
      </p>
    </article>
  );
}
