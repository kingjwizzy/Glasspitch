import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import AdSlot from '@/components/AdSlot';
import SectionHeader from '@/components/SectionHeader';
import FixtureList from '@/components/FixtureList';
import FormChips from '@/components/match/FormChips';
import LedgerCallout from '@/components/match/LedgerCallout';
import { getTeamData, getAllTeamSlugs } from '@/lib/queries/team';
import { ANALYSIS_NOT_ADVICE, SITE_NAME, SITE_URL } from '@/lib/constants';
import { breadcrumbJsonLd, jsonLdScript } from '@/lib/jsonld';

// SSR/ISR (ARCHITECTURE.md §11): re-render at most every 10 minutes so the
// page stays fresh without per-visitor DB work. Reads come only from Supabase —
// no football API call on the request path (§5 golden rule).
export const revalidate = 600;

interface TeamPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  // Degrade to [] on any error so the build never fails — unknown slugs fall
  // through to on-demand ISR (dynamicParams defaults true).
  return (await getAllTeamSlugs()).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: TeamPageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await getTeamData(slug);

  if (!data) {
    return {
      title: 'Team not found',
      description:
        "This team isn't in our record. Browse the latest probabilities and the public track record on Glass Pitch.",
      robots: { index: false, follow: true },
      alternates: { canonical: `/team/${slug}` },
    };
  }

  const title = `${data.name} — fixtures, form & probabilities`;
  // The league name is best-effort (a separate lookup that degrades to ''); only
  // append the "at the …" clause when we actually have it, so the description
  // never renders a dangling "at the :".
  const at = data.league ? ` at the ${data.league}` : '';
  const description = data.recent.length > 0
    ? `Fixtures and results for ${data.name}${at}: home/draw/away probabilities, recent form, and scored calls on a permanent public ledger. Analysis, not betting advice.`
    : `Upcoming fixtures and recent form for ${data.name}${at}, with home/draw/away probabilities. Analysis, not betting advice.`;

  return {
    title,
    description,
    alternates: { canonical: `/team/${data.slug}` },
    // openGraph fully replaces (not deep-merges) the layout's object, so the
    // inherited siteName must be restated or the share card loses the brand.
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title,
      description,
      url: `/team/${data.slug}`,
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

/** Minimal SportsTeam JSON-LD — plain name only, no logo, no crest
 *  (ARCHITECTURE.md §13). Helps the page qualify for rich-result treatment. */
function teamJsonLd(name: string, slug: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsTeam',
    name,
    sport: 'Association football',
    url: `${SITE_URL}/team/${slug}`,
  };
}

export default async function TeamPage({ params }: TeamPageProps) {
  const { slug } = await params;
  const data = await getTeamData(slug);
  if (!data) notFound();

  const { name, league, leagueSlug, upcoming, recent, form, record } = data;

  const breadcrumb = breadcrumbJsonLd([
    ...(league && leagueSlug ? [{ name: league, url: `/league/${leagueSlug}` }] : []),
    { name, url: `/team/${data.slug}` },
  ]);

  return (
    <article className="space-y-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(teamJsonLd(name, data.slug)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          {name}
        </h1>
        {league && leagueSlug && (
          <p className="mt-1 text-sm">
            <Link
              href={`/league/${leagueSlug}`}
              className="text-green transition-colors hover:text-green-bright"
            >
              {league}
            </Link>
          </p>
        )}
        {/* Honest, one-line record stat — mono figures, no hype (DESIGN.md §9). */}
        {record !== null && record.scored > 0 && (
          <p className="mt-2 text-sm text-fg-dim">
            Our record on {name}:{' '}
            <span className="font-mono">{record.hits}</span> of{' '}
            <span className="font-mono">{record.scored}</span> scored calls correct
            {record.meanBrier !== null && (
              <>
                {' '}— mean Brier{' '}
                <span className="font-mono">{record.meanBrier.toFixed(2)}</span>
              </>
            )}
          </p>
        )}
      </header>

      {/* Reserved ad slot — built-ready but renders nothing in v1 (§4, §13). */}
      <AdSlot slot="team-top" />

      {/* ── Recent form ────────────────────────────────────────────────────── */}
      {form.length > 0 && (
        <section aria-labelledby="form-heading">
          <SectionHeader id="form-heading" title="Recent form" />
          <div className="rounded-2xl border border-line bg-surface p-5">
            <FormChips teamName={name} results={form} />
          </div>
          <p className="mt-2 text-xs text-fg-dim">
            Most recent finished matches in our record, oldest to newest.
          </p>
        </section>
      )}

      {/* ── Upcoming fixtures ──────────────────────────────────────────────── */}
      <section aria-labelledby="upcoming-heading">
        <SectionHeader id="upcoming-heading" title="Upcoming fixtures" />
        <FixtureList
          fixtures={upcoming}
          emptyMessage={`No upcoming fixtures for ${name} right now — they'll appear here once the next matches are scheduled.`}
        />
      </section>

      {/* ── Recent results ─────────────────────────────────────────────────── */}
      <section aria-labelledby="results-heading">
        <SectionHeader id="results-heading" title="Recent results" />
        <FixtureList
          fixtures={recent}
          emptyMessage="No results in our record yet — predictions appear here once they're published and scored."
        />
      </section>

      <LedgerCallout />

      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
        {ANALYSIS_NOT_ADVICE}
      </p>
    </article>
  );
}
