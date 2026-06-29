import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import AdSlot from '@/components/AdSlot';
import SectionHeader from '@/components/SectionHeader';
import MatchHeader from '@/components/match/MatchHeader';
import PredictionPanel from '@/components/match/PredictionPanel';
import ScoredResult from '@/components/match/ScoredResult';
import FormChips from '@/components/match/FormChips';
import LedgerCallout from '@/components/match/LedgerCallout';
import { getMatchData, type MatchData } from '@/lib/queries/match';
import { formatDateShort, templateRead } from '@/lib/format';
import { ANALYSIS_NOT_ADVICE, SITE_NAME } from '@/lib/constants';

// SSR/ISR (ARCHITECTURE.md §11): re-render at most every 10 minutes so a match
// stays fresh around kickoff without any per-visitor work, and NEVER calls the
// football API on the request path (§5 golden rule). Reads come only from
// Supabase. Unknown ids render on demand and are cached.
export const revalidate = 600;

interface MatchPageProps {
  params: Promise<{ id: string }>;
}

// Opt the dynamic [id] segment into on-demand ISR: returning an empty list
// pre-renders no ids at build, but every visited id is rendered once and then
// served from the full-route cache (dynamicParams defaults true). Without this,
// the segment is rendered per-request (no-store) on every hit; with it, the
// first hit on a fresh id populates the cache and subsequent hits are cache
// HITs — same matchday freshness via `revalidate`, a fraction of the TTFB. We
// deliberately do NOT use `dynamic = 'force-static'`, which would drop the
// dynamic params entirely. (ARCHITECTURE.md §11)
export function generateStaticParams() {
  return [];
}

function parseId(raw: string): number {
  // Bare integer ids only (the route is /match/[id]); anything else → 404.
  return /^\d+$/.test(raw) ? Number(raw) : NaN;
}

export async function generateMetadata({
  params,
}: MatchPageProps): Promise<Metadata> {
  const { id } = await params;
  const data = await getMatchData(parseId(id));

  if (!data) {
    return {
      title: 'Match not found',
      description:
        'This match isn’t in our record. Browse the latest probabilities and the public track record on Glass Pitch.',
      robots: { index: false, follow: true },
      alternates: { canonical: `/match/${id}` },
    };
  }

  const scored = data.prediction?.status === 'scored';
  const where = data.league ? ` (${data.league})` : '';
  // Date keeps the title/description unique when the same two teams meet more
  // than once (group stage vs knockout, or across tournament editions).
  const date = formatDateShort(data.kickoff_utc);
  const description = scored
    ? `How our locked call landed for ${data.home} v ${data.away}${where} on ${date}: home/draw/away probabilities, predicted score, the actual result and the Brier and log-loss scores. Analysis, not betting advice.`
    : `Home, draw and away probabilities and a predicted score for ${data.home} v ${data.away}${where} on ${date} — locked at kickoff and scored in a permanent public ledger. Analysis, not betting advice.`;

  const title = `${data.home} v ${data.away}, ${date} — probabilities & predicted score`;

  return {
    title,
    description,
    alternates: { canonical: `/match/${data.id}` },
    // openGraph fully replaces (not deep-merges) the layout's object, so the
    // inherited siteName must be restated or the share card loses the brand.
    openGraph: {
      type: 'article',
      siteName: SITE_NAME,
      title,
      description,
      url: `/match/${data.id}`,
    },
    twitter: { card: 'summary', title, description },
  };
}

/** Minimal, factual SportsEvent JSON-LD — plain team names only, no marks, no
 *  odds (ARCHITECTURE.md §13). Helps the page qualify as a rich result. */
function eventJsonLd(data: MatchData) {
  const json: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: `${data.home} v ${data.away}`,
    sport: 'Association football',
    startDate: data.kickoff_utc,
    competitor: [
      { '@type': 'SportsTeam', name: data.home },
      { '@type': 'SportsTeam', name: data.away },
    ],
  };
  if (data.league) json.superEvent = { '@type': 'SportsEvent', name: data.league };
  if (data.status === 'postponed') {
    json.eventStatus = 'https://schema.org/EventPostponed';
  }
  return json;
}

/** Serialise JSON-LD for safe embedding in a <script> tag: escape the
 *  characters that could otherwise break out of the element (defence in depth —
 *  team/competition names come from the jobs feed, never a visitor). */
function jsonLdScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

export default async function MatchPage({ params }: MatchPageProps) {
  const { id } = await params;
  const data = await getMatchData(parseId(id));
  if (!data) notFound();

  const { prediction } = data;
  const scored =
    prediction?.status === 'scored' &&
    prediction.result !== null &&
    data.final_home_goals !== null &&
    data.final_away_goals !== null;

  const read = prediction
    ? templateRead({
        home: prediction.prob_home,
        draw: prediction.prob_draw,
        away: prediction.prob_away,
        home_name: data.home,
        away_name: data.away,
        predicted_home_goals: prediction.predicted_home_goals,
        predicted_away_goals: prediction.predicted_away_goals,
      })
    : null;

  const hasForm = data.homeForm.length > 0 || data.awayForm.length > 0;

  return (
    <article className="space-y-8">
      <script
        type="application/ld+json"
        // JSON-LD is data for crawlers, not executable app JS — keeps the SEO
        // surface rich while the page stays zero-client-JS (DESIGN.md §8).
        dangerouslySetInnerHTML={{ __html: jsonLdScript(eventJsonLd(data)) }}
      />

      <MatchHeader
        league={data.league}
        home={data.home}
        away={data.away}
        homeSlug={data.homeSlug}
        awaySlug={data.awaySlug}
        kickoffUtc={data.kickoff_utc}
        status={data.status}
        finalHome={data.final_home_goals}
        finalAway={data.final_away_goals}
      />

      {/* Reserved ad slot — built-ready but renders nothing in v1 (§4, §13). */}
      <AdSlot slot="match-top" />

      <section aria-labelledby="call-heading">
        <SectionHeader id="call-heading" title="Our call" />
        <PredictionPanel
          prediction={prediction}
          predictionVoided={data.predictionVoided}
          status={data.status}
        />
      </section>

      {scored && (
        <section aria-labelledby="result-heading">
          <SectionHeader id="result-heading" title="How the call landed" />
          <ScoredResult
            prediction={prediction!}
            home={data.home}
            away={data.away}
            finalHome={data.final_home_goals!}
            finalAway={data.final_away_goals!}
          />
        </section>
      )}

      {hasForm && (
        <section aria-labelledby="form-heading">
          <SectionHeader id="form-heading" title="Recent form" />
          <div className="grid gap-5 rounded-2xl border border-line bg-surface p-5 sm:grid-cols-2">
            <FormChips teamName={data.home} results={data.homeForm} />
            <FormChips teamName={data.away} results={data.awayForm} />
          </div>
          <p className="mt-2 text-xs text-fg-dim">
            Form is each team&rsquo;s most recent finished matches in our record,
            oldest to newest.
          </p>
        </section>
      )}

      {read && (
        <section aria-labelledby="read-heading">
          <SectionHeader id="read-heading" title="The pre-match read" />
          <p className="text-sm leading-relaxed text-fg-dim">{read}</p>
        </section>
      )}

      <LedgerCallout />

      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
        {ANALYSIS_NOT_ADVICE}
      </p>
    </article>
  );
}
