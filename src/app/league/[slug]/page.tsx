import type { Metadata } from 'next';

interface LeaguePageProps {
  params: Promise<{ slug: string }>;
}

function slugToName(slug: string): string {
  return slug
    .split('-')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

export async function generateMetadata({
  params,
}: LeaguePageProps): Promise<Metadata> {
  const { slug } = await params;
  const name = slugToName(slug);
  // TODO(ARCHITECTURE.md §11): resolve the real league name from the DB by slug.
  return {
    title: `${name} — fixtures & probabilities`,
    description: `Upcoming ${name} fixtures with home/draw/away probabilities and predicted scores. Analysis, not betting advice.`,
    alternates: { canonical: `/league/${slug}` },
  };
}

export default async function LeaguePage({ params }: LeaguePageProps) {
  const { slug } = await params;
  const name = slugToName(slug);
  // TODO(ARCHITECTURE.md §7, §8, §11): fetch the league by slug plus its
  // fixtures list from Supabase and render <MatchCard>s. ISR (§11).
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        Fixtures and probabilities for {name} will appear here once the data
        pipeline is connected.
      </p>
    </div>
  );
}
