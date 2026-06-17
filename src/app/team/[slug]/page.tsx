import type { Metadata } from 'next';

interface TeamPageProps {
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
}: TeamPageProps): Promise<Metadata> {
  const { slug } = await params;
  const name = slugToName(slug);
  // TODO(ARCHITECTURE.md §11): resolve the real team name from the DB by slug.
  return {
    title: `${name} — fixtures, form & probabilities`,
    description: `Upcoming and recent fixtures for ${name}, with home/draw/away probabilities and form. Analysis, not betting advice.`,
    alternates: { canonical: `/team/${slug}` },
  };
}

export default async function TeamPage({ params }: TeamPageProps) {
  const { slug } = await params;
  const name = slugToName(slug);
  // TODO(ARCHITECTURE.md §7, §8, §11): fetch the team by slug plus its upcoming
  // and recent fixtures from Supabase and render <MatchCard>s. Rendered with
  // ISR so pages stay fresh without per-request API calls (§11).
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        Fixtures, form and probabilities for {name} will appear here once the
        data pipeline is connected.
      </p>
    </div>
  );
}
