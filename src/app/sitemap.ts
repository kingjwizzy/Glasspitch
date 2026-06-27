import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/constants';
import { getAllTeamSlugs } from '@/lib/queries/team';
import { getAllLeagueSlugs } from '@/lib/queries/league';

// Sitemap (ARCHITECTURE.md §8, §11). The static pages PLUS every DB-backed team
// and league page — the indexable content surface that is the growth engine.
//
// Read-only, like every web read (§5 golden rule): the slug helpers go through
// the publishable key under read-only RLS and degrade to [] on any error, so a
// transient DB blip yields a smaller sitemap rather than a failed build. ISR
// (revalidate below) regenerates it hourly, so newly-added teams/leagues enter
// the sitemap without a redeploy.
//
// TODO(§8, §11): per-match URLs once there is a fixtures-id reader — deferred
// here to keep this change scoped to the team/league surface.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}`, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/ledger`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/about`, changeFrequency: 'weekly', priority: 0.6 },
    {
      url: `${SITE_URL}/responsible-gambling`,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
  ];

  const [teamSlugs, leagueSlugs] = await Promise.all([
    getAllTeamSlugs(),
    getAllLeagueSlugs(),
  ]);

  const leagueRoutes: MetadataRoute.Sitemap = leagueSlugs.map((slug) => ({
    url: `${SITE_URL}/league/${slug}`,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  const teamRoutes: MetadataRoute.Sitemap = teamSlugs.map((slug) => ({
    url: `${SITE_URL}/team/${slug}`,
    changeFrequency: 'weekly',
    priority: 0.6,
  }));

  return [...staticRoutes, ...leagueRoutes, ...teamRoutes];
}
