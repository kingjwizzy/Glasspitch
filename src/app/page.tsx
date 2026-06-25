import type { Metadata } from 'next';
import Link from 'next/link';
import AdSlot from '@/components/AdSlot';
import SectionHeader from '@/components/SectionHeader';
import HeroMatch from '@/components/home/HeroMatch';
import UpcomingFixtures from '@/components/home/UpcomingFixtures';
import WhatWeAreWatching from '@/components/home/WhatWeAreWatching';
import RecentCalls from '@/components/home/RecentCalls';
import RecordBand from '@/components/home/RecordBand';
import { getHomepageData } from '@/lib/queries/homepage';

export const metadata: Metadata = {
  title: 'Transparent football analysis',
  description:
    'Home, draw and away probabilities and predicted scores for upcoming matches — analysis, not advice. Every call is locked at kickoff and scored in a permanent public ledger.',
  alternates: { canonical: '/' },
};

// ISR: the page re-renders at most every 10 minutes — matchday-fresh without any
// per-visitor work, and never calls the football API on the request path
// (ARCHITECTURE.md §5, §8, §11). Reads come only from Supabase.
export const revalidate = 600;

export default async function HomePage() {
  const { hero, upcoming, watching, recentCalls, record } =
    await getHomepageData();
  const heroHeading = hero?.status === 'live' ? 'Live now' : 'Next match';

  return (
    <div className="space-y-10">
      {/* Identity + the one primary action (DESIGN.md §4, §9). */}
      <section>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
          Football analysis you can check
        </h1>
        <p className="mt-2 max-w-prose text-fg-dim">
          Home, draw and away probabilities and a predicted score for every
          match — locked at kickoff and scored in a permanent public ledger,
          wins and losses alike. Analysis, not betting advice.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/ledger"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-green px-4 text-sm font-medium text-bg transition-colors hover:bg-green-bright"
          >
            See the track record
          </Link>
          <Link
            href="/about"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-4 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
          >
            How it works
          </Link>
        </div>
      </section>

      {/* Reserved ad slot — built-ready but renders nothing in v1 (§4, §13). */}
      <AdSlot slot="home-top" />

      {/* Hero: the live or next match with our locked call. */}
      <section aria-labelledby="hero-heading">
        <SectionHeader id="hero-heading" title={heroHeading} />
        {hero ? (
          <HeroMatch fixture={hero} />
        ) : (
          <div className="rounded-2xl border border-line bg-surface p-6 text-center">
            <p className="text-sm text-fg-dim">
              No match scheduled right now — the next fixtures will appear here on
              matchday.
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby="upcoming-heading">
        <SectionHeader id="upcoming-heading" title="Upcoming" />
        <UpcomingFixtures fixtures={upcoming} />
      </section>

      <section aria-labelledby="watching-heading">
        <SectionHeader id="watching-heading" title="What we're watching" />
        <WhatWeAreWatching fixtures={watching} />
      </section>

      <section aria-labelledby="recent-heading">
        <SectionHeader
          id="recent-heading"
          title="How recent calls landed"
          href="/ledger"
          linkLabel="Full record"
        />
        <RecentCalls calls={recentCalls} />
      </section>

      <section aria-labelledby="record-heading">
        <h2 id="record-heading" className="sr-only">
          Our running record
        </h2>
        <RecordBand record={record} />
      </section>
    </div>
  );
}
