import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/constants';

// Static stub sitemap (ARCHITECTURE.md §11).
// TODO(ARCHITECTURE.md §8, §11): generate per-match/team/league URLs from the
// database — these are the growth engine — once the data pipeline is populated.
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ['', '/ledger', '/about', '/responsible-gambling'];
  return routes.map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path === '' ? 'daily' : 'weekly',
    priority: path === '' ? 1 : 0.6,
  }));
}
