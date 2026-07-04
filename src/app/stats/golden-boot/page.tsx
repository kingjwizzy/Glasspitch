import type { Metadata } from 'next';
import { NationalityFlag } from '@/components/TeamFlag';
import GoldenBootMotif from '@/components/art/GoldenBootMotif';
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
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
            Golden Boot race
          </h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-dim">
            The top scorers across our tracked competitions. Names, nations
            and numbers — no photos, no crests.
          </p>
        </div>
        {/* Original flat-vector trophy motif (aria-hidden, inline — no request). */}
        <GoldenBootMotif className="mt-1 h-16 w-16 shrink-0 text-away sm:h-20 sm:w-20" />
      </header>

      {scorers.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-6 text-sm text-fg-dim">
          Top-scorer standings appear once the data pipeline first runs.
        </p>
      ) : (
        <>
          {/* Below sm: one stacked card per player — Goals is the headline
              number (the whole point of the page was being clipped
              off-screen with no scroll cue on a 393px phone, audit #10/#13/
              #14), Assists sits right beside it, and the nation flag folds
              into the player cell instead of a separate column. The sm+
              table below is unchanged. */}
          <ol
            aria-label="Top 15 goalscorers, ranked"
            className="divide-y divide-line rounded-xl border border-line bg-surface px-4 sm:hidden"
          >
            {scorers.map((s) => (
              <li key={`${s.rank}-${s.playerName}`} className="flex items-center gap-3 py-3.5">
                <span className="w-5 shrink-0 font-mono text-sm text-fg-dim" aria-hidden="true">
                  {s.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[15px] font-medium text-fg">
                    {s.nationality && (
                      <NationalityFlag nationality={s.nationality} className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate">{s.playerName}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-fg-dim">
                    {s.teamName}
                    {s.nationality ? ` · ${s.nationality}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-2xl font-semibold text-fg">{s.goals}</p>
                  <p className="text-[11px] text-fg-dim">
                    {s.goals === 1 ? 'goal' : 'goals'} ·{' '}
                    <span className="font-mono text-fg-dim">{s.assists ?? '—'}</span> ast
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div
            // Horizontally scrollable on narrow viewports, so keyboard users
            // need to be able to focus and scroll it (axe
            // scrollable-region-focusable); the global :focus-visible ring
            // marks it, and the region name mirrors the table caption.
            role="region"
            aria-label="Top 15 goalscorers, ranked"
            tabIndex={0}
            className="hidden overflow-x-auto rounded-xl border border-line bg-surface sm:block"
          >
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
                  <td className="px-3 py-2 text-fg-dim">
                    {s.nationality ? (
                      <span className="flex items-center gap-1.5">
                        {/* Decorative national flag (aria-hidden) — the W6 owner
                            request; plain text stays the identifier. */}
                        <NationalityFlag nationality={s.nationality} />
                        {s.nationality}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-medium text-fg">
                    {s.goals}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-fg-dim">{s.assists ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}

      <p className="text-xs leading-relaxed text-fg-dim">
        Sourced from the same data pipeline as our fixtures and predictions —
        it updates as the tournament progresses.
      </p>
    </article>
  );
}
