import 'server-only';

// "Open match of the day" (ROADMAP.md §2, owner-approved premium packaging):
// ONE deterministic match per day gets its premium deeper read rendered FREE
// on the public match page — conversion by demonstrated usefulness, the only
// upgrade mechanic DESIGN.md §6 permits.
//
// Selection is deterministic and server-computed: the earliest kickoff of the
// current UTC day that has a displayed (non-void, third-party) prediction.
// Every visitor gets the same answer for the whole day, and the match page's
// ISR cache means it is computed once per revalidation, never per visitor.
//
// The insights read uses the SERVER-ONLY service-role client — a deliberate,
// sanctioned READ-ONLY use: `fixture_insights` is RLS-gated to subscribers,
// and rendering one match's insights into a public cached page is a product
// decision (ROADMAP §2), not a privilege leak. It writes nothing, runs only
// at ISR render time, and degrades to null (→ the normal premium callout) on
// any failure, including a missing SUPABASE_SECRET_KEY.

import { getSupabaseClient } from '@/lib/supabaseClient';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { MIN_SEASON } from '@/lib/constants';
import type { FixtureInsight, PredictionStatus } from '@/lib/types';
import { VOID_STATUSES } from '@/lib/types';
import { DISPLAY_SOURCE, withTimeout } from './shared';

interface RawCandidate {
  id: number;
  kickoff_utc: string;
  predictions: Array<{ source: string; status: string }> | null;
}

/**
 * The fixture id of today's open match (UTC day of `nowIso`), or null when
 * today has no fixture with a displayed prediction. Anon read, best-effort:
 * any failure degrades to null (→ no open match today), never an error.
 */
export async function getOpenMatchFixtureId(nowIso: string): Promise<number | null> {
  try {
    const dayStart = `${nowIso.slice(0, 10)}T00:00:00.000Z`;
    const dayEnd = new Date(
      new Date(dayStart).getTime() + 24 * 3600 * 1000,
    ).toISOString();

    const sb = getSupabaseClient();
    const read = (async (): Promise<RawCandidate[]> => {
      const { data, error } = await sb
        .from('fixtures')
        .select(
          `id, kickoff_utc,
           league:leagues!fixtures_league_id_fkey!inner(season),
           predictions(source, status)`,
        )
        .gte('league.season', MIN_SEASON)
        .gte('kickoff_utc', dayStart)
        .lt('kickoff_utc', dayEnd)
        .order('kickoff_utc', { ascending: true })
        .limit(12);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as RawCandidate[];
    })();

    const candidates = await withTimeout(read, 4000, [] as RawCandidate[]);
    for (const c of candidates) {
      const hasCall = (c.predictions ?? []).some(
        (p) =>
          p.source === DISPLAY_SOURCE &&
          !VOID_STATUSES.includes(p.status as PredictionStatus),
      );
      if (hasCall) return c.id;
    }
    return null;
  } catch (err) {
    console.error('getOpenMatchFixtureId: failed', err);
    return null;
  }
}

/**
 * The open match's premium insights, read server-side with the service-role
 * client (read-only — see module doc). Returns null when the read isn't
 * possible (missing secret key, DB error) so the caller falls back to the
 * ordinary premium callout; returns [] when readable but not yet published.
 */
export async function getOpenMatchInsights(
  fixtureId: number,
): Promise<FixtureInsight[] | null> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('fixture_insights')
      .select('fixture_id, kind, payload, source, fetched_at')
      .eq('fixture_id', fixtureId);
    if (error) {
      console.error('getOpenMatchInsights: read failed', error.message);
      return null;
    }
    return (data ?? []).map((row) => ({
      fixture_id: row.fixture_id,
      kind: row.kind as FixtureInsight['kind'],
      payload: (row.payload as Record<string, unknown>) ?? {},
      source: row.source,
      fetched_at: row.fetched_at,
    }));
  } catch (err) {
    // Most likely: SUPABASE_SECRET_KEY not configured in this environment.
    console.error('getOpenMatchInsights: unavailable', err);
    return null;
  }
}
