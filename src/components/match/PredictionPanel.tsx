import ProbabilityBar from '@/components/ProbabilityBar';
import LockStatusLine from '@/components/LockStatusLine';
import AuditLine from '@/components/match/AuditLine';
import { LockOpenIcon } from '@/components/icons';
import { scoreLine } from '@/lib/format';
import { THIRD_PARTY_LABEL } from '@/lib/constants';
import type { MatchPrediction } from '@/lib/queries/match';
import type { FixtureStatus } from '@/lib/types';

// The third-party prediction — "our call" (DESIGN.md §4; ARCHITECTURE.md §9).
// Honest about state in every branch: a live/scored call is immutably locked; an
// upcoming one locks at kickoff; a prediction that missed the kickoff lock is
// voided and NEVER shown as a call (§10); and when nothing is published we say so
// plainly rather than faking numbers. The third-party label is shown verbatim.

export interface PredictionPanelProps {
  prediction: MatchPrediction | null;
  predictionVoided: boolean;
  status: FixtureStatus;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <p className="text-sm text-fg-dim">{children}</p>
    </div>
  );
}

export default function PredictionPanel({
  prediction,
  predictionVoided,
  status,
}: PredictionPanelProps) {
  if (!prediction) {
    if (predictionVoided) {
      return (
        <div className="rounded-2xl border border-line bg-surface p-5">
          <p className="flex items-start gap-2 text-sm text-fg-dim">
            <LockOpenIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              A prediction for this match wasn&rsquo;t locked before kickoff, so
              it&rsquo;s voided and excluded from our scored record — integrity
              over coverage. We&rsquo;d rather show a gap than a call we
              can&rsquo;t stand behind.
            </span>
          </p>
        </div>
      );
    }
    return (
      <Note>
        {status === 'finished'
          ? 'We didn’t publish a prediction for this match, so it isn’t part of our record.'
          : 'Probabilities for this match haven’t been published yet — they appear once the model has run.'}
      </Note>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-fg">Win probability</span>
        <span className="text-xs text-fg-dim">
          Predicted{' '}
          <span className="font-mono font-medium text-fg">
            {scoreLine(prediction.predicted_home_goals, prediction.predicted_away_goals)}
          </span>
        </span>
      </div>

      <ProbabilityBar
        home={prediction.prob_home}
        draw={prediction.prob_draw}
        away={prediction.prob_away}
      />

      <LockStatusLine status={prediction.status} className="mt-4" />
      <AuditLine prediction={prediction} />

      <p className="mt-3 border-t border-line pt-3 text-xs text-fg-dim">
        {THIRD_PARTY_LABEL}
      </p>
    </div>
  );
}
