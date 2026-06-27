import 'server-only';
import { cache } from 'react';

// Team page read layer (ARCHITECTURE.md §5, §7, §8, §11).
//
// The website only ever READS, from Supabase, with the publishable key under
// read-only RLS — it never calls the football API on the request path (§5 golden
// rule). The sentinel pattern (missing vs error) mirrors match.ts exactly: a
// missing team is a genuine 404; a transient DB error throws so ISR retries and
// the URL is never deindexed as gone. Form is best-effort context; it degrades to
// [] via withTimeout rather than blocking the page (§5 failure handling).

import { getSupabaseClient } from '@/lib/supabaseClient';
import {
  buildScoredRecord,
  FIXTURE_ROW_SELECT,
  mapFixtureRow,
  partitionFixtures,
  type FixtureRowView,
  type RawFixtureRow,
} from './fixtures';
import type { FormResult } from './match';
import { one, withTimeout } from './shared';
import { previewTeamData } from './team.preview';

export interface TeamData {
  name: string;
  slug: string;
  /** Competition name, e.g. "World Cup". */
  league: string;
  /** Competition slug, e.g. "world-cup". */
  leagueSlug: string;
  upcoming: FixtureRowView[];
  recent: FixtureRowView[];
  /** Last 5 finished results from this team's perspective, oldest → newest. */
  form: FormResult[];
  /** Aggregate over recent rows that carry a scored prediction; null when
   *  there are no scored predictions in the team's fixture history. */
  record: { scored: number; hits: number; meanBrier: number | null } | null;
}

const FORM_LIMIT = 5;

// Re-use the same FK-disambiguated form query from match.ts — separate select
// so the form query only pulls the columns it needs rather than the full
// FIXTURE_ROW_SELECT payload.
const FORM_SELECT = `
  id, kickoff_utc, home_team_id, away_team_id, final_home_goals, final_away_goals,
  home_team:teams!fixtures_home_team_id_fkey(name),
  away_team:teams!fixtures_away_team_id_fkey(name)
`;

interface RawTeamRow {
  id: number;
  name: string;
  slug: string;
  league_id: number;
}
interface RawFormTeam {
  name: string;
}
interface RawFormFixture {
  id: number;
  kickoff_utc: string;
  home_team_id: number;
  away_team_id: number;
  final_home_goals: number | null;
  final_away_goals: number | null;
  home_team: RawFormTeam | RawFormTeam[] | null;
  away_team: RawFormTeam | RawFormTeam[] | null;
}

// Sentinel distinguishing "the team genuinely does not exist" (→ 404) from
// "we could not reach the DB this time" (→ throw, so ISR retries and the URL
// is not deindexed as gone) — mirrors match.ts exactly.
type TeamLoad = RawTeamRow | 'missing' | 'error';

async function loadTeamRow(slug: string): Promise<TeamLoad> {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('teams')
      .select('id, name, slug, league_id')
      .eq('slug', slug)
      .maybeSingle();
    if (error) return 'error';
    if (!data) return 'missing';
    return data as RawTeamRow;
  } catch {
    return 'error';
  }
}

async function loadTeamForm(teamId: number): Promise<FormResult[]> {
  const sb = getSupabaseClient();
  const { data } = await sb
    .from('fixtures')
    .select(FORM_SELECT)
    .eq('status', 'finished')
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order('kickoff_utc', { ascending: false })
    .limit(FORM_LIMIT);

  const rows = (data as unknown as RawFormFixture[] | null) ?? [];
  const results: FormResult[] = [];
  for (const r of rows) {
    if (r.final_home_goals === null || r.final_away_goals === null) continue;
    const isHome = r.home_team_id === teamId;
    const gf = isHome ? r.final_home_goals : r.final_away_goals;
    const ga = isHome ? r.final_away_goals : r.final_home_goals;
    const opponent = (isHome ? one(r.away_team) : one(r.home_team))?.name ?? 'Unknown';
    results.push({
      outcome: gf > ga ? 'W' : gf < ga ? 'L' : 'D',
      gf,
      ga,
      opponent,
      home: isHome,
      fixtureId: r.id,
      kickoff_utc: r.kickoff_utc,
    });
  }
  // Query is newest-first; reverse so the rightmost form chip is the most
  // recent match (the usual reading direction of a form strip).
  return results.reverse();
}

// All fixtures for one team (home or away). Best-effort: errors degrade to an
// empty list (the fixtures block hides rather than 500-ing the page — §5). The
// select is bounded (an unbounded select is silently row-capped by PostgREST,
// per homepage.ts); the cap is far above any single team's fixture count.
async function loadTeamFixtures(teamId: number): Promise<FixtureRowView[]> {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('fixtures')
      .select(FIXTURE_ROW_SELECT)
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .order('kickoff_utc', { ascending: false })
      .limit(500);
    if (error) return [];
    return ((data as unknown as RawFixtureRow[] | null) ?? []).map(mapFixtureRow);
  } catch {
    return [];
  }
}

async function load(slug: string): Promise<TeamData | null> {
  // Step 1: resolve the team — missing → 404; error → throw (ISR retry).
  const teamRes = await withTimeout<TeamLoad>(loadTeamRow(slug), 6000, 'error');
  if (teamRes === 'missing') return null;
  if (teamRes === 'error') throw new Error(`team read failed for slug "${slug}"`);
  const team = teamRes;

  const sb = getSupabaseClient();

  // Step 2: league name + slug — separate query; do NOT guess the teams→leagues
  // FK embed name (ARCHITECTURE.md §7 specifies the exact constraint names only
  // for fixtures, not for teams→leagues). Best-effort: falls back to empty string.
  const { data: leagueData } = await sb
    .from('leagues')
    .select('name, slug')
    .eq('id', team.league_id)
    .maybeSingle();
  const league = leagueData as { name: string; slug: string } | null;

  // Step 3: all fixtures for this team (home or away). Best-effort and
  // timeout-guarded like match.ts — a slow or failed fixtures read degrades the
  // lists to empty rather than 500-ing the page (§5).
  const rows = await withTimeout(
    loadTeamFixtures(team.id),
    6000,
    [] as FixtureRowView[],
  );
  const { upcoming, recent } = partitionFixtures(rows);

  // Step 4: form — best-effort context; never blocks the page (§5).
  const form = await withTimeout(loadTeamForm(team.id), 5000, [] as FormResult[]);

  // Step 5: record over scored calls (shared rule with the league page + previews).
  const record = buildScoredRecord(recent);

  return {
    name: team.name,
    slug: team.slug,
    league: league?.name ?? '',
    leagueSlug: league?.slug ?? '',
    upcoming,
    recent,
    form,
    record,
  };
}

/**
 * Load one team for the page and its metadata. Wrapped in React `cache()` so
 * `generateMetadata` and the page body share a single DB read per request.
 *
 * `PREVIEW_TEAM` is a server-only dev/preview escape hatch (NOT a NEXT_PUBLIC
 * var, never set in production): it returns representative in-memory fixtures
 * so team pages can be rendered and screenshotted with no seeded database.
 * It writes nothing.
 */
export const getTeamData = cache(
  async (slug: string): Promise<TeamData | null> => {
    if (!slug) return null;
    if (process.env.PREVIEW_TEAM) return previewTeamData(slug, process.env.PREVIEW_TEAM);
    return load(slug);
  },
);

/**
 * All team slugs, for `generateStaticParams`. Returns [] on any error so the
 * build never fails — unknown slugs fall through to on-demand ISR.
 */
export async function getAllTeamSlugs(): Promise<string[]> {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb.from('teams').select('slug');
    if (error || !data) return [];
    return (data as Array<{ slug: string }>).map((r) => r.slug);
  } catch {
    return [];
  }
}
