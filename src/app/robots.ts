import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/constants';

// robots.txt (ARCHITECTURE.md §11). Allow indexing of everything; point crawlers
// at the generated sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    // The non-standard Host directive expects a bare hostname (no scheme).
    host: new URL(SITE_URL).host,
  };
}
