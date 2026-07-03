import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/constants';
import { getAllTeamSlugs } from '@/lib/queries/team';
import { getAllLeagueSlugs } from '@/lib/queries/league';
import { getSitemapFixtures } from '@/lib/queries/fixtures';

// Sitemap (ARCHITECTURE.md §8, §11). The static pages, every DB-backed team and
// league page, AND every match page — ARCHITECTURE.md §11 calls per-match
// pages "the growth engine", so they must be discoverable here, not only via
// internal links.
//
// Read-only, like every web read (§5 golden rule): the slug/fixture helpers go
// through the publishable key under read-only RLS, are bounded/paginated
// (§8 — PostgREST silently caps an unbounded select at 1000 rows) and degrade
// to [] on any error, so a transient DB blip yields a smaller sitemap rather
// than a failed build. ISR (revalidate below) regenerates it hourly, so newly
// added teams/leagues/matches enter the sitemap without a redeploy.
export const revalidate = 3600;

/** 'hourly' near kickoff (freshest matchday content), 'monthly' once scored
 *  (a finished, scored record rarely changes), 'daily' otherwise. */
function matchChangeFrequency(
  kickoffUtc: string,
  status: string,
): MetadataRoute.Sitemap[number]['changeFrequency'] {
  if (status === 'finished') return 'monthly';
  if (status === 'live') return 'hourly';
  const hoursToKickoff = Math.abs(new Date(kickoffUtc).getTime() - Date.now()) / 36e5;
  return hoursToKickoff < 24 ? 'hourly' : 'daily';
}

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

  const [teamSlugs, leagueSlugs, fixtures] = await Promise.all([
    getAllTeamSlugs(),
    getAllLeagueSlugs(),
    getSitemapFixtures(),
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

  const matchRoutes: MetadataRoute.Sitemap = fixtures.map((f) => ({
    url: `${SITE_URL}/match/${f.id}`,
    // Scored/finished: the last DB write is the meaningful "last modified".
    // Otherwise the kickoff time itself is more meaningful than row metadata.
    lastModified: f.status === 'finished' ? new Date(f.updatedAt) : new Date(f.kickoffUtc),
    changeFrequency: matchChangeFrequency(f.kickoffUtc, f.status),
    priority: 0.5,
  }));

  return [...staticRoutes, ...leagueRoutes, ...teamRoutes, ...matchRoutes];
}
