import type { Metadata } from 'next';
import { getGoldenBootTop15 } from '@/lib/queries/goldenBoot';
import { SITE_NAME } from '@/lib/constants';

// /stats/golden-boot — the full Golden Boot standings (DESIGN.md §4 home item
// 5, previously unbuilt). ISR (ARCHITECTURE.md §11): re-render at most every
// 10 minutes so the standings stay fresh with no per-visitor work, and — like
// every web surface — NEVER a football-API call on the request path (§5
// golden rule). Reads only from Supabase; degrades to an honest empty state
// while the data pipeline hasn't run yet (DESIGN.md §9).
export const revalidate = 600;

const TITLE = 'Golden Boot — top scorers';
const DESCRIPTION =
  'The top scorers across our tracked competitions — name, nationality, goals and assists. Plain text and numbers only, no photos or crests.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/stats/golden-boot' },
  // Self-referential og:url + restated siteName (openGraph fully replaces the
  // layout's object — ARCHITECTURE.md §11).
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    url: '/stats/golden-boot',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default async function GoldenBootPage() {
  const scorers = await getGoldenBootTop15();

  return (
    <article className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Golden Boot race
        </h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-dim">
          The top scorers across our tracked competitions. Plain text and
          numbers only — no photos, no crests.
        </p>
      </header>

      {scorers.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-6 text-sm text-fg-dim">
          Top-scorer standings appear once the data pipeline first runs.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Top 15 goalscorers, ranked</caption>
            <thead>
              <tr className="border-b border-line text-xs text-fg-dim">
                <th scope="col" className="px-3 py-2 font-medium">
                  #
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Player
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Team
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Nation
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Goals
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Assists
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {scorers.map((s) => (
                <tr key={`${s.rank}-${s.playerName}`}>
                  <td className="px-3 py-2 font-mono text-fg-dim">{s.rank}</td>
                  <td className="px-3 py-2 font-medium text-fg">{s.playerName}</td>
                  <td className="px-3 py-2 text-fg-dim">{s.teamName}</td>
                  <td className="px-3 py-2 text-fg-dim">{s.nationality ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono font-medium text-fg">
                    {s.goals}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-fg-dim">{s.assists ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs leading-relaxed text-fg-dim">
        Sourced from the same data pipeline as our fixtures and predictions —
        it updates as the tournament progresses.
      </p>
    </article>
  );
}
