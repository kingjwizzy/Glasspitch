'use client';

// One settled "Beat the Model" pick's reveal (kick plan #1, #4, #5) — the
// payoff layer for a pick that today gets scored silently and never shown
// back. A deliberate client island: /play is already authed + force-dynamic,
// so this is the one place beyond PickCard that's allowed client JS
// (ARCHITECTURE.md §6; the public/cached surface elsewhere stays zero-JS).
//
// Progressive enhancement: the full resolved content is ALWAYS present in the
// server-rendered HTML inside the native <details> — a no-JS visitor can
// still open it and read every number, just without the stagger/count-up.
// JS only adds the ceremony (the once-only staged reveal) and the "seen"
// persistence (localStorage; nothing server-side to keep this a pure read).
//
// Reduced motion: the CSS `.rise-in` keyframes are already gated behind
// `prefers-reduced-motion: no-preference` site-wide (globals.css), so it's
// always safe to apply those classes — under reduced motion they simply
// don't run and the final state shows immediately. The goal/Brier count-up is
// NOT covered by that stylesheet gate, so it's skipped outright (jumps
// straight to the final numbers) whenever `prefers-reduced-motion: reduce`.
//
// "Seen" is read via `useSyncExternalStore`, not a manual effect + setState —
// localStorage is a genuine external store, and this is the React-blessed way
// to read one safely (a server snapshot of `false`, reconciled to the real
// client value right after hydration, no manual re-render plumbing).

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import BrierVerdictChip from '@/components/play/BrierVerdictChip';
import ProbabilityBar from '@/components/ProbabilityBar';
import ResultBadge from '@/components/ResultBadge';
import ShareRow from '@/components/ShareRow';
import TeamFlag from '@/components/TeamFlag';
import {
  beatModelRead,
  favoured,
  formatDateShort,
  metric3,
  outcomeName,
  receiptRead,
  scoreLine,
} from '@/lib/format';
import { SITE_URL } from '@/lib/constants';
import type { SettledPick } from '@/lib/queries/play';
import type { MatchResult } from '@/lib/types';

const ONE_HOT: Record<MatchResult, { home: number; draw: number; away: number }> = {
  home: { home: 1, draw: 0, away: 0 },
  draw: { home: 0, draw: 1, away: 0 },
  away: { home: 0, draw: 0, away: 1 },
};

function seenKey(id: string): string {
  return `gp:pick-reveal-seen:${id}`;
}

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// No cross-tab live sync needed (this tab is the only writer that matters —
// see the direct re-render triggered by `setJustRevealed` right after the
// write below), so the subscription is a permanent no-op; only the snapshot
// read matters here.
function subscribeNever(): () => void {
  return () => {};
}

function getServerSeenSnapshot(): boolean {
  return false; // no localStorage during SSR — never "seen" on the server.
}

/** Has this pick's reveal already played, in a past session? Read from
 *  localStorage the React-blessed way (an external store), so the very first
 *  hydration pass matches the server (always `false`) and flips to the real
 *  answer immediately after, without a manual effect + setState. */
function useSeenBefore(id: string): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => {
      try {
        return window.localStorage.getItem(seenKey(id)) !== null;
      } catch {
        return false; // private mode / storage disabled — reveal just replays.
      }
    },
    getServerSeenSnapshot,
  );
}

/** How long the staged reveal takes end to end (base 500ms `.rise-in` + the
 *  210ms max stagger delay), rounded up — after this the animation "settles"
 *  so a later close/reopen in the same session never replays it (a
 *  `<details>` toggling shut and back open would otherwise restart CSS
 *  animations, since the content leaves and re-enters the render tree). */
const REVEAL_SETTLE_MS = 900;
const COUNT_UP_MS = 600;

interface RevealCounts {
  home: number;
  away: number;
  yourBrier: number;
  modelBrier: number;
}

export interface SettledPickRevealProps {
  pick: SettledPick;
}

/**
 * Honest, plain-text share line for a settled "Beat the Model" pick (RAMBO
 * wave 2 #1 — "the verifiable boast"). Built ONLY from `receiptRead` /
 * `beatModelRead` — the exact same helpers this component renders on screen
 * above (the "you" copy under the reveal, and the floodlit "you out-called
 * the model" panel) — so the shared numbers can never drift from what's
 * displayed. Hits and misses share at equal prominence: `receiptRead` is
 * symmetric by construction, never hype, never a guarantee (DESIGN.md §6).
 *
 * PRIVACY: no user identity anywhere in this string — only the fixture, the
 * probability that was called, and whether it landed. Safe to paste
 * anywhere; there is no per-user page for it to link to (see ShareRow below,
 * which links to the public /ledger instead).
 */
function buildPickShareText(
  pick: SettledPick,
  fav: { key: MatchResult; prob: number },
  hit: boolean,
  beatModel: boolean,
): string {
  const pickName = outcomeName(fav.key, pick.home, pick.away);
  const lead = `I called ${pickName} for ${pick.home} v ${pick.away}.`;
  const receipt = receiptRead(fav.prob, hit);
  if (beatModel && pick.model !== null) {
    const modelLine = beatModelRead(
      { home: pick.prob_home, draw: pick.prob_draw, away: pick.prob_away },
      { home: pick.model.prob_home, draw: pick.model.prob_draw, away: pick.model.prob_away },
      pick.result,
      pick.home,
      pick.away,
    );
    return `${lead} ${receipt} ${modelLine}`;
  }
  return `${lead} ${receipt}`;
}

export default function SettledPickReveal({ pick }: SettledPickRevealProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const rafRef = useRef<number | null>(null);
  const seenBefore = useSeenBefore(pick.id);

  // Only set once, directly from the click that reveals a genuinely NEW pick
  // (never in an effect — see the file banner). `settled` is used only to
  // stop re-applying the once-only stagger classes on a later close/reopen.
  const [justRevealed, setJustRevealed] = useState(false);
  const [settled, setSettled] = useState(false);

  const finalCounts: RevealCounts = {
    home: pick.final_home_goals,
    away: pick.final_away_goals,
    yourBrier: pick.brier_score,
    modelBrier: pick.model?.brier_score ?? 0,
  };
  const [counts, setCounts] = useState<RevealCounts>(finalCounts);

  // Auto-open an already-seen pick, fully resolved, no animation — a DOM
  // mutation only, no setState, so this stays outside the linter's concern.
  useEffect(() => {
    if (seenBefore && detailsRef.current) detailsRef.current.open = true;
  }, [seenBefore]);

  // Cancel any in-flight count-up if the card unmounts mid-animation.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  function handleToggle() {
    const el = detailsRef.current;
    if (!el || !el.open || seenBefore || justRevealed) return;

    setJustRevealed(true);
    try {
      window.localStorage.setItem(seenKey(pick.id), '1');
    } catch {
      // Unavailable storage — the reveal will simply play again next visit.
    }
    window.setTimeout(() => setSettled(true), REVEAL_SETTLE_MS);

    if (reducedMotion()) return; // stay at the final numbers, no tween.

    setCounts({ home: 0, away: 0, yourBrier: 0, modelBrier: 0 });
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      setCounts({
        home: finalCounts.home * t,
        away: finalCounts.away * t,
        yourBrier: finalCounts.yourBrier * t,
        modelBrier: finalCounts.modelBrier * t,
      });
      rafRef.current = t < 1 ? requestAnimationFrame(tick) : null;
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  const resolvedSeen = seenBefore || justRevealed;
  const revealing = justRevealed && !settled;
  const stage = (n: 0 | 1 | 2 | 3): string =>
    revealing ? (n === 0 ? 'rise-in' : `rise-in rise-in-${n}`) : '';

  const probs = { home: pick.prob_home, draw: pick.prob_draw, away: pick.prob_away };
  const fav = favoured(probs);
  const hit = fav.key === pick.result;
  const actual = ONE_HOT[pick.result];
  const beatModel =
    pick.model !== null &&
    pick.model.brier_score !== null &&
    pick.brier_score < pick.model.brier_score;
  const shareText = buildPickShareText(pick, fav, hit, beatModel);

  return (
    <li className="glass px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 font-display text-base font-semibold tracking-tight text-fg">
          <span className="mr-1.5 inline-flex items-center gap-1.5 align-baseline">
            <TeamFlag name={pick.home} />
            {pick.home}
          </span>
          <span className="font-normal text-fg-dim">v</span>
          <span className="ml-1.5 inline-flex items-center gap-1.5 align-baseline">
            <TeamFlag name={pick.away} />
            {pick.away}
          </span>
        </h3>
      </div>
      <p className="mt-1 text-xs text-fg-dim">
        <time dateTime={pick.kickoff_utc}>{formatDateShort(pick.kickoff_utc)}</time>
      </p>

      <details ref={detailsRef} onToggle={handleToggle} className="mt-3">
        <summary className="flex min-h-11 w-full cursor-pointer list-none items-center gap-2 text-sm text-fg [&::-webkit-details-marker]:hidden">
          {!resolvedSeen ? (
            <span className="font-medium text-green transition-colors hover:text-green-bright">
              Full time — tap to see how your call landed
            </span>
          ) : (
            <span className="inline-flex flex-wrap items-center gap-2">
              <ResultBadge hit={hit} />
              <span className="font-medium text-fg">{hit ? 'Correct call' : 'Missed call'}</span>
              <span className="font-mono text-fg-dim">
                {scoreLine(pick.final_home_goals, pick.final_away_goals)}
              </span>
            </span>
          )}
        </summary>

        <div className="mt-3 space-y-4 border-t border-line pt-3">
          {/* (a) the final scoreline, a short count-up on first reveal. */}
          <div className={stage(0)}>
            <p className="text-xs text-fg-dim">Full time score</p>
            <p className="font-mono text-3xl font-medium text-fg">
              {Math.round(counts.home)}–{Math.round(counts.away)}
            </p>
          </div>

          {/* (b) your saved call beside what actually happened. */}
          <div className={stage(1)}>
            <p className="text-xs text-fg-dim">Your call</p>
            <ProbabilityBar
              variant="row"
              home={probs.home}
              draw={probs.draw}
              away={probs.away}
              homeLabel={pick.home}
              awayLabel={pick.away}
            />
            <p className="mt-3 text-xs text-fg-dim">What happened</p>
            {/* a11y audit fix: this bar encodes the one-hot ACTUAL result, not
                a forecast — `semantics="result"` gives it its own accurate
                accessible name ("Final result — Brazil win" / "…draw")
                instead of inheriting the default "Win probability — …" name,
                which would otherwise misread a 100%/0%/0% result as a
                prediction. */}
            <ProbabilityBar
              variant="row"
              home={actual.home}
              draw={actual.draw}
              away={actual.away}
              homeLabel={pick.home}
              awayLabel={pick.away}
              semantics="result"
            />
          </div>

          {/* (c) the plain-language Brier verdict — kind and instructive,
              never "so close, try again" (DESIGN.md §6). */}
          <div className={stage(2)}>
            <BrierVerdictChip brier={pick.brier_score} />
          </div>

          {/* (d) the model's Brier for the head-to-head — a distinct
              floodlit hero when the visitor's own Brier is strictly sharper
              (kick plan #4), grounded only in a real, scored result. */}
          {pick.model === null || pick.model.brier_score === null ? (
            <p className={`text-xs text-fg-dim ${stage(3)}`}>
              The model has no scored call for this fixture — no head-to-head
              this time.
            </p>
          ) : beatModel ? (
            <div className={`floodlight rounded-xl border border-green/25 bg-green/5 p-4 ${stage(3)}`}>
              <p className="font-display text-base font-semibold text-green-bright">
                You out-called the model
              </p>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-2xl font-medium text-fg">
                  {counts.yourBrier.toFixed(3)}
                </span>
                <span className="text-xs text-fg-dim">you</span>
                {/* fg-dim, not fg-faint (a11y audit fix): matches the "you" /
                    "model" labels either side — fg-faint fails WCAG AA below
                    18px. */}
                <span className="text-xs text-fg-dim">vs</span>
                <span className="font-mono text-2xl font-medium text-fg-dim">
                  {counts.modelBrier.toFixed(3)}
                </span>
                <span className="text-xs text-fg-dim">model</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-fg-dim">
                {beatModelRead(
                  probs,
                  {
                    home: pick.model.prob_home,
                    draw: pick.model.prob_draw,
                    away: pick.model.prob_away,
                  },
                  pick.result,
                  pick.home,
                  pick.away,
                )}
              </p>
            </div>
          ) : (
            <div className={stage(3)}>
              <p className="text-xs text-fg-dim">Head-to-head — the model&rsquo;s Brier here</p>
              <p className="mt-1 font-mono text-lg text-fg">
                {metric3(pick.model.brier_score)}
              </p>
            </div>
          )}

          {/* (e) the share affordance — hits and misses equally shareable
              (audit "the verifiable boast"). Points at the public /ledger,
              never a per-user page (privacy — see buildPickShareText above). */}
          <div className={stage(3)}>
            <ShareRow
              url={`${SITE_URL}/ledger`}
              title="Beat the model — Glass Pitch"
              text={shareText}
            />
          </div>
        </div>
      </details>
    </li>
  );
}
