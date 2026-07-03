import 'server-only';

// /matches index read layer (ARCHITECTURE.md §5, §8, §11) — the fixtures crawl
// hub: every upcoming fixture (grouped by UTC day) across every tracked
// league, plus a bounded window of recent results. This is the page ARCHITECTURE
// §11 means by "the growth engine" fanning out into individual match pages, so
// it is a primary content surface like the homepage/ledger, not a secondary one.
//
// Read-only, publishable key, season-floored (§5 golden rule — never a
// football-API call on the request path). A genuine DB failure throws so a
// failed ISR background revalidation keeps serving the last good cached page
// and retries, instead of silently replacing the crawl hub with a false empty
// state (mirrors the homepage/ledger primary-read pattern — see shared.ts).

import { getSupabaseClient } from '@/lib/supabaseClient';
import { MIN_SEASON } from '@/lib/constants';
import {
  FIXTURE_ROW_SELECT,
  mapFixtureRow,
  partitionFixtures,
  type FixtureRowView,
  type RawFixtureRow,
} from './fixtures';
import { paginate, previewAllowed, withTimeoutOrThrow } from './shared';
import { previewMatchesData } from './matches.preview';

export interface MatchDayGroup {
  /** UTC calendar date, "YYYY-MM-DD" — the group key. */
  dateIso: string;
  /** Human label, e.g. "Sat 5 Jul" (UTC). */
  label: string;
  fixtures: FixtureRowView[];
}

export interface MatchesIndexData {
  upcomingByDay: MatchDayGroup[];
  recent: FixtureRowView[];
}

/** Cap on "recent results" shown here — this is a crawl hub, not the ledger;
 *  /ledger is the full, all-time authority (§10). */
const RECENT_LIMIT = 50;

const DAY_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** Group already-sorted fixtures by their UTC calendar date, preserving the
 *  incoming order (ascending kickoff) within and across groups. */
function groupByDay(fixtures: FixtureRowView[]): MatchDayGroup[] {
  const order: string[] = [];
  const groups = new Map<string, FixtureRowView[]>();
  for (const f of fixtures) {
    const dateIso = f.kickoff_utc.slice(0, 10);
    if (!groups.has(dateIso)) {
      groups.set(dateIso, []);
      order.push(dateIso);
    }
    groups.get(dateIso)!.push(f);
  }
  return order.map((dateIso) => ({
    dateIso,
    label: DAY_FMT.format(new Date(`${dateIso}T00:00:00Z`)),
    fixtures: groups.get(dateIso) ?? [],
  }));
}

// Every fixture row across every tracked league, season-guarded (§5) and
// paginated via `.range()` (§8): PostgREST silently caps an unbounded select at
// the project's Max Rows setting (default 1000), which the site's fixture
// count will exceed once club football is added. Bounded to a hard safety cap
// of 5 pages (5000 rows) — far above World-Cup scale and still a ceiling once
// club football adds continuous fixtures.
async function loadAllFixtureRows(): Promise<FixtureRowView[]> {
  const sb = getSupabaseClient();
  const rows = await paginate<RawFixtureRow>(
    async (from, to) => {
      const { data, error } = await sb
        .from('fixtures')
        .select(FIXTURE_ROW_SELECT)
        .gte('league.season', MIN_SEASON)
        .order('kickoff_utc', { ascending: false })
        .range(from, to);
      // supabase-js RESOLVES errors rather than throwing — an unchecked
      // `error` is the primary failure route. Throw so a failed ISR
      // background revalidation keeps serving the last good cached page and
      // retries, rather than silently truncating the crawl hub.
      if (error) throw new Error(`matches index read failed: ${error.message}`);
      return data as unknown as RawFixtureRow[];
    },
    1000,
    5,
  );
  return rows.map(mapFixtureRow);
}

async function load(): Promise<MatchesIndexData> {
  const rows = await loadAllFixtureRows();
  const { upcoming, recent } = partitionFixtures(rows);
  return {
    upcomingByDay: groupByDay(upcoming),
    recent: recent.slice(0, RECENT_LIMIT),
  };
}

/**
 * The single read the /matches page makes. Server-only.
 *
 * `PREVIEW_MATCHES` is a server-only dev/preview escape hatch (NOT a
 * NEXT_PUBLIC var, and requires the separate `ALLOW_PREVIEW=1` flag — see
 * `previewAllowed()` — so it can never activate on a real deploy): it returns
 * representative in-memory fixtures so the page can be rendered, built and
 * screenshotted with no seeded database. It writes nothing.
 *
 * A genuine DB failure THROWS (see `load()`) rather than being swallowed to an
 * empty result — the caller (the page, ISR) is responsible for that
 * behaviour, exactly like getHomepageData()/getLedgerData().
 */
export async function getMatchesIndexData(): Promise<MatchesIndexData> {
  if (previewAllowed()) {
    const preview = process.env.PREVIEW_MATCHES;
    if (preview === '1' || preview === 'default') return previewMatchesData('default');
    if (preview === 'empty') return previewMatchesData('empty');
  }

  return withTimeoutOrThrow(load(), 6000);
}
