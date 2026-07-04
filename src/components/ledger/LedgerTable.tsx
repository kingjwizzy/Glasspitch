import Link from 'next/link';
import ResultBadge from '@/components/ResultBadge';
import { formatDateShort, OUR_CALL_LABEL, outcomeName, pct, probOf, scoreLine } from '@/lib/format';
import type { LedgerRowView } from '@/lib/queries/ledger';

// Every scored call (ARCHITECTURE.md §10; DESIGN.md §1, §4). A real RSC table
// (zero client JS, per ARCHITECTURE.md §6) of the full record — misses sit beside
// hits and are NEVER hidden, the visible honesty IS the product. Each row carries
// the ✓/✗ verdict, the outcome we leaned towards, the kickoff date, the actual
// score and that call's Brier — the date column means every row in "the record"
// is independently dateable, not just asserted (§7, §10). The whole row links to
// the match for its full breakdown (incl. log loss, the full audit trail).
// Colour is never the only signal: ResultBadge encodes the verdict in its icon
// shape and aria-label, and every number is labelled.

// Every column gutter is `px-4` (RAMBO wave 3 #11b — CalibrationTable's own
// uniform `px-4` is the reference), except Match, which flexes via `min-w-0`
// so the fixed-width Result/Date/Score/Brier columns keep a razor-straight
// right edge instead of the old mixed px-3/px-1 "spreadsheet" gutters.
const GUTTER = 'px-4';

// ── Brier magnitude cue (RAMBO wave 3 #11a) — a thin, right-anchored micro-bar
// under the Brier figure. The NUMBER stays the primary signal (unchanged,
// still the first thing read); the bar is a purely decorative, aria-hidden
// supplementary cue, seated in a recessed `bg-surface-2` track (same
// language as ProbabilityBar's `.prob-track`). Colour is a plain two-stop
// `--fg-dim` → `--miss` ramp — never a rainbow, never the H/D/A blue/amber —
// so it reads as "how far off", not a new categorical signal.
const BRIER_WORST = 2; // the scale's own ceiling (LedgerTable/ledger page caption: "0 to 2").
const FG_DIM_RGB: [number, number, number] = [0x9d, 0xa8, 0xa2]; // --fg-dim
const MISS_RGB: [number, number, number] = [0xf2, 0x55, 0x5a]; // --miss

/** 0 (best) .. 1 (worst) position on the ramp, clamped to the scale's ceiling. */
function brierMagnitude(brier: number): number {
  return Math.max(0, Math.min(1, brier / BRIER_WORST));
}

/** A minimum-visible sliver even for a near-perfect score, so the track never
 *  reads as accidentally empty/broken. */
function brierBarWidthPct(brier: number): number {
  return Math.max(6, Math.round(brierMagnitude(brier) * 100));
}

/** Linear `--fg-dim` → `--miss` interpolation, computed once per row at
 *  render time (no client JS, no CSS `color-mix` dependency). */
function brierBarColor(brier: number): string {
  const t = brierMagnitude(brier);
  const [r, g, b] = FG_DIM_RGB.map((from, i) => Math.round(from + (MISS_RGB[i] - from) * t));
  return `rgb(${r} ${g} ${b})`;
}

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
      <td className={`${GUTTER} py-3 align-middle`}>
        <ResultBadge hit={c.hit} />
      </td>
      <th scope="row" className={`${GUTTER} min-w-0 py-3 text-left align-middle font-normal`}>
        <Link
          href={`/match/${c.fixtureId}`}
          aria-label={`${c.home} versus ${c.away}, our call was ${pickName} (${pickPct}) — view match details`}
          className="block min-h-11 before:absolute before:inset-0 before:content-['']"
        >
          <span className="block truncate text-sm font-medium text-fg">
            {c.home} <span className="text-fg-dim">v</span> {c.away}
          </span>
          <span className="mt-0.5 block truncate text-xs text-fg-dim">
            {OUR_CALL_LABEL} {pickName} (<span className="font-mono">{pickPct}</span>)
          </span>
        </Link>
      </th>
      <td className={`${GUTTER} whitespace-nowrap py-3 text-right align-middle font-mono text-xs text-fg-dim`}>
        <time dateTime={c.kickoffUtc}>{formatDateShort(c.kickoffUtc)}</time>
      </td>
      <td className={`${GUTTER} py-3 text-right align-middle font-mono text-sm font-medium text-fg`}>
        {score}
      </td>
      <td className={`${GUTTER} py-3 text-right align-middle`}>
        <span className="inline-flex flex-col items-end gap-1">
          <span className="font-mono text-sm text-fg-dim">
            {c.brier_score === null ? '—' : c.brier_score.toFixed(2)}
          </span>
          {c.brier_score !== null && (
            <span
              aria-hidden="true"
              className="h-[3px] w-8 overflow-hidden rounded-full bg-surface-2"
            >
              <span
                className="ml-auto block h-full rounded-full"
                style={{
                  width: `${brierBarWidthPct(c.brier_score)}%`,
                  backgroundColor: brierBarColor(c.brier_score),
                }}
              />
            </span>
          )}
        </span>
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
          the kickoff date, the actual score and that call&rsquo;s Brier score.
          Lower Brier is better.
        </caption>
        <thead>
          <tr className="border-b border-line text-left text-xs text-fg-dim">
            <th scope="col" className={`${GUTTER} py-3 font-medium`}>
              Result
            </th>
            <th scope="col" className={`${GUTTER} min-w-0 py-3 font-medium`}>
              Match
            </th>
            <th scope="col" className={`${GUTTER} py-3 text-right font-medium`}>
              Date
            </th>
            <th scope="col" className={`${GUTTER} py-3 text-right font-medium`}>
              Score
            </th>
            <th scope="col" className={`${GUTTER} py-3 text-right font-medium`}>
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
