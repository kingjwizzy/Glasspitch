import type { Metadata } from 'next';
import Link from 'next/link';
import AdSlot from '@/components/AdSlot';

export const metadata: Metadata = {
  title: 'Transparent football analysis',
  description:
    'Upcoming football matches with home/draw/away probabilities and predicted scores — analysis, not advice. Verify every call in our permanent public ledger.',
  alternates: { canonical: '/' },
};

export default function HomePage() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold tracking-tight">
          Football analysis you can check
        </h1>
        <p className="mt-2 text-black/70 dark:text-white/70">
          Home/draw/away probabilities and predicted scores for upcoming matches
          — framed as analysis and probability, never a guarantee. Every
          prediction is locked at kickoff and scored in a permanent public
          ledger, wins and losses alike.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/ledger"
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            See the track record
          </Link>
          <Link
            href="/about"
            className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20"
          >
            How it works
          </Link>
        </div>
      </section>

      <AdSlot slot="home-top" />

      <section aria-labelledby="featured-heading">
        <h2 id="featured-heading" className="text-lg font-semibold">
          Featured matches
        </h2>
        {/* TODO(ARCHITECTURE.md §8, §11): query upcoming fixtures + their primary
            prediction from Supabase (read-only anon client) and render a list of
            <MatchCard>. Data is served from Postgres only — never the football
            API on the request path (§5 golden rule). */}
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          Featured fixtures will appear here once the data pipeline is connected.
        </p>
      </section>
    </div>
  );
}
