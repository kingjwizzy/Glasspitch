import type { Metadata } from 'next';
import Link from 'next/link';
import AdSlot from '@/components/AdSlot';
import SectionHeader from '@/components/SectionHeader';
import StadiumHero from '@/components/art/StadiumHero';
import ChancesCloud from '@/components/chances/ChancesCloud';
import ChancesEmpty from '@/components/chances/ChancesEmpty';
import ChancesProvenance from '@/components/chances/ChancesProvenance';
import FeaturedMatch from '@/components/home/FeaturedMatch';
import HowItWorks from '@/components/home/HowItWorks';
import ProofRail from '@/components/home/ProofRail';
import UpcomingFixtures from '@/components/home/UpcomingFixtures';
import WhatWeAreWatching from '@/components/home/WhatWeAreWatching';
import RecentCalls from '@/components/home/RecentCalls';
import RecordBand from '@/components/home/RecordBand';
import GoldenBootRace from '@/components/home/GoldenBootRace';
import SignupCard from '@/components/home/SignupCard';
import TitleRaceMover from '@/components/home/TitleRaceMover';
import ShareRow from '@/components/ShareRow';
import { ArrowRightIcon } from '@/components/icons';
import { getHomepageData } from '@/lib/queries/homepage';
import { getGoldenBootTop5 } from '@/lib/queries/goldenBoot';
import { biggestMover, getChancesData } from '@/lib/queries/chances';
import { formatFullDate, formatTimeUtc, updatedStamp, utcDateKey } from '@/lib/format';
import { SITE_NAME, SITE_URL } from '@/lib/constants';

// `title.template` (`%s · Glass Pitch`, defined in the root layout) applies only
// to CHILD segments, never to the home page itself — so the page needs an
// explicit, branded title to match the "· Glass Pitch" pattern the other routes
// get for free. `absolute` bypasses the template (belt-and-braces against any
// double-suffix). (ARCHITECTURE.md §11)
//
// WC-WINDOW SEO (audit #10): "World Cup 2026" is front-loaded into the title,
// description and <h1> below while the tournament is live/imminent (final
// 2026-07-19) — the highest-intent search terms right now. REVERT to the
// evergreen, competition-agnostic copy (commented alongside each) once the
// tournament ends in August — Glass Pitch covers more than one competition.
const HOME_TITLE = `World Cup 2026 predictions & analysis · ${SITE_NAME}`;
// const HOME_TITLE = `Transparent football analysis · ${SITE_NAME}`; // evergreen — restore in August
const HOME_DESCRIPTION =
  'World Cup 2026 predictions: home, draw and away probabilities and predicted scores for every match — analysis, not advice. Every call is locked at kickoff and scored in a permanent public ledger.';
// const HOME_DESCRIPTION =
//   'Home, draw and away probabilities and predicted scores for upcoming matches — analysis, not advice. Every call is locked at kickoff and scored in a permanent public ledger.'; // evergreen — restore in August

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  alternates: { canonical: '/' },
  // Self-referential og:url (resolved against metadataBase). openGraph fully
  // replaces the layout's object, so siteName must be restated or the share
  // card loses the brand. (ARCHITECTURE.md §11)
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    url: '/',
  },
  twitter: { card: 'summary_large_image', title: HOME_TITLE, description: HOME_DESCRIPTION },
};

// ISR: the page re-renders at most every 10 minutes — matchday-fresh without any
// per-visitor work, and never calls the football API on the request path
// (ARCHITECTURE.md §5, §8, §11). Reads come only from Supabase. Everything
// below is computed ONCE at render time, so the page stays fully static and
// byte-identical for every visitor (times/counts are honest "as of" values —
// see the freshness stamp — never per-visitor clocks).
export const revalidate = 600;

export default async function HomePage() {
  const [
    { hero, live, upcoming, finishedToday, watching, recentCalls, record },
    goldenBoot,
    chances,
  ] = await Promise.all([getHomepageData(), getGoldenBootTop5(), getChancesData()]);
  const renderedAt = new Date().toISOString();
  const todayKey = utcDateKey(renderedAt);

  // The matchday stream: any other live matches, today's finished fixtures,
  // then everything upcoming (the hero is featured above, not repeated).
  const stream = [
    ...live.filter((f) => f.id !== hero?.id),
    ...finishedToday,
    ...upcoming,
  ];
  const streamHasToday = stream.some((f) => utcDateKey(f.kickoff_utc) === todayKey);
  const titleRaceMover = biggestMover(chances.teams);

  // "Also today" — one factual mono summary, counts computed server-side.
  const nextToday = upcoming.find((f) => utcDateKey(f.kickoff_utc) === todayKey);
  const alsoTodayParts: string[] = [];
  if (live.length > 0) alsoTodayParts.push(`${live.length} live now`);
  if (finishedToday.length > 0) alsoTodayParts.push(`${finishedToday.length} finished`);
  if (nextToday && nextToday.id !== hero?.id) {
    alsoTodayParts.push(`next kickoff ${formatTimeUtc(nextToday.kickoff_utc)} UTC`);
  }
  const alsoToday = alsoTodayParts.join(' · ');

  return (
    // Vertical rhythm (RAMBO wave 3 #10a): an 8pt-anchored, gentler step
    // (48px → 64px) replacing the old 40px → 96px chasm — the same cadence
    // as ledger/page.tsx and match/[id]/page.tsx so the flagship pages
    // breathe identically.
    <div className="space-y-12 lg:space-y-16">
      {/* ── Matchday hero band: featured match + ledger proof rail (W4 §1).
          The page's ONE floodlight pool sits under this band. ────────────── */}
      <section aria-labelledby="home-kicker" className="floodlight">
        {/* Whisper-opacity stadium flourish behind the hero (W6 visual pack) —
            layers with the floodlight pool inside this section's isolation;
            text contrast is untouched (DESIGN.md §7). */}
        <StadiumHero />
        <div className="rise-in">
          <h1
            id="home-kicker"
            className="font-display text-display font-semibold tracking-tight text-fg lg:text-[28px]"
          >
            {/* WC-window h1 (see HOME_TITLE note above) — revert to "Football
                analysis you can check" once the tournament ends in August. */}
            World Cup 2026 predictions you can check
          </h1>
          {/* Calm hero subhead (RAMBO wave 3 #3b): names the category and
              carries the "not tips" compliance framing as a brand line, not a
              scary banner — --fg-dim, no box, no alarm colour. ~46ch "lede"
              measure (matches SectionHeader/RecordBand's own lede width; kept
              as a literal here since no new width token is authorised this
              batch — type-scale tokens only). */}
          <p className="mt-1.5 max-w-[46ch] text-fg-dim">
            Free World Cup match analysis — probabilities, not tips. Every
            call locked at kickoff, scored either way.
          </p>
          <p className="mt-2 font-mono text-micro text-fg-dim">
            {updatedStamp(renderedAt)}
          </p>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-12 lg:gap-8">
          <div className="rise-in rise-in-1 lg:col-span-7">
            {hero ? (
              <FeaturedMatch fixture={hero} renderedAt={renderedAt} />
            ) : (
              <div className="glass p-6">
                <p className="text-sm text-fg-dim">
                  No match scheduled right now — the next fixtures will appear here
                  on matchday.
                </p>
              </div>
            )}
            {alsoToday && (
              <p className="mt-3 font-mono text-xs text-fg-dim">
                Also today: {alsoToday}
              </p>
            )}
          </div>
          <div className="lg:col-span-5">
            <ProofRail calls={recentCalls} record={record} />
          </div>
        </div>
      </section>

      {/* Reserved ad slot — built-ready but renders nothing in v1 (§4, §13).
          Below the whole hero band so an empty div never separates headline
          and match (W4 §1). */}
      <AdSlot slot="home-top" />

      {/* ── How it works — the honest-loop strip (RAMBO wave 3 #7b),
          promoted from empty-state-only decoration to an always-present,
          labelled explanation. Fills the gap the empty ad slot leaves. ───── */}
      <section aria-labelledby="how-it-works-heading">
        <HowItWorks />
      </section>

      {/* ── World Cup chances — the owner's flagship circles, full-width
          directly under the hero band (W6; ROADMAP.md §4 item 7). Honest
          structural empty state until the nightly sim first runs. ───────── */}
      <section aria-labelledby="chances-heading" className="reveal">
        <SectionHeader
          id="chances-heading"
          title="World Cup chances"
          description="Every nation still in it, sized by its chance of winning the trophy."
          href="/chances"
          linkLabel="The full picture"
        />
        {titleRaceMover && (
          <div className="mb-4">
            <TitleRaceMover mover={titleRaceMover} />
          </div>
        )}
        {chances.teams.length > 0 ? (
          <>
            <ChancesCloud teams={chances.teams} />
            <ChancesProvenance
              sims={chances.sims}
              snapshotDate={chances.snapshotDate}
            />
          </>
        ) : (
          <ChancesEmpty />
        )}
      </section>

      {/* ── Today & upcoming — the matchday stream (W4 §2). ─────────────── */}
      <section aria-labelledby="stream-heading" className="reveal">
        <SectionHeader
          id="stream-heading"
          title={streamHasToday ? "Today's matches" : 'Upcoming matches'}
          description={formatFullDate(renderedAt)}
        />
        <UpcomingFixtures fixtures={stream} renderedAt={renderedAt} />
      </section>

      {/* ── What we're watching (W4 §3). ─────────────────────────────────── */}
      <section aria-labelledby="watching-heading" className="reveal">
        <SectionHeader
          id="watching-heading"
          title="What we're watching"
          description="The model's tightest calls of the round — context, never a tip."
        />
        <WhatWeAreWatching fixtures={watching} />
      </section>

      {/* ── Beat the model — the free prediction game, given a first-class
          body surface instead of living only in nav/footer (audit #8/#22:
          the viral loop was orphaned). Plain CTA, no scarcity, no streaks. ── */}
      <section aria-labelledby="play-heading" className="reveal">
        <SectionHeader
          id="play-heading"
          title="Beat the model — free to play"
          description="Call each fixture yourself before kickoff, Brier-scored exactly like our own ledger."
        />
        <div className="glass flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between lg:p-8">
          <p className="max-w-[46ch] text-sm text-fg-dim">
            Free and prize-free, always — track your own record against the
            model&rsquo;s.
          </p>
          <Link
            href="/play"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-lg bg-green px-5 text-sm font-medium text-bg transition-colors hover:bg-green-bright"
          >
            Make your first call
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      {/* ── Receipts beside the Golden Boot — the 7/5 band (W4 §4–§5).
          DOM order = reading order: trust content first. ─────────────────── */}
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
        <section aria-labelledby="recent-heading" className="reveal lg:col-span-7">
          <SectionHeader
            id="recent-heading"
            title="How recent calls landed"
            description="Are our predictions any good? Every one is on the record — judge for yourself."
            href="/ledger"
            linkLabel="Full record"
          />
          <RecentCalls calls={recentCalls} />
          {/* Share loop (audit #9) — honest, subtle; only offered once there's
              an actual record to point at. */}
          {recentCalls.length > 0 && (
            <ShareRow
              className="mt-4"
              url={`${SITE_URL}/ledger`}
              title="Glass Pitch — the scored prediction ledger"
              text="Glass Pitch called it — see the scored record, misses included."
            />
          )}
        </section>

        <section aria-labelledby="golden-boot-heading" className="reveal lg:col-span-5">
          <SectionHeader
            id="golden-boot-heading"
            title="Golden Boot race"
            href="/stats/golden-boot"
            linkLabel="Full standings"
          />
          <GoldenBootRace scorers={goldenBoot} />
        </section>
      </div>

      {/* ── The record band — accountability end-cap (W4 §6). ────────────── */}
      <section aria-labelledby="record-heading" className="reveal">
        <RecordBand record={record} />
      </section>

      {/* ── The one quiet premium mention in the page body (audit #18;
          DESIGN.md §6: exactly one, plain, no pressure) — placed right after
          the record so the context is obvious: premium adds depth around the
          record, it never changes it or the free calls. ───────────────────── */}
      <section aria-labelledby="premium-heading" className="reveal">
        <div className="mx-auto max-w-xl rounded-xl border border-line bg-surface px-5 py-4 text-center">
          <h2 id="premium-heading" className="text-sm font-medium text-fg">
            Want more depth?
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-fg-dim">
            Premium adds prediction detail, post-match stats, and ledger
            export/filters — the record above and every prediction stay free,
            always.
          </p>
          <Link
            href="/premium"
            className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-green transition-colors hover:text-green-bright"
          >
            See what&rsquo;s included
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      {/* ── The single sign-up affordance in the page body (W4 §7). ──────── */}
      <section aria-labelledby="signup-heading" className="reveal">
        <SignupCard />
      </section>
    </div>
  );
}
