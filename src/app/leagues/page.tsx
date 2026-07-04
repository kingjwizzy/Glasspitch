import type { Metadata } from 'next';
import Link from 'next/link';
import { getLeaguesIndexData } from '@/lib/queries/league';
import { SITE_NAME } from '@/lib/constants';

// /leagues — the competition browse index (ARCHITECTURE.md §11), fixing the
// "no league browse path" audit finding. Built to hold many competitions even
// though v1 tracks one. ISR (§11): re-render at most every hour — league rows
// change rarely — with no per-visitor work, and never a football-API call on
// the request path (§5 golden rule). Reads only from Supabase.
export const revalidate = 3600;

const TITLE = 'Leagues — browse competitions';
const DESCRIPTION =
  'Every competition we track, with fixture counts and a link through to each league’s fixtures and probabilities.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/leagues' },
  // Self-referential og:url + restated siteName (openGraph fully replaces the
  // layout's object — ARCHITECTURE.md §11).
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    url: '/leagues',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default async function LeaguesPage() {
  const leagues = await getLeaguesIndexData();

  return (
    <article className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Leagues
        </h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-dim">
          Every competition in our record. Pick one to see its fixtures,
          probabilities and scored calls.
        </p>
      </header>

      {leagues.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-6 text-sm text-fg-dim">
          No competitions in our record yet.
        </p>
      ) : (
        // A single full-width bordered list (mirrors FixtureList) rather than a
        // grid of fixed-size cards: with only one tracked competition today, a
        // small card floating at the top of a wide desktop viewport reads as
        // broken; a full-width row never looks sparse, whether there's one
        // competition or many (fixes the "80%-blank desktop" audit finding).
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface px-2">
          {leagues.map((l) => (
            <li key={l.slug}>
              <Link
                href={`/league/${l.slug}`}
                className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-4 transition-colors hover:bg-surface-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">
                    {l.name}
                  </span>
                  <span className="block text-xs text-fg-dim">
                    {l.country} · {l.season}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-xs text-fg-dim">
                  {l.fixtureCount} {l.fixtureCount === 1 ? 'fixture' : 'fixtures'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
