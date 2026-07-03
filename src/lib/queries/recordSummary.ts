import 'server-only';

// Lean running-record figures for the share kit's receipt cards (W6): just
// "N scored, H landed", computed over the same hard-filtered set as the
// ledger (displayed model only, scored only, season-guarded — §5, §9, §10)
// but selecting only the four columns the argmax hit test needs. Non-critical
// surface: degrades to null (the card omits the record line) rather than
// ever failing an OG render.

import { getSupabaseClient } from '@/lib/supabaseClient';
import { MIN_SEASON } from '@/lib/constants';
import { predictedPick } from '@/lib/format';
import type { MatchResult } from '@/lib/types';
import { DISPLAY_SOURCE, withTimeout } from './shared';

export interface RecordFigures {
  count: number;
  hits: number;
}

interface RawRow {
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  result: string | null;
}

async function load(): Promise<RecordFigures | null> {
  try {
    const sb = getSupabaseClient();
    // Bounded like ledger.ts's load(): PostgREST silently row-caps unbounded
    // selects, and 5000 is far above single-tournament scale.
    const { data, error } = await sb
      .from('predictions')
      .select(
        `prob_home, prob_draw, prob_away, result,
         fixture:fixtures!predictions_fixture_id_fkey!inner(
           league:leagues!fixtures_league_id_fkey!inner(season)
         )`,
      )
      .eq('source', DISPLAY_SOURCE)
      .eq('status', 'scored')
      .not('result', 'is', null)
      .gte('fixture.league.season', MIN_SEASON)
      .limit(5000);
    if (error || !data) return null;

    const rows = data as unknown as RawRow[];
    const count = rows.length;
    const hits = rows.filter(
      (r) =>
        r.result !== null &&
        predictedPick({ home: r.prob_home, draw: r.prob_draw, away: r.prob_away }) ===
          (r.result as MatchResult),
    ).length;
    return { count, hits };
  } catch {
    return null;
  }
}

/** Running scored record ("41 of 64 calls landed"), or null when unavailable. */
export async function getRecordFigures(): Promise<RecordFigures | null> {
  return withTimeout(load(), 4000, null);
}
