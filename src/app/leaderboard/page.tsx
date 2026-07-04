import type { Metadata } from 'next';
import Link from 'next/link';
import SectionHeader from '@/components/SectionHeader';
import { getLeaderboard } from '@/lib/queries/leaderboard';
import { metric3 } from '@/lib/format';
import { ANALYSIS_NOT_ADVICE, SITE_NAME } from '@/lib/constants';

// /leaderboard — the public, opt-in "Beat the Model" leaderboard (RAMBO wave
// 2 improvement #5; DESIGN.md §6, ARCHITECTURE.md §5 v3 game-picks
// amendment). PUBLIC + ISR: anon reads only (leaderboard_standings is
// public-read by RLS design), no cookies, no client JS. The underlying table
// is a nightly jobs-written snapshot, so an hourly revalidate is plenty fresh.
//
// Honest framing throughout (non-negotiable): this ranks who is
// best-calibrated against our own model on their OWN scored Beat the Model
// picks — misses count in every average shown here, there is no money, no
// prizes, and nobody is shamed as a "loser". Appearing here is entirely the
// player's choice (opt-in, off by default, reversible from /account).
export const revalidate = 3600;

const TITLE = 'Leaderboard — best-calibrated vs the model';
const DESCRIPTION =
  'Who is best-calibrated against our own model, from real scored Beat the Model picks. Opt-in only, off by default — no money, no prizes, misses count in every average.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/leaderboard' },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    url: '/leaderboard',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default async function LeaderboardPage() {
  const rows = await getLeaderboard();

  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Leaderboard
        </h1>
        <p className="max-w-[56ch] text-sm leading-relaxed text-fg-dim">
          Ranked by how much sharper each player&rsquo;s own scored{' '}
          <Link href="/play" className="text-green underline hover:text-green-bright">
            Beat the Model
          </Link>{' '}
          picks are than our model&rsquo;s calls on the same fixtures. This is
          not a leaderboard of winners and losers — every miss counts in the
          average shown, there is no money or prizes, and appearing here is
          entirely opt-in (off by default, reversible any time from your
          account).
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="glass px-4 py-6">
          <p className="text-sm leading-relaxed text-fg-dim">
            The board opens as players opt in and their calls are scored — no
            numbers are invented in the meantime. Play{' '}
            <Link href="/play" className="text-green underline hover:text-green-bright">
              Beat the Model
            </Link>{' '}
            and turn on the leaderboard from your account to appear here.
          </p>
        </div>
      ) : (
        <section aria-labelledby="board-heading">
          <SectionHeader
            id="board-heading"
            title="Best-calibrated vs the model"
            description="Brier measures the gap between the probabilities given and what happened — 0 is a perfect call, 2 is confidently wrong. Margin is the model's mean Brier minus the player's; positive means ahead of the model."
          />
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <caption className="sr-only">
                Leaderboard ranked by beat margin: each opted-in player&rsquo;s
                mean Brier versus the model&rsquo;s, on their own scored Beat
                the Model picks.
              </caption>
              <thead>
                <tr className="border-b border-line text-left text-xs text-fg-dim">
                  <th scope="col" className="px-3 py-3 font-medium">
                    Rank
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Player
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Picks scored
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Player Brier
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Model Brier
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Margin
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.userId}>
                    <td className="px-3 py-3 font-mono text-fg-dim">{r.rank}</td>
                    <td className="max-w-40 truncate px-3 py-3 font-medium text-fg">
                      {r.displayName}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-fg-dim">
                      {r.picksScored}
                    </td>
                    <td className="px-3 py-3 text-right font-mono font-medium text-fg">
                      {metric3(r.userMeanBrier)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-fg-dim">
                      {metric3(r.modelMeanBrier)}
                    </td>
                    <td
                      className={`px-3 py-3 text-right font-mono ${
                        r.beatMargin > 0 ? 'text-green' : 'text-fg-dim'
                      }`}
                    >
                      {r.beatMargin > 0 ? '+' : ''}
                      {metric3(r.beatMargin)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
        {ANALYSIS_NOT_ADVICE}
      </p>
    </article>
  );
}
