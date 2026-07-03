import type { Metadata } from 'next';
import SectionHeader from '@/components/SectionHeader';
import FixtureList from '@/components/FixtureList';
import { getMatchesIndexData } from '@/lib/queries/matches';
import { ANALYSIS_NOT_ADVICE, SITE_NAME } from '@/lib/constants';

// SSR/ISR (ARCHITECTURE.md §11): re-render at most every 10 minutes so the
// fixture list stays fresh around kickoffs with no per-visitor work, and —
// like every web surface — NEVER a football-API call on the request path (§5
// golden rule). Reads come only from Supabase. This is the fixtures crawl hub
// ARCHITECTURE §11 calls "the growth engine": every match page it lists is
// discoverable from here, not only from the sitemap.
export const revalidate = 600;

const TITLE = 'Matches — fixtures & probabilities';
const DESCRIPTION =
  'Every upcoming fixture we track, grouped by day, with home/draw/away probabilities where a call has been made — plus recent results and how they landed. Analysis, not betting advice.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/matches' },
  // Self-referential og:url + restated siteName (openGraph fully replaces the
  // layout's object — ARCHITECTURE.md §11).
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    url: '/matches',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default async function MatchesPage() {
  const { upcomingByDay, recent } = await getMatchesIndexData();

  return (
    <article className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Matches
        </h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-dim">
          Every fixture we track, grouped by day — with our probabilities
          where a call has been made, and how recent calls landed.
        </p>
      </header>

      <section aria-labelledby="upcoming-heading">
        <SectionHeader id="upcoming-heading" title="Upcoming fixtures" />
        {upcomingByDay.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface px-4 py-6 text-sm text-fg-dim">
            No upcoming fixtures right now — they&rsquo;ll appear here as soon
            as the next matches are scheduled.
          </p>
        ) : (
          <div className="space-y-5">
            {upcomingByDay.map((group) => (
              <div key={group.dateIso}>
                {/* text-fg-dim, never text-fg-faint: the day label is meaningful
                    content at text-xs, and fg-faint is sub-AA (< 4.5:1) at small
                    sizes (globals.css token note; same rule as CalibrationTable). */}
                <h3 className="mb-2 font-mono text-xs font-medium text-fg-dim">
                  {group.label}
                </h3>
                <FixtureList fixtures={group.fixtures} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="results-heading">
        <SectionHeader
          id="results-heading"
          title="Recent results"
          href="/ledger"
          linkLabel="Full record"
        />
        <FixtureList
          fixtures={recent}
          emptyMessage="No results yet — they'll appear here once matches are played and scored."
        />
      </section>

      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
        {ANALYSIS_NOT_ADVICE}
      </p>
    </article>
  );
}
