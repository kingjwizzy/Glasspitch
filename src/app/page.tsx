import type { Metadata } from 'next';
import AdSlot from '@/components/AdSlot';
import SectionHeader from '@/components/SectionHeader';
import FeaturedMatch from '@/components/home/FeaturedMatch';
import ProofRail from '@/components/home/ProofRail';
import UpcomingFixtures from '@/components/home/UpcomingFixtures';
import WhatWeAreWatching from '@/components/home/WhatWeAreWatching';
import RecentCalls from '@/components/home/RecentCalls';
import RecordBand from '@/components/home/RecordBand';
import GoldenBootRace from '@/components/home/GoldenBootRace';
import SignupCard from '@/components/home/SignupCard';
import { getHomepageData } from '@/lib/queries/homepage';
import { getGoldenBootTop5 } from '@/lib/queries/goldenBoot';
import { formatFullDate, formatTimeUtc, updatedStamp, utcDateKey } from '@/lib/format';
import { SITE_NAME } from '@/lib/constants';

// `title.template` (`%s · Glass Pitch`, defined in the root layout) applies only
// to CHILD segments, never to the home page itself — so the page needs an
// explicit, branded title to match the "· Glass Pitch" pattern the other routes
// get for free. `absolute` bypasses the template (belt-and-braces against any
// double-suffix). (ARCHITECTURE.md §11)
const HOME_TITLE = `Transparent football analysis · ${SITE_NAME}`;
const HOME_DESCRIPTION =
  'Home, draw and away probabilities and predicted scores for upcoming matches — analysis, not advice. Every call is locked at kickoff and scored in a permanent public ledger.';

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
  ] = await Promise.all([getHomepageData(), getGoldenBootTop5()]);
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
    <div className="space-y-10 lg:space-y-24">
      {/* ── Matchday hero band: featured match + ledger proof rail (W4 §1).
          The page's ONE floodlight pool sits under this band. ────────────── */}
      <section aria-labelledby="home-kicker" className="floodlight">
        <div className="rise-in">
          <h1
            id="home-kicker"
            className="font-display text-[22px] font-semibold tracking-tight text-fg lg:text-[28px]"
          >
            Football analysis you can check
          </h1>
          <p className="mt-1 max-w-[38ch] text-fg-dim">
            Every call locked at kickoff, scored either way.
          </p>
          <p className="mt-2 font-mono text-[11px] leading-4 text-fg-dim">
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

      {/* ── The single sign-up affordance in the page body (W4 §7). ──────── */}
      <section aria-labelledby="signup-heading" className="reveal">
        <SignupCard />
      </section>
    </div>
  );
}
