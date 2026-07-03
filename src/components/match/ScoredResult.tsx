import Link from 'next/link';
import ResultBadge from '@/components/ResultBadge';
import { ArrowRightIcon } from '@/components/icons';
import { OUR_CALL_LABEL, outcomeName, pct, predictedPick, probOf, scoreLine } from '@/lib/format';
import type { MatchPrediction } from '@/lib/queries/match';
import type { MatchResult } from '@/lib/types';

// How the call landed — the transparency moat at the single-match level
// (DESIGN.md §1; ARCHITECTURE.md §10). Shows the actual result against our
// prediction, the ✓/✗ verdict, and the Brier + log loss for THIS call. Misses
// are shown as plainly as hits — that honesty is the whole product. Rendered
// only when the prediction is scored (a real, locked, post-match record).

export interface ScoredResultProps {
  prediction: MatchPrediction;
  home: string;
  away: string;
  /** Final score from the fixture (the source of truth for the match). */
  finalHome: number;
  finalAway: number;
}

function outcomeDescription(result: MatchResult, home: string, away: string): string {
  if (result === 'home') return `a home win for ${home}`;
  if (result === 'away') return `an away win for ${away}`;
  return 'a draw';
}

function Metric({
  label,
  value,
  caption,
}: {
  label: string;
  value: number;
  caption: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4">
      <p className="font-mono text-2xl font-medium text-fg">{value.toFixed(2)}</p>
      <p className="mt-1 text-sm font-medium text-fg">{label}</p>
      <p className="mt-1 text-xs text-fg-dim">{caption}</p>
    </div>
  );
}

export default function ScoredResult({
  prediction,
  home,
  away,
  finalHome,
  finalAway,
}: ScoredResultProps) {
  const probs = {
    home: prediction.prob_home,
    draw: prediction.prob_draw,
    away: prediction.prob_away,
  };
  const result = prediction.result as MatchResult;
  const pick = predictedPick(probs);
  const hit = pick === result;

  const pickName = outcomeName(pick, home, away);
  const pickPct = pct(probOf(probs, pick));
  const actualProb = probOf(probs, result);
  const actual = scoreLine(finalHome, finalAway);
  const predicted = scoreLine(
    prediction.predicted_home_goals,
    prediction.predicted_away_goals,
  );

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      {/* verdict */}
      <div className="flex items-start gap-3">
        <ResultBadge hit={hit} size="lg" />
        <div className="min-w-0">
          <p className="text-base font-semibold text-fg">
            {hit ? 'Correct call' : 'Missed call'}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-fg-dim">
            {OUR_CALL_LABEL} {pickName} (<span className="font-mono">{pickPct}</span>).
            It finished <span className="font-mono">{actual}</span> —{' '}
            {outcomeDescription(result, home, away)}.
          </p>
        </div>
      </div>

      {/* predicted vs actual */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-line bg-surface-2 p-4 text-center">
          <p className="text-xs text-fg-dim">Our prediction</p>
          <p className="mt-1 font-mono text-2xl font-medium text-fg">{predicted}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface-2 p-4 text-center">
          <p className="text-xs text-fg-dim">Actual result</p>
          <p className="mt-1 font-mono text-2xl font-medium text-fg">{actual}</p>
        </div>
      </div>

      {/* the honest edge case: we gave what happened almost no chance */}
      {actualProb < 0.05 && (
        <p className="mt-4 text-sm leading-relaxed text-fg-dim">
          We gave this outcome almost no chance (
          <span className="font-mono">{pct(actualProb)}</span>) — a miss the
          ledger counts in full.
        </p>
      )}

      {/* the scores for this call */}
      {prediction.brier_score !== null && prediction.log_loss !== null && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Metric
              label="Brier score"
              value={prediction.brier_score}
              caption="0 best, 2 worst — lower is better."
            />
            <Metric
              label="Log loss"
              value={prediction.log_loss}
              caption="Punishes confident misses — lower is better."
            />
          </div>
          <Link
            href="/ledger"
            className="mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-green transition-colors hover:text-green-bright"
          >
            How we score every call
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </>
      )}
    </div>
  );
}
