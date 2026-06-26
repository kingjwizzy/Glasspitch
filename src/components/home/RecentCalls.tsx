import Link from 'next/link';
import { CheckIcon, CrossIcon } from '@/components/icons';
import { pct, scoreLine } from '@/lib/format';
import type { MatchResult } from '@/lib/types';
import type { RecentCallView } from '@/lib/queries/homepage';

// "How recent calls landed" — the signature section (DESIGN.md §1, §4). Finished
// matches with the probability we assigned and a green ✓ / red ✗. Misses sit
// beside hits and are NEVER hidden — the visible honesty IS the product.

const RESULT_WORD: Record<MatchResult, string> = {
  home: 'Home win',
  draw: 'Draw',
  away: 'Away win',
};

function outcomeName(key: MatchResult, home: string, away: string): string {
  if (key === 'home') return home;
  if (key === 'away') return away;
  return 'the draw';
}

function probOf(c: RecentCallView, key: MatchResult): number {
  if (key === 'home') return c.prob_home;
  if (key === 'away') return c.prob_away;
  return c.prob_draw;
}

function ResultBadge({ hit }: { hit: boolean }) {
  return (
    <span
      role="img"
      aria-label={hit ? 'Correct call' : 'Missed call'}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
        hit ? 'bg-green/15 text-green' : 'bg-miss/15 text-miss'
      }`}
    >
      {hit ? <CheckIcon className="h-4 w-4" /> : <CrossIcon className="h-4 w-4" />}
    </span>
  );
}

function CallRow({ c }: { c: RecentCallView }) {
  const pickName = outcomeName(c.pick, c.home, c.away);
  return (
    <li>
      <Link
        href={`/match/${c.fixtureId}`}
        className="flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface-2"
      >
        <ResultBadge hit={c.hit} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">
            {c.home} <span className="text-fg-dim">v</span> {c.away}
          </p>
          <p className="mt-0.5 truncate text-xs text-fg-dim">
            We backed {pickName} (
            <span className="font-mono">{pct(probOf(c, c.pick))}</span>)
          </p>
        </div>
        <div className="shrink-0 text-right">
          {c.final_home_goals !== null && c.final_away_goals !== null && (
            <p className="font-mono text-sm font-medium text-fg">
              {scoreLine(c.final_home_goals, c.final_away_goals)}
            </p>
          )}
          {c.result && (
            <p className="mt-0.5 text-xs text-fg-dim">{RESULT_WORD[c.result]}</p>
          )}
        </div>
      </Link>
    </li>
  );
}

export default function RecentCalls({ calls }: { calls: RecentCallView[] }) {
  if (calls.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-6 text-sm text-fg-dim">
        No scored predictions yet — check back after the first matches kick off
        and finish.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-surface px-2">
      {calls.map((c) => (
        <CallRow key={c.id} c={c} />
      ))}
    </ul>
  );
}
