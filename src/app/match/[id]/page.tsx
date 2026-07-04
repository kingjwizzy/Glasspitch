import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import AdSlot from '@/components/AdSlot';
import SectionHeader from '@/components/SectionHeader';
import MatchHeader from '@/components/match/MatchHeader';
import PredictionPanel from '@/components/match/PredictionPanel';
import ScoredResult from '@/components/match/ScoredResult';
import FormChips from '@/components/match/FormChips';
import LedgerCallout from '@/components/match/LedgerCallout';
import DeeperReadCallout from '@/components/match/DeeperReadCallout';
import InsightsPanel from '@/components/match/InsightsPanel';
import ShareRow from '@/components/ShareRow';
import RelatedFixtures from '@/components/RelatedFixtures';
import { getMatchData, type MatchData } from '@/lib/queries/match';
import { getRelatedFixtures } from '@/lib/queries/related';
import {
  getOpenMatchFixtureId,
  getOpenMatchInsights,
} from '@/lib/queries/openMatch';
import { favoured, formatDateShort, outcomeName, pct, scoreLine, templateRead } from '@/lib/format';
import { ANALYSIS_NOT_ADVICE, SITE_NAME, SITE_URL } from '@/lib/constants';
import { breadcrumbJsonLd, jsonLdScript } from '@/lib/jsonld';

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

// Exported so the sibling /match/[id]/insights route (v2 premium) parses ids
// identically rather than duplicating this validation.
export function parseId(raw: string): number {
  // Bare integer ids only (the route is /match/[id]), bounded to a sane digit
  // length. Without the length cap, a huge digit string still matches
  // `Number.isInteger` (JS floats represent large whole numbers exactly enough
  // to pass that check) but overflows Postgres bigint / loses precision,
  // surfacing as a thrown DB error (match.ts throws on transient failures so
  // ISR retries) — a 500 for a URL that should just 404. 15 digits is well
  // under Number.MAX_SAFE_INTEGER (16 digits) and Postgres bigint's range.
  if (!/^\d{1,15}$/.test(raw)) return NaN;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : NaN;
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
    twitter: { card: 'summary_large_image', title, description },
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

/** Honest, plain-names share text for this fixture's call (audit #9) — the
 *  scored receipt once a result exists, otherwise the pre-match call, or null
 *  when there is nothing displayable to share (no prediction, or voided —
 *  §9/§10 never present a voided call as ours). Sharing a receipt reuses the
 *  exact same argmax/labelling helpers as ScoredResult/PredictionPanel so the
 *  shared line can never drift from what the page itself shows. */
function buildShareText(data: MatchData): string | null {
  const { prediction } = data;
  if (!prediction) return null;

  const probs = {
    home: prediction.prob_home,
    draw: prediction.prob_draw,
    away: prediction.prob_away,
  };
  const pick = favoured(probs);
  const pickName = outcomeName(pick.key, data.home, data.away);
  const pickPct = pct(pick.prob);

  const isScored =
    prediction.status === 'scored' &&
    prediction.result !== null &&
    data.final_home_goals !== null &&
    data.final_away_goals !== null;

  if (isScored) {
    const hit = pick.key === prediction.result;
    const actual = scoreLine(data.final_home_goals!, data.final_away_goals!);
    return `${SITE_NAME}'s call for ${data.home} v ${data.away}: ${pickName} at ${pickPct}. It finished ${actual} — ${
      hit ? 'a correct call' : 'a missed call'
    }, logged forever on the public ledger.`;
  }

  const predictedScore = scoreLine(
    prediction.predicted_home_goals,
    prediction.predicted_away_goals,
  );
  return `${SITE_NAME}'s call for ${data.home} v ${data.away}: ${pickName} at ${pickPct}, ${predictedScore} predicted. Locked at kickoff, scored on the public ledger either way.`;
}

export default async function MatchPage({ params }: MatchPageProps) {
  const { id } = await params;
  const data = await getMatchData(parseId(id));
  if (!data) notFound();

  // "Open match of the day" (ROADMAP.md §2): if THIS fixture is today's
  // deterministic pick (earliest kickoff today with a displayed call), its
  // premium deeper read renders free, right here, for everyone — computed at
  // ISR render time, identical for every visitor, so the page stays cached
  // and viewer-agnostic. Every other fixture keeps the one quiet callout.
  const openMatchId = await getOpenMatchFixtureId(new Date().toISOString());
  const openInsights =
    openMatchId === data.id ? await getOpenMatchInsights(data.id) : null;

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
  const shareText = buildShareText(data);
  // Dense internal linking (ARCHITECTURE.md §11 "the growth engine";
  // improvement #4) — best-effort, never blocks the page (see related.ts).
  const related = await getRelatedFixtures(data.id);

  const breadcrumb = breadcrumbJsonLd([
    ...(data.league && data.leagueSlug
      ? [{ name: data.league, url: `/league/${data.leagueSlug}` }]
      : []),
    { name: `${data.home} v ${data.away}`, url: `/match/${data.id}` },
  ]);

  return (
    // Vertical rhythm (RAMBO wave 3 #10a) — same 48px → 64px cadence as
    // page.tsx and ledger/page.tsx, so the flagship pages breathe identically.
    <article className="space-y-12 lg:space-y-16">
      <script
        type="application/ld+json"
        // JSON-LD is data for crawlers, not executable app JS — keeps the SEO
        // surface rich while the page stays zero-client-JS (DESIGN.md §8).
        dangerouslySetInnerHTML={{ __html: jsonLdScript(eventJsonLd(data)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />

      <MatchHeader
        league={data.league}
        leagueSlug={data.leagueSlug}
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
          home={data.home}
          away={data.away}
        />
      </section>

      {prediction?.narrative && (
        <section aria-labelledby="narrative-heading">
          <SectionHeader id="narrative-heading" title="What's driving this call" />
          <p className="text-sm leading-relaxed text-fg-dim">{prediction.narrative}</p>
        </section>
      )}

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

      {shareText && (
        <section aria-labelledby="share-heading">
          <SectionHeader id="share-heading" title="Share this call" />
          <ShareRow
            text={shareText}
            url={`${SITE_URL}/match/${data.id}`}
            title={`${data.home} v ${data.away}`}
          />
        </section>
      )}

      {openInsights !== null ? (
        <section aria-labelledby="open-read-heading">
          <SectionHeader
            id="open-read-heading"
            title="Deeper read"
            description="Today's open match — the premium deeper read, free for everyone on this page."
          />
          <InsightsPanel insights={openInsights} />
          <p className="mt-2 text-xs leading-relaxed text-fg-dim">
            One match&rsquo;s deeper read is open on every matchday, so you can
            judge what Premium is like from the real thing — the full ledger
            and every match&rsquo;s probabilities stay free forever either way.
          </p>
        </section>
      ) : (
        <DeeperReadCallout fixtureId={data.id} />
      )}

      <RelatedFixtures
        headingId="related-heading"
        heading="More matchday calls"
        description="Other fixtures worth a look from here — every group is capped and self-excluded, never a repeat of this match."
        groups={[
          { heading: 'Also today', items: related.sameDay },
          ...(data.league
            ? [{ heading: `More in ${data.league}`, items: related.leagueSiblings }]
            : []),
          { heading: `More from ${data.home}`, items: related.homeTeamOther },
          { heading: `More from ${data.away}`, items: related.awayTeamOther },
        ]}
      />

      <LedgerCallout />

      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
        {ANALYSIS_NOT_ADVICE}
      </p>
    </article>
  );
}
