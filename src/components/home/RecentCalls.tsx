import Link from 'next/link';
import ResultBadge from '@/components/ResultBadge';
import ProbabilityBar from '@/components/ProbabilityBar';
import LedgerPipeline from '@/components/home/LedgerPipeline';
import {
  formatDateTimeShort,
  outcomeName,
  pct,
  probOf,
  receiptRead,
  scoreLine,
} from '@/lib/format';
import type { RecentCallView } from '@/lib/queries/homepage';

// "How recent calls landed" — the signature section (DESIGN.md §1, §4), styled
// as RECEIPTS (W4 spec §4): each scored match welds the claim (the locked
// H/D/A bar and the probability we assigned) to the outcome (final score +
// equal-weight ✓/✗ stamp), with a plain-prose read and a provenance microline.
// Misses sit beside hits at identical size and weight — never hidden.

function ReceiptRow({ c }: { c: RecentCallView }) {
  const pickName = outcomeName(c.pick, c.home, c.away);
  const pickProb = probOf(
    { home: c.prob_home, draw: c.prob_draw, away: c.prob_away },
    c.pick,
  );
  // Typographic winner emphasis — the no-crest answer (W4 spec §2): the actual
  // winner stays at full weight, the loser dims; a draw keeps both level.
  const homeWon = c.result === 'home';
  const awayWon = c.result === 'away';
  const isDraw = c.result === 'draw';

  return (
    <li>
      <Link
        href={`/match/${c.fixtureId}`}
        className="glass card-interactive block p-4"
      >
        <div className="flex items-start justify-between gap-4">
          {/* Claim side: teams + the locked call. */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px]">
              <span
                className={
                  homeWon || isDraw ? 'font-medium text-fg' : 'text-fg-dim'
                }
              >
                {c.home}
              </span>{' '}
              <span className="text-fg-dim">v</span>{' '}
              <span
                className={
                  awayWon || isDraw ? 'font-medium text-fg' : 'text-fg-dim'
                }
              >
                {c.away}
              </span>
            </p>
            <p className="mt-1.5 text-[13px] text-fg-dim">
              we said {pickName}{' '}
              <span className="font-mono text-fg">{pct(pickProb)}</span>
            </p>
            <ProbabilityBar
              variant="row"
              home={c.prob_home}
              draw={c.prob_draw}
              away={c.prob_away}
              className="mt-2 max-w-56"
            />
          </div>

          {/* Stamp cell: outcome welded to the claim — identical size and
              weight for hits and misses. */}
          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className="flex items-center gap-2.5">
              {c.final_home_goals !== null && c.final_away_goals !== null && (
                <span className="font-mono text-xl font-medium text-fg">
                  {scoreLine(c.final_home_goals, c.final_away_goals)}
                </span>
              )}
              <ResultBadge hit={c.hit} />
            </div>
            <span className="text-[11px] text-fg-dim">Full time</span>
          </div>
        </div>

        {/* The plain-prose read — one honest line per call. */}
        <p className="mt-3 text-[13px] leading-relaxed text-fg-dim">
          {receiptRead(pickProb, c.hit)}
        </p>
        <p className="mt-1.5 font-mono text-[11px] leading-4 text-fg-dim">
          published {formatDateTimeShort(c.published_at)} · locked at kickoff
        </p>
      </Link>
    </li>
  );
}

export default function RecentCalls({ calls }: { calls: RecentCallView[] }) {
  if (calls.length === 0) {
    return (
      <div className="glass p-5">
        <LedgerPipeline />
        <p className="mt-3 text-sm text-fg-dim">
          The record opens after the first final whistle — misses included.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {calls.map((c) => (
        <ReceiptRow key={c.id} c={c} />
      ))}
    </ul>
  );
}
