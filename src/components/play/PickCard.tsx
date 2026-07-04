'use client';

// One fixture's pick card on /play (ARCHITECTURE.md §5 v3 game-picks
// amendment; DESIGN.md §6 "Beat the model"). A deliberate client island on an
// authed, dynamic segment — the public/cached surface stays zero-client-JS.
//
// Thumb-first: three big quick-pick buttons set an honest starting spread,
// an optional fine-tune reveals three sliders, and the three numbers ALWAYS
// total 100 (moving one rebalances the other two proportionally — no error
// state to get into). The write itself happens in savePickAction through the
// visitor's own cookie-bound, RLS-scoped client; the DB's kickoff trigger is
// the real lock, and a rejected write renders as honest copy here.
//
// Anti-anchoring: the model's call renders ONLY once the visitor has a saved
// pick — never beside an uncommitted slider.

import { useActionState, useState } from 'react';
import ProbabilityBar from '@/components/ProbabilityBar';
import TeamFlag from '@/components/TeamFlag';
import { LockClosedIcon } from '@/components/icons';
import { scoreLine } from '@/lib/format';
import { savePickAction, type PickFormState } from '@/app/play/actions';

// Lives here, not in actions.ts: a "use server" module may only export async
// functions at runtime (build-enforced once a server component imports it).
const INITIAL_PICK_STATE: PickFormState = { status: 'idle', message: '' };

export interface PickCardModel {
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  predicted_home_goals: number;
  predicted_away_goals: number;
}

export interface PickCardProps {
  fixtureId: number;
  home: string;
  away: string;
  league: string;
  /** Preformatted server-side ("Sat 5 Jul, 18:00 UTC") — deterministic UTC,
   *  so SSR and hydration can never disagree (no client tz maths). */
  kickoffLabel: string;
  /** Whole percentages [home, draw, away] of an already-saved pick, or null. */
  initialPick: [number, number, number] | null;
  model: PickCardModel | null;
}

type Trio = [number, number, number];

const QUICK_PRESETS: { key: 'home' | 'draw' | 'away'; values: Trio }[] = [
  { key: 'home', values: [58, 24, 18] },
  { key: 'draw', values: [26, 48, 26] },
  { key: 'away', values: [18, 24, 58] },
];

// The H/D/A chip stays a secondary marker beside the team name (W6 owner UX
// decision: "home/away is confusing at a neutral-venue World Cup" — the
// outcome text itself is always the actual team name + "win", or "Draw").
const OUTCOME_CHIP: Record<'home' | 'draw' | 'away', { letter: string; chip: string }> = {
  home: { letter: 'H', chip: 'bg-home' },
  draw: { letter: 'D', chip: 'bg-draw' },
  away: { letter: 'A', chip: 'bg-away' },
};

/** Set slot `idx` to `v` and rebalance the other two proportionally so the
 *  trio always totals exactly 100 (integer arithmetic, no drift). */
function rebalance(values: Trio, idx: number, v: number): Trio {
  const next = Math.max(0, Math.min(100, Math.round(v)));
  const rest = 100 - next;
  const others = ([0, 1, 2] as const).filter((i) => i !== idx);
  const prevSum = values[others[0]] + values[others[1]];
  const first =
    prevSum <= 0
      ? Math.round(rest / 2)
      : Math.max(0, Math.min(rest, Math.round((rest * values[others[0]]) / prevSum)));
  const out: Trio = [...values] as Trio;
  out[idx] = next;
  out[others[0]] = first;
  out[others[1]] = rest - first;
  return out;
}

const SLIDERS = [
  { idx: 0, name: 'home', letter: 'H', accent: 'accent-home' },
  { idx: 1, name: 'draw', letter: 'D', accent: 'accent-draw' },
  { idx: 2, name: 'away', letter: 'A', accent: 'accent-away' },
] as const;

export default function PickCard({
  fixtureId,
  home,
  away,
  league,
  kickoffLabel,
  initialPick,
  model,
}: PickCardProps) {
  const [values, setValues] = useState<Trio>(initialPick ?? [34, 33, 33]);
  const [touched, setTouched] = useState(initialPick !== null);
  const [state, formAction, isPending] = useActionState(
    savePickAction,
    INITIAL_PICK_STATE,
  );

  const committed = initialPick !== null || state.status === 'saved';
  const outcomeLabel = (key: 'home' | 'draw' | 'away') =>
    key === 'home' ? `${home} win` : key === 'away' ? `${away} win` : 'Draw';

  // Conviction (kick plan #2 — a money-free "stake"): read the biggest leg so a
  // bold, concentrated call reads differently from a hedge. Derived purely from
  // the visitor's OWN numbers, so it never leaks/anchors on the model's call.
  const topIdx =
    values[0] >= values[1] && values[0] >= values[2] ? 0 : values[1] >= values[2] ? 1 : 2;
  const maxLeg = values[topIdx];
  const topKey = (['home', 'draw', 'away'] as const)[topIdx];
  const topPhrase = topKey === 'home' ? home : topKey === 'away' ? away : 'a draw';
  const conviction = maxLeg >= 80 ? 'bold' : maxLeg >= 58 ? 'strong' : 'lean';
  const convictionLabel =
    conviction === 'bold' ? 'a bold call' : conviction === 'strong' ? 'a strong call' : 'a lean';
  const convictionTone =
    conviction === 'bold'
      ? 'text-away'
      : conviction === 'strong'
        ? 'text-green-bright'
        : 'text-fg-dim';
  // Honest trade-off, stated plainly — never a nudge to go bigger (DESIGN.md §6).
  const tradeoff =
    conviction === 'bold'
      ? "Land it and you'll likely out-call the model — miss it and it stings on your record."
      : conviction === 'strong'
        ? 'More upside here than playing it safe — and more to lose.'
        : 'A cautious call — less at stake either way.';

  return (
    <li className="glass px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 font-display text-base font-semibold tracking-tight text-fg">
          <span className="mr-1.5 inline-flex items-center gap-1.5 align-baseline">
            <TeamFlag name={home} />
            {home}
          </span>
          <span className="font-normal text-fg-dim">v</span>
          <span className="ml-1.5 inline-flex items-center gap-1.5 align-baseline">
            <TeamFlag name={away} />
            {away}
          </span>
        </h3>
      </div>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-fg-dim">
        <LockClosedIcon className="h-3 w-3" />
        {league ? `${league} · ` : ''}locks at kickoff — {kickoffLabel}
      </p>

      {/* Quick pick: an honest starting spread, not a certainty. */}
      <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="Quick pick">
        {QUICK_PRESETS.map((preset, i) => {
          const active =
            touched &&
            values[i] > values[(i + 1) % 3] &&
            values[i] > values[(i + 2) % 3];
          return (
            <button
              key={preset.key}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setValues(preset.values);
                setTouched(true);
              }}
              className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-sm transition-colors ${
                active
                  ? 'border-green bg-surface-2 font-medium text-fg'
                  : 'border-line bg-surface text-fg-dim hover:text-fg'
              }`}
            >
              <span
                aria-hidden="true"
                className={`${OUTCOME_CHIP[preset.key].chip} inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-[10px] font-semibold text-bg`}
              >
                {OUTCOME_CHIP[preset.key].letter}
              </span>
              <span className="min-w-0">{outcomeLabel(preset.key)}</span>
            </button>
          );
        })}
      </div>

      {/* The pick as numbers — always printed, always totalling 100. */}
      {touched && (
        <div className="mt-3">
          <ProbabilityBar
            variant="row"
            home={values[0] / 100}
            draw={values[1] / 100}
            away={values[2] / 100}
          />
        </div>
      )}

      {/* Conviction read — turns the spread into a felt call (kick plan #2). */}
      {touched && (
        <p className="mt-2 text-sm text-fg-dim">
          That&rsquo;s <span className={`font-semibold ${convictionTone}`}>{convictionLabel}</span>{' '}
          on <span className="text-fg">{topPhrase}</span>.
          {!committed && <span className="mt-0.5 block text-xs text-fg-dim">{tradeoff}</span>}
        </p>
      )}

      <details className="mt-2">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-green transition-colors hover:text-green-bright">
          Fine-tune the numbers
        </summary>
        <div className="mt-1 space-y-2.5">
          {SLIDERS.map((s) => (
            <div key={s.name} className="flex items-center gap-3">
              <span className="flex w-20 shrink-0 items-center gap-1.5 overflow-hidden text-xs text-fg-dim sm:w-28">
                <span
                  aria-hidden="true"
                  className={`${OUTCOME_CHIP[s.name].chip} inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-[10px] font-semibold text-bg`}
                >
                  {s.letter}
                </span>
                <span className="truncate">{outcomeLabel(s.name)}</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={values[s.idx]}
                aria-label={`${outcomeLabel(s.name)} probability, percent`}
                onChange={(e) => {
                  setValues((prev) => rebalance(prev, s.idx, Number(e.target.value)));
                  setTouched(true);
                }}
                className={`h-11 min-w-0 flex-1 cursor-pointer ${s.accent}`}
              />
              <span className="w-12 shrink-0 text-right font-mono text-sm text-fg">
                {values[s.idx]}%
              </span>
            </div>
          ))}
          {/* fg-dim, not fg-faint (a11y audit fix): instructional slider copy,
              not an incidental hint — fg-faint fails WCAG AA below 18px. */}
          <p className="text-xs text-fg-dim">
            Move one and the other two rebalance — the three always total 100%.
          </p>
        </div>
      </details>

      <form action={formAction} className="mt-3">
        <input type="hidden" name="fixtureId" value={fixtureId} />
        <input type="hidden" name="home" value={values[0]} />
        <input type="hidden" name="draw" value={values[1]} />
        <input type="hidden" name="away" value={values[2]} />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!touched || isPending}
            className="inline-flex min-h-11 items-center rounded-lg bg-green px-4 text-sm font-medium text-bg transition-colors hover:bg-green-bright disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? 'Saving…' : committed ? 'Update your call' : 'Save your call'}
          </button>
          <p role="status" aria-live="polite" className="min-w-0 text-xs leading-snug">
            {state.status === 'error' && (
              <span className="text-miss-bright">{state.message}</span>
            )}
            {/* Lock-in ceremony (kick plan #3): a fresh save gets a rising
                "Locked in" stamp — the moment the call becomes an event. The
                .rise-in keyframe already sits behind the reduced-motion
                kill-switch, so this is instant when motion is reduced. */}
            {state.status === 'saved' && (
              <span className="rise-in inline-flex items-center gap-1.5 rounded-full bg-green/15 px-2.5 py-1 font-medium text-green-bright">
                <LockClosedIcon className="h-3 w-3" />
                Locked in
              </span>
            )}
            {state.status === 'idle' && committed && (
              <span className="text-fg-dim">
                Saved — you can adjust it until kickoff.
              </span>
            )}
          </p>
        </div>
      </form>

      {/* The model's call — only AFTER the visitor has committed their own
          (anti-anchoring; DESIGN.md §6 honest-engagement rule). */}
      {committed && model && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-xs text-fg-dim">
            The model&rsquo;s call — shown once yours is in, so it can&rsquo;t
            anchor you. Predicted score{' '}
            <span className="font-mono text-fg">
              {scoreLine(model.predicted_home_goals, model.predicted_away_goals)}
            </span>
            .
          </p>
          <ProbabilityBar
            variant="row"
            home={model.prob_home}
            draw={model.prob_draw}
            away={model.prob_away}
            className="mt-2"
          />
        </div>
      )}
      {committed && !model && (
        <p className="mt-4 border-t border-line pt-3 text-xs text-fg-dim">
          The model hasn&rsquo;t published its call for this fixture yet —
          it&rsquo;ll appear here once it has.
        </p>
      )}
    </li>
  );
}
