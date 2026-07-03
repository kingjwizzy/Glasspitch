// Shared JSON-LD helpers (ARCHITECTURE.md §11, §13). A single source for the
// safe-serialisation helper (previously duplicated near-identically across
// match/team/league pages) plus the site-wide Organization/WebSite blocks and
// the BreadcrumbList builder used by every DB-backed page. Every entity here is
// built from plain-text data already on the page (team/league/competition
// names) — never crests, badges or official marks (§13).

import { SITE_NAME, SITE_URL } from '@/lib/constants';

/**
 * Serialise JSON-LD for safe embedding in a `<script>` tag: escape the
 * characters that could otherwise break out of the element (defence in depth —
 * team/league/competition names come from the jobs feed, never a visitor).
 */
export function jsonLdScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

/** Site-wide Organization entity — name + url only, no logo/marks (§13).
 *  Rendered once, site-wide, in the root layout. */
export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
  };
}

/** Site-wide WebSite entity, so search engines can attribute every indexed
 *  page to one canonical site identity. Rendered once, site-wide, in the root
 *  layout, alongside `organizationJsonLd`. */
export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
  };
}

export interface BreadcrumbItem {
  name: string;
  /** Absolute or site-relative URL; relative paths are resolved against
   *  `SITE_URL`. */
  url: string;
}

/** A BreadcrumbList for a DB-backed page (match/team/league) — always starts
 *  from Home. Plain names only (§13); no ids beyond the page's own URL. */
export function breadcrumbJsonLd(items: BreadcrumbItem[]) {
  const trail: BreadcrumbItem[] = [{ name: SITE_NAME, url: '/' }, ...items];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url.startsWith('http') ? item.url : `${SITE_URL}${item.url}`,
    })),
  };
}
