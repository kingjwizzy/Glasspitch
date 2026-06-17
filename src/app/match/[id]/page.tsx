import type { Metadata } from 'next';
import ProbabilityBar from '@/components/ProbabilityBar';
import AdSlot from '@/components/AdSlot';
import { ANALYSIS_NOT_ADVICE, THIRD_PARTY_LABEL } from '@/lib/constants';

interface MatchPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: MatchPageProps): Promise<Metadata> {
  const { id } = await params;
  // TODO(ARCHITECTURE.md §11): look up the fixture by id to build a title like
  // "Home v Away — probabilities & predicted score". Using the id keeps titles
  // unique per route until DB lookups are wired in.
  return {
    title: `Match ${id} — probabilities & predicted score`,
    description: `Home/draw/away probabilities, predicted score and form for match ${id}. Analysis, not betting advice.`,
    alternates: { canonical: `/match/${id}` },
  };
}

export default async function MatchPage({ params }: MatchPageProps) {
  const { id } = await params;
  // TODO(ARCHITECTURE.md §7, §8): fetch the fixture, teams, recent form and the
  // primary (third-party, labelled) prediction from Supabase. Hide the
  // prediction block if missing; never block the page (§5 failure handling).
  // The placeholder probabilities below illustrate the layout only.
  const placeholder = { home: 0.45, draw: 0.27, away: 0.28 };

  return (
    <article className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50">
          Match analysis
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Match #{id}</h1>
      </header>

      <section
        aria-labelledby="prob-heading"
        className="rounded-lg border border-black/10 p-4 dark:border-white/15"
      >
        <h2 id="prob-heading" className="text-lg font-semibold">
          Outcome probabilities
        </h2>
        <ProbabilityBar
          className="mt-3"
          home={placeholder.home}
          draw={placeholder.draw}
          away={placeholder.away}
        />
        <p className="mt-3 text-xs text-black/50 dark:text-white/50">
          Sample layout — live probabilities from the database are pending (§8).
        </p>
        <p className="mt-2 text-xs text-black/60 dark:text-white/60">
          {THIRD_PARTY_LABEL}
        </p>
      </section>

      <AdSlot slot="match-top" />

      <section aria-labelledby="read-heading">
        <h2 id="read-heading" className="text-lg font-semibold">
          The read
        </h2>
        {/* TODO(ARCHITECTURE.md §4, §9): template-driven, plain-language read of
            the matchup, generated from stored data (not the API on request). */}
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          A short plain-language read of the matchup will appear here.
        </p>
      </section>

      <p className="rounded-md bg-black/5 p-3 text-xs text-black/70 dark:bg-white/10 dark:text-white/70">
        {ANALYSIS_NOT_ADVICE}
      </p>
    </article>
  );
}
