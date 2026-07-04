import 'server-only';
import { cache } from 'react';

// Dense on-page internal linking for SEO (ARCHITECTURE.md §11: thousands of
// indexable match/team/league pages are "the growth engine", but only if they
// actually link to each other, not just from the sitemap). getRelatedFixtures
// returns, for ONE fixture, a handful of small groups of OTHER fixtures worth
// linking to from its page: the same UTC day's other matches, siblings in the
// same competition, and each side's other fixtures — nearest in time first.
//
// Every group is self-excluded (a fixture never links to itself) and
// deduplicated across groups in priority order (same day > competition >
// home team > away team), so a fixture that would qualify for two groups is
// only ever linked once from a given page — dense linking, not a link farm.
//
// Read-only, publishable key, RLS-enforced (§5 golden rule); a missing source
// fixture or any read failure degrades to an all-empty result rather than
// throwing — this is a secondary, "more to explore" surface, never the thing
// that should break a page that would otherwise render fine.

import { getSupabaseClient } from '@/lib/supabaseClient';
import { MIN_SEASON } from '@/lib/constants';
import { utcDateKey } from '@/lib/format';
import type { FixtureStatus } from '@/lib/types';
import { one } from './shared';

export interface RelatedFixtureItem {
  id: number;
  kickoff_utc: string;
  status: FixtureStatus;
  home: string;
  away: string;
  final_home_goals: number | null;
  final_away_goals: number | null;
}

export interface RelatedFixtures {
  /** Other matches kicking off the same UTC calendar day. */
  sameDay: RelatedFixtureItem[];
  /** Other fixtures in the same competition, nearest in time first. */
  leagueSiblings: RelatedFixtureItem[];
  /** The home side's other fixtures, nearest in time first. */
  homeTeamOther: RelatedFixtureItem[];
  /** The away side's other fixtures, nearest in time first. */
  awayTeamOther: RelatedFixtureItem[];
}

const EMPTY: RelatedFixtures = {
  sameDay: [],
  leagueSiblings: [],
  homeTeamOther: [],
  awayTeamOther: [],
};

// "Dense linking, not a link farm" (task spec) — small, sensible caps per group.
const SAME_DAY_CAP = 6;
const LEAGUE_CAP = 6;
const TEAM_CAP = 4;

// Only what a related-link row needs (team names for the link text, the
// score once finished) — deliberately lighter than FIXTURE_ROW_SELECT
// (fixtures.ts), which also carries the prediction embed this surface has no
// use for. `!inner` on the league embed is required so `.gte('league.season',
// MIN_SEASON)` below actually EXCLUDES a pre-live-season row rather than
// merely nulling the embed (§5 season guard — same reasoning as fixtures.ts).
const RELATED_SELECT = `
  id, kickoff_utc, status, final_home_goals, final_away_goals,
  home_team:teams!fixtures_home_team_id_fkey(name),
  away_team:teams!fixtures_away_team_id_fkey(name),
  league:leagues!fixtures_league_id_fkey!inner(season)
`;

interface RawName {
  name: string;
}
interface RawLeagueSeason {
  season: number;
}
interface RawRow {
  id: number;
  kickoff_utc: string;
  status: string;
  final_home_goals: number | null;
  final_away_goals: number | null;
  home_team: RawName | RawName[] | null;
  away_team: RawName | RawName[] | null;
  league: RawLeagueSeason | RawLeagueSeason[] | null;
}

function mapRow(r: RawRow): RelatedFixtureItem {
  return {
    id: r.id,
    kickoff_utc: r.kickoff_utc,
    status: r.status as FixtureStatus,
    home: one(r.home_team)?.name ?? 'Home',
    away: one(r.away_team)?.name ?? 'Away',
    final_home_goals: r.final_home_goals,
    final_away_goals: r.final_away_goals,
  };
}

interface SourceFixture {
  kickoff_utc: string;
  league_id: number;
  home_team_id: number;
  away_team_id: number;
}

async function loadSource(fixtureId: number): Promise<SourceFixture | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('fixtures')
    .select('kickoff_utc, league_id, home_team_id, away_team_id')
    .eq('id', fixtureId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

/** Other matches kicking off the same UTC calendar day as `kickoffUtc`. */
async function loadSameDay(fixtureId: number, kickoffUtc: string): Promise<RawRow[]> {
  const dayKey = utcDateKey(kickoffUtc);
  const dayStart = `${dayKey}T00:00:00.000Z`;
  const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 3600 * 1000).toISOString();

  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('fixtures')
    .select(RELATED_SELECT)
    .gte('league.season', MIN_SEASON)
    .neq('id', fixtureId)
    .gte('kickoff_utc', dayStart)
    .lt('kickoff_utc', dayEnd)
    .order('kickoff_utc', { ascending: true })
    .limit(SAME_DAY_CAP);
  if (error) return [];
  return (data ?? []) as unknown as RawRow[];
}

/**
 * The nearest-in-time OTHER fixtures matching one `.or()` filter clause (a
 * league_id match, or a home/away team_id match) — split into a
 * future-or-simultaneous half and a strictly-past half around the source
 * kickoff, so a team/competition with a long history surfaces fixtures near
 * THIS one in time rather than just its oldest rows (PostgREST has no
 * "order by distance to X" — this two-query split is the plain equivalent).
 */
async function loadNearby(
  orFilter: string,
  fixtureId: number,
  kickoffUtc: string,
  cap: number,
): Promise<RawRow[]> {
  const futureCap = Math.ceil(cap / 2);
  const pastCap = cap - futureCap;
  const sb = getSupabaseClient();

  const [{ data: future, error: futureErr }, { data: past, error: pastErr }] = await Promise.all([
    sb
      .from('fixtures')
      .select(RELATED_SELECT)
      .gte('league.season', MIN_SEASON)
      .neq('id', fixtureId)
      .or(orFilter)
      .gte('kickoff_utc', kickoffUtc)
      .order('kickoff_utc', { ascending: true })
      .limit(futureCap),
    sb
      .from('fixtures')
      .select(RELATED_SELECT)
      .gte('league.season', MIN_SEASON)
      .neq('id', fixtureId)
      .or(orFilter)
      .lt('kickoff_utc', kickoffUtc)
      .order('kickoff_utc', { ascending: false })
      .limit(pastCap),
  ]);

  const futureRows = futureErr ? [] : ((future ?? []) as unknown as RawRow[]);
  // Reversed back to chronological order (was fetched newest-first).
  const pastRows = pastErr ? [] : ((past ?? []) as unknown as RawRow[]).reverse();
  return [...pastRows, ...futureRows];
}

/** Drops any row already claimed by an earlier (higher-priority) group, maps
 *  the rest, and records their ids as claimed for the next group. */
function dedupe(rows: RawRow[], used: Set<number>): RelatedFixtureItem[] {
  const fresh = rows.filter((r) => !used.has(r.id));
  for (const r of fresh) used.add(r.id);
  return fresh.map(mapRow);
}

/**
 * Related fixtures for ONE match page (or, reused, for a team's next
 * upcoming fixture — see team/[slug]/page.tsx). `React.cache()` dedupes a
 * repeat call for the same id within one request (mirrors match.ts/team.ts).
 */
export const getRelatedFixtures = cache(
  async (fixtureId: number): Promise<RelatedFixtures> => {
    if (!Number.isInteger(fixtureId) || fixtureId <= 0) return EMPTY;
    try {
      const src = await loadSource(fixtureId);
      if (!src) return EMPTY;

      const [dayRows, leagueRows, homeRows, awayRows] = await Promise.all([
        loadSameDay(fixtureId, src.kickoff_utc),
        loadNearby(`league_id.eq.${src.league_id}`, fixtureId, src.kickoff_utc, LEAGUE_CAP),
        loadNearby(
          `home_team_id.eq.${src.home_team_id},away_team_id.eq.${src.home_team_id}`,
          fixtureId,
          src.kickoff_utc,
          TEAM_CAP,
        ),
        loadNearby(
          `home_team_id.eq.${src.away_team_id},away_team_id.eq.${src.away_team_id}`,
          fixtureId,
          src.kickoff_utc,
          TEAM_CAP,
        ),
      ]);

      const used = new Set<number>([fixtureId]);
      return {
        sameDay: dedupe(dayRows, used),
        leagueSiblings: dedupe(leagueRows, used),
        homeTeamOther: dedupe(homeRows, used),
        awayTeamOther: dedupe(awayRows, used),
      };
    } catch {
      return EMPTY;
    }
  },
);

// ── sibling teams (team page cross-linking) ─────────────────────────────────

export interface SiblingTeam {
  name: string;
  slug: string;
}

const SIBLING_TEAM_CAP = 10;

/**
 * Every OTHER team in the same competition, name + slug, alphabetised — lets
 * a team page link densely to its competition's other team pages (today only
 * the league page itself does this, via its own in-memory `leagueTeams()`
 * derived from fixtures already loaded — this is the team-page equivalent,
 * via a direct, tiny query rather than guessing the teams→leagues FK
 * constraint name, which team.ts's own comment explicitly warns against).
 * Resolves the league by slug first (2 small queries, no embed) so it works
 * from exactly the fields TeamData already exposes (`leagueSlug`, `slug`).
 * Degrades to [] on any error or unknown league.
 */
export async function getSiblingTeams(
  leagueSlug: string,
  excludeTeamSlug: string,
): Promise<SiblingTeam[]> {
  if (!leagueSlug) return [];
  try {
    const sb = getSupabaseClient();
    const { data: league, error: leagueErr } = await sb
      .from('leagues')
      .select('id')
      .eq('slug', leagueSlug)
      .maybeSingle();
    if (leagueErr || !league) return [];

    const { data, error } = await sb
      .from('teams')
      .select('name, slug')
      .eq('league_id', league.id)
      .neq('slug', excludeTeamSlug)
      .order('name', { ascending: true })
      .limit(SIBLING_TEAM_CAP);
    if (error) return [];
    return (data ?? []) as SiblingTeam[];
  } catch {
    return [];
  }
}
