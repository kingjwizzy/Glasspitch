import Link from 'next/link';
import ResultBadge from '@/components/ResultBadge';
import ProbabilityBar from '@/components/ProbabilityBar';
import {
  favoured,
  formatKickoff,
  outcomeName,
  pct,
  probOf,
  RESULT_LABEL,
  scoreLine,
} from '@/lib/format';
import type { MatchResult } from '@/lib/types';
import type { FixtureRowView } from '@/lib/queries/fixtures';

// One fixture row — the shared building block for team and league fixture lists
// (DESIGN.md §4: one row = one match, full-row tap target). Branches on whether
// the fixture is finished (shows the ✓/✗ badge and scoreline) or upcoming
// (shows the probability bar and kickoff time).
//
// Colour is never the only signal: chips show letters (H/D/A), badges show
// icons + aria-labels, the probability bar shows % labels (DESIGN.md §2 hard rule).

const PICK: Record<MatchResult, { letter: string; chip: string }> = {
  home: { letter: 'H', chip: 'bg-home' },
  draw: { letter: 'D', chip: 'bg-draw' },
  away: { letter: 'A', chip: 'bg-away' },
};

export default function FixtureRow({ fixture: f }: { fixture: FixtureRowView }) {
  const pred = f.prediction;
  // Pre-compute fav once so both branches can reference it without repeating the
  // argmax call; null when no prediction.
  const fav = pred
    ? favoured({ home: pred.prob_home, draw: pred.prob_draw, away: pred.prob_away })
    : null;

  // ── FINISHED ──────────────────────────────────────────────────────────────
  if (f.status === 'finished') {
    return (
      <li>
        <Link
          href={`/match/${f.id}`}
          className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface-2"
        >
          {/* Badge: shown only when we have a prediction whose hit is resolved.
              TypeScript narrows f.hit to boolean in the true branch. */}
          {pred !== null && f.hit !== null ? (
            <ResultBadge hit={f.hit} />
          ) : null}

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">
              {f.home} <span className="text-fg-dim">v</span> {f.away}
            </p>
            {/* "We backed …" subtext — only shown when a prediction exists. */}
            {pred !== null && f.pick !== null && (
              <p className="mt-0.5 truncate text-xs text-fg-dim">
                We backed {outcomeName(f.pick, f.home, f.away)} (
                <span className="font-mono">
                  {pct(
                    probOf(
                      {
                        home: pred.prob_home,
                        draw: pred.prob_draw,
                        away: pred.prob_away,
                      },
                      f.pick,
                    ),
                  )}
                </span>
                )
              </p>
            )}
          </div>

          <div className="shrink-0 text-right">
            {f.final_home_goals !== null && f.final_away_goals !== null && (
              <p className="font-mono text-sm font-medium text-fg">
                {scoreLine(f.final_home_goals, f.final_away_goals)}
              </p>
            )}
            {f.actualResult !== null && (
              <p className="mt-0.5 text-xs text-fg-dim">
                {RESULT_LABEL[f.actualResult]}
              </p>
            )}
          </div>
        </Link>
      </li>
    );
  }

  // ── UPCOMING (scheduled / live / postponed) ────────────────────────────────
  return (
    <li>
      <Link
        href={`/match/${f.id}`}
        className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface-2"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-fg">
            {f.home} <span className="text-fg-dim">v</span> {f.away}
          </p>
          <p className="mt-0.5 font-mono text-xs text-fg-dim">
            {formatKickoff(f.kickoff_utc)}
          </p>
        </div>

        {pred !== null && fav !== null ? (
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {/* Chip + % — aria-hidden because ProbabilityBar carries the full
                accessible label for the predicted probabilities. */}
            <span className="flex items-center gap-1.5" aria-hidden="true">
              <span
                className={`${PICK[fav.key].chip} inline-flex h-4 w-4 items-center justify-center rounded-[3px] text-[10px] font-semibold text-bg`}
              >
                {PICK[fav.key].letter}
              </span>
              <span className="font-mono text-sm font-medium text-fg">
                {pct(fav.prob)}
              </span>
            </span>
            <ProbabilityBar
              compact
              home={pred.prob_home}
              draw={pred.prob_draw}
              away={pred.prob_away}
              className="w-24"
            />
          </div>
        ) : (
          <span className="shrink-0 text-xs text-fg-dim">Call pending</span>
        )}
      </Link>
    </li>
  );
}
