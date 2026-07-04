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

/** Upcoming/live fixtures are the growth-engine crawl target (audit #10) —
 *  raised above the flat baseline every match page used to share. A finished,
 *  already-scored match keeps the original baseline rather than being pushed
 *  down, since it may already be indexed/ranking. `SitemapFixture` doesn't
 *  carry the fixture's knockout `round` label (see needs_from_others in this
 *  task's return), so this is status-based only, not a true
 *  group-vs-knockout split. */
function matchPriority(status: string): number {
  return status === 'finished' ? 0.5 : 0.8;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}`, changeFrequency: 'daily', priority: 1 },
    // The fixtures crawl hub (ARCHITECTURE.md §11 "the growth engine") — every
    // match page it lists is discoverable from here too, not only below.
    { url: `${SITE_URL}/matches`, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${SITE_URL}/leagues`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/ledger`, changeFrequency: 'weekly', priority: 0.6 },
    {
      url: `${SITE_URL}/stats/golden-boot`,
      changeFrequency: 'daily',
      priority: 0.5,
    },
    // W6 public surfaces: the free Gameweek Board + Fixture Ticker (nightly
    // data) and the /play explainer (the game itself is authed and noindexed
    // — only the public landing view belongs here).
    // W6: World Cup chances — the daily-simulated flagship (public ISR). Kept
    // above the static/legal pages below (audit #10 — key hubs outrank
    // evergreen static content during the tournament window).
    { url: `${SITE_URL}/chances`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/board`, changeFrequency: 'daily', priority: 0.7 },
    { url: `${SITE_URL}/board/ticker`, changeFrequency: 'daily', priority: 0.5 },
    { url: `${SITE_URL}/play`, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${SITE_URL}/about`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/methodology`, changeFrequency: 'monthly', priority: 0.5 },
    {
      url: `${SITE_URL}/responsible-gambling`,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    // Static legal pages (v2). Everything auth/account/premium-gated is
    // deliberately NOT listed here — noindexed and out of the sitemap until
    // the owner flips premium live (ARCHITECTURE.md §13). This includes
    // /premium itself: unlike its own page-level `robots` (which already
    // flips to indexable at NEXT_PUBLIC_PREMIUM_LIVE==='1'), the sitemap has
    // no matching conditional entry for it yet — left as a follow-up rather
    // than added here (audit #10 item 4).
    { url: `${SITE_URL}/privacy`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/refunds`, changeFrequency: 'monthly', priority: 0.3 },
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
    priority: matchPriority(f.status),
  }));

  return [...staticRoutes, ...leagueRoutes, ...teamRoutes, ...matchRoutes];
}
