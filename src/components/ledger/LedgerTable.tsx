import Link from 'next/link';
import ResultBadge from '@/components/ResultBadge';
import { outcomeName, pct, probOf, scoreLine } from '@/lib/format';
import type { LedgerRowView } from '@/lib/queries/ledger';

// Every scored call (ARCHITECTURE.md §10; DESIGN.md §1, §4). A real RSC table
// (zero client JS, per ARCHITECTURE.md §6) of the full record — misses sit beside
// hits and are NEVER hidden, the visible honesty IS the product. Each row carries
// the ✓/✗ verdict, the outcome we leaned towards, the actual score and that
// call's Brier. The whole row links to the match for its full breakdown (incl.
// log loss). Colour is never the only signal: ResultBadge encodes the verdict in
// its icon shape and aria-label, and every number is labelled.

function Row({ c }: { c: LedgerRowView }) {
  const probs = { home: c.prob_home, draw: c.prob_draw, away: c.prob_away };
  const pickName = outcomeName(c.pick, c.home, c.away);
  const pickPct = pct(probOf(probs, c.pick));
  const score =
    c.final_home_goals !== null && c.final_away_goals !== null
      ? scoreLine(c.final_home_goals, c.final_away_goals)
      : '—';

  return (
    <tr className="relative border-b border-line transition-colors last:border-0 hover:bg-surface-2 focus-within:bg-surface-2">
      <td className="px-3 py-3 align-middle">
        <ResultBadge hit={c.hit} />
      </td>
      <th scope="row" className="px-1 py-3 text-left align-middle font-normal">
        <Link
          href={`/match/${c.fixtureId}`}
          aria-label={`${c.home} versus ${c.away}, backed ${pickName} at ${pickPct} — view match details`}
          className="block min-h-11 before:absolute before:inset-0 before:content-['']"
        >
          <span className="block truncate text-sm font-medium text-fg">
            {c.home} <span className="text-fg-dim">v</span> {c.away}
          </span>
          <span className="mt-0.5 block truncate text-xs text-fg-dim">
            Backed {pickName} · <span className="font-mono">{pickPct}</span>
          </span>
        </Link>
      </th>
      <td className="px-3 py-3 text-right align-middle font-mono text-sm font-medium text-fg">
        {score}
      </td>
      <td className="px-3 py-3 text-right align-middle font-mono text-sm text-fg-dim">
        {c.brier_score === null ? '—' : c.brier_score.toFixed(2)}
      </td>
    </tr>
  );
}

export default function LedgerTable({ rows }: { rows: LedgerRowView[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full border-collapse">
        <caption className="sr-only">
          Every scored prediction, newest first: the outcome we leaned towards,
          the actual score and that call&rsquo;s Brier score. Lower Brier is
          better.
        </caption>
        <thead>
          <tr className="border-b border-line text-left text-xs text-fg-dim">
            <th scope="col" className="px-3 py-3 font-medium">
              Result
            </th>
            <th scope="col" className="px-1 py-3 font-medium">
              Match
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              Score
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              Brier
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <Row key={c.id} c={c} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
