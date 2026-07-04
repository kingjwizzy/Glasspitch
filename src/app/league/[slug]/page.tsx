import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import AdSlot from '@/components/AdSlot';
import SectionHeader from '@/components/SectionHeader';
import FixtureList from '@/components/FixtureList';
import LedgerCallout from '@/components/match/LedgerCallout';
import { getLeagueData, getAllLeagueSlugs, getAllLeagueOptions } from '@/lib/queries/league';
import type { FixtureRowView } from '@/lib/queries/fixtures';
import { ANALYSIS_NOT_ADVICE, SITE_NAME } from '@/lib/constants';
import { breadcrumbJsonLd, jsonLdScript } from '@/lib/jsonld';

// SSR/ISR (ARCHITECTURE.md §11): re-render at most every 10 minutes so fixture
// lists and record stats stay fresh with no per-visitor work. Never calls the
// football API on the request path (§5 golden rule) — reads from Supabase only.
// Unknown slugs render on demand and are cached once found; missing slugs → 404.
export const revalidate = 600;

interface LeaguePageProps {
  params: Promise<{ slug: string }>;
}

// Pre-render all known league slugs at build time; unknown slugs fall through
// to on-demand ISR (dynamicParams defaults true). Returns [] on any error so
// the build never fails.
export async function generateStaticParams() {
  return (await getAllLeagueSlugs()).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: LeaguePageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await getLeagueData(slug);

  if (!data) {
    return {
      title: 'League not found',
      description:
        'This league isn’t in our record. Browse the latest probabilities and the public track record on Glass Pitch.',
      robots: { index: false, follow: true },
      alternates: { canonical: `/league/${slug}` },
    };
  }

  const { name, country, season } = data;
  const title = `${name} — fixtures & probabilities`;
  const description = `Upcoming and recent ${name} (${country}, ${season}) fixtures with home/draw/away probabilities and predicted scores. Analysis, not betting advice.`;

  return {
    title,
    description,
    alternates: { canonical: `/league/${slug}` },
    // openGraph fully replaces (not deep-merges) the layout's object, so the
    // inherited siteName must be restated or the share card loses the brand.
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title,
      description,
      url: `/league/${slug}`,
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

/** Every distinct team appearing in this league's fixtures, name + slug,
 *  de-duplicated and alphabetised. Derived from data the page already holds
 *  (no extra DB read) — lets the league page cross-link to /team/[slug] pages
 *  that otherwise have no path leading to them (audit finding: orphaned team
 *  pages). Only ever includes teams whose slug actually resolves — a fixture
 *  row with a missing slug is silently dropped rather than rendering a
 *  broken link. */
function leagueTeams(fixtures: FixtureRowView[]): { name: string; slug: string }[] {
  const bySlug = new Map<string, string>();
  for (const f of fixtures) {
    if (f.homeSlug) bySlug.set(f.homeSlug, f.home);
    if (f.awaySlug) bySlug.set(f.awaySlug, f.away);
  }
  return Array.from(bySlug, ([slug, name]) => ({ name, slug })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export default async function LeaguePage({ params }: LeaguePageProps) {
  const { slug } = await params;
  const data = await getLeagueData(slug);
  if (!data) notFound();

  const { name, country, season, upcoming, recent, record } = data;
  const teams = leagueTeams([...upcoming, ...recent]);
  const breadcrumb = breadcrumbJsonLd([{ name, url: `/league/${slug}` }]);

  // Dense internal linking (ARCHITECTURE.md §11; improvement #4): this page
  // already links every one of its own fixtures and teams, so the fresh link
  // equity here is OUTWARD — to sibling competitions (today just one league
  // exists, so this is mostly future-proofing for club football §14/§16).
  // Best-effort, never blocks the page.
  const otherLeagues = (await getAllLeagueOptions()).filter((l) => l.slug !== slug).slice(0, 6);

  // Minimal SportsEvent JSON-LD for the tournament — plain names only, no
  // official marks, no odds (ARCHITECTURE.md §13). schema.org SportsEvent
  // requires startDate, so derive it from the earliest fixture we hold and omit
  // the block entirely when there are none (an incomplete SportsEvent earns no
  // rich result anyway). Keeps the page zero-client-JS.
  const startDate = [...upcoming, ...recent]
    .map((f) => f.kickoff_utc)
    .sort()[0];
  const jsonLd = startDate
    ? {
        '@context': 'https://schema.org',
        '@type': 'SportsEvent',
        name,
        sport: 'Association football',
        startDate,
        location: { '@type': 'Place', name: country },
      }
    : null;

  return (
    <article className="space-y-8">
      {jsonLd && (
        <script
          type="application/ld+json"
          // JSON-LD is data for crawlers, not executable app JS — keeps the SEO
          // surface rich while the page stays zero-client-JS (DESIGN.md §8).
          dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
        />
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />

      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          {name}
        </h1>
        <p className="mt-1 text-sm text-fg-dim">
          {country} · {season}
        </p>

        {/* Record band — only rendered when scored predictions exist (§10, §13).
            Mono figures for the numbers; honest "losses included" caveat;
            text-green link drives traffic to the first-class ledger. */}
        {record && record.scored > 0 && (
          <div className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface-2 px-4 py-3">
            <p className="text-xs leading-relaxed text-fg-dim">
              <span className="font-mono text-fg">{record.hits}</span> of{' '}
              <span className="font-mono text-fg">{record.scored}</span> calls
              landed
              {record.meanBrier !== null && (
                <>
                  {' '}
                  — mean Brier{' '}
                  <span className="font-mono text-fg">
                    {record.meanBrier.toFixed(2)}
                  </span>
                </>
              )}
              . Losses included.
            </p>
            <Link
              href="/ledger"
              className="-my-2 inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-medium text-green transition-colors hover:text-green-bright"
            >
              See the full record
            </Link>
          </div>
        )}
      </header>

      {/* Reserved ad slot — built-ready but renders nothing in v1 (§4, §13). */}
      <AdSlot slot="league-top" />

      <section aria-labelledby="upcoming-heading">
        <SectionHeader id="upcoming-heading" title="Upcoming fixtures" />
        <FixtureList
          fixtures={upcoming}
          emptyMessage="No upcoming fixtures right now — they'll appear here as soon as the next matches are scheduled."
        />
      </section>

      <section aria-labelledby="results-heading">
        <SectionHeader id="results-heading" title="Recent results" />
        <FixtureList
          fixtures={recent}
          emptyMessage="No results in our record yet — predictions appear here once they're published and scored."
        />
      </section>

      {/* Cross-links every team in this competition to its own /team/[slug]
          page (audit finding: team pages exist but nothing links to them) —
          derived from the fixtures already loaded above, so every link
          resolves. */}
      {teams.length > 0 && (
        <section aria-labelledby="teams-heading">
          <SectionHeader id="teams-heading" title="Teams in this competition" />
          <ul className="flex flex-wrap gap-2">
            {teams.map((t) => (
              <li key={t.slug}>
                <Link
                  href={`/team/${t.slug}`}
                  className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-3.5 text-sm text-fg transition-colors hover:bg-surface-2"
                >
                  {t.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* More competitions (improvement #4) — an always-on link to the browse
          index plus any sibling leagues, so the outward link equity exists
          from day one even while v1 tracks a single competition. */}
      <section aria-labelledby="other-leagues-heading">
        <SectionHeader id="other-leagues-heading" title="More competitions" />
        <ul className="flex flex-wrap gap-2">
          {otherLeagues.map((l) => (
            <li key={l.slug}>
              <Link
                href={`/league/${l.slug}`}
                className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-3.5 text-sm text-fg transition-colors hover:bg-surface-2"
              >
                {l.name}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/leagues"
              className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface-2 px-3.5 text-sm text-green transition-colors hover:text-green-bright"
            >
              Browse all competitions
            </Link>
          </li>
        </ul>
      </section>

      <LedgerCallout />

      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
        {ANALYSIS_NOT_ADVICE}
      </p>
    </article>
  );
}
