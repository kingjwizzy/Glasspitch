import 'server-only';
import { cache } from 'react';

// League page read layer (ARCHITECTURE.md §5, §7, §8, §11).
//
// The website only ever READS, from Supabase, with the publishable key under
// read-only RLS — it never calls the football API on the request path (§5 golden
// rule). The sentinel pattern (missing vs error) mirrors team.ts and match.ts:
// a missing league is a genuine 404; a transient DB error throws so ISR retries
// and the URL is never deindexed as gone.

import { getSupabaseClient } from '@/lib/supabaseClient';
import { MIN_SEASON } from '@/lib/constants';
import {
  buildScoredRecord,
  FIXTURE_ROW_SELECT,
  mapFixtureRow,
  partitionFixtures,
  type FixtureRowView,
  type RawFixtureRow,
} from './fixtures';
import { paginate, previewAllowed, withTimeout } from './shared';
import { previewLeagueData } from './league.preview';

export interface LeagueData {
  name: string;
  slug: string;
  country: string;
  season: number;
  upcoming: FixtureRowView[];
  recent: FixtureRowView[];
  /** Aggregate over recent rows that carry a scored prediction; null when
   *  there are no scored predictions in the league's fixture history. */
  record: { scored: number; hits: number; meanBrier: number | null } | null;
}

interface RawLeagueRow {
  id: number;
  name: string;
  slug: string;
  country: string;
  season: number;
}

// Sentinel distinguishing "the league genuinely does not exist" (→ 404) from
// "we could not reach the DB this time" (→ throw, so ISR retries) — mirrors
// team.ts / match.ts exactly.
type LeagueLoad = RawLeagueRow | 'missing' | 'error';

async function loadLeagueRow(slug: string): Promise<LeagueLoad> {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('leagues')
      .select('id, name, slug, country, season')
      .eq('slug', slug)
      .maybeSingle();
    if (error) return 'error';
    if (!data) return 'missing';
    return data as RawLeagueRow;
  } catch {
    return 'error';
  }
}

// All fixtures for one league. Best-effort: errors degrade to an empty list (the
// fixtures block hides rather than 500-ing the page — §5). The select is bounded
// (an unbounded select is silently row-capped by PostgREST, per homepage.ts); the
// cap is far above a single league-season's fixture count.
async function loadLeagueFixtures(leagueId: number): Promise<FixtureRowView[]> {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('fixtures')
      .select(FIXTURE_ROW_SELECT)
      .eq('league_id', leagueId)
      .gte('league.season', MIN_SEASON) // §5 season guard
      .order('kickoff_utc', { ascending: false })
      .limit(1000);
    if (error) return [];
    return ((data as unknown as RawFixtureRow[] | null) ?? []).map(mapFixtureRow);
  } catch {
    return [];
  }
}

async function load(slug: string): Promise<LeagueData | null> {
  // Step 1: resolve the league — missing → 404; error → throw (ISR retry).
  const leagueRes = await withTimeout<LeagueLoad>(loadLeagueRow(slug), 6000, 'error');
  if (leagueRes === 'missing') return null;
  if (leagueRes === 'error') throw new Error(`league read failed for slug "${slug}"`);
  const league = leagueRes;

  // Step 2: all fixtures for this league. Best-effort and timeout-guarded like
  // match.ts — a slow or failed read degrades the lists to empty, not a 500 (§5).
  const rows = await withTimeout(
    loadLeagueFixtures(league.id),
    6000,
    [] as FixtureRowView[],
  );
  const { upcoming, recent } = partitionFixtures(rows);

  const record = buildScoredRecord(recent);

  return {
    name: league.name,
    slug: league.slug,
    country: league.country,
    season: league.season,
    upcoming,
    recent,
    record,
  };
}

/**
 * Load one league for the page and its metadata. Wrapped in React `cache()` so
 * `generateMetadata` and the page body share a single DB read per request.
 *
 * `PREVIEW_LEAGUE` is a server-only dev/preview escape hatch (NOT a
 * NEXT_PUBLIC var, and requires the separate `ALLOW_PREVIEW=1` flag — see
 * `previewAllowed()` — so it can never activate on a real deploy): it returns
 * representative in-memory fixtures so league pages can be rendered and
 * screenshotted with no seeded database. It writes nothing.
 */
export const getLeagueData = cache(
  async (slug: string): Promise<LeagueData | null> => {
    if (!slug) return null;
    if (previewAllowed() && process.env.PREVIEW_LEAGUE) {
      return previewLeagueData(slug, process.env.PREVIEW_LEAGUE);
    }
    return load(slug);
  },
);

/**
 * All league slugs, for `generateStaticParams` (and the sitemap). Paginated
 * with `.range()` (§8): PostgREST silently caps an unbounded select at the
 * project's Max Rows setting (default 1000). Returns [] on any error so the
 * build never fails — unknown slugs fall through to on-demand ISR.
 */
export async function getAllLeagueSlugs(): Promise<string[]> {
  try {
    const sb = getSupabaseClient();
    const rows = await paginate<{ slug: string }>(async (from, to) => {
      const { data, error } = await sb.from('leagues').select('slug').range(from, to);
      if (error) return null;
      return data;
    });
    return rows.map((r) => r.slug);
  } catch {
    return [];
  }
}
