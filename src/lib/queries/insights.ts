import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { FixtureInsight } from '@/lib/types';

// Premium "deeper read" content (ARCHITECTURE.md §4, §7 v2 amendment).
//
// Read THROUGH THE CALLER'S per-request client (never supabaseAdmin, never
// the anon singleton) — Row Level Security is what actually proves the
// visitor holds an active subscription (an `is_premium` check on
// `fixture_insights`); a non-premium or anonymous caller's own client simply
// gets zero rows back, never another visitor's or a free preview of the data.
// This module never decides entitlement itself — see lib/auth/viewer.ts for
// the UX-only helper that decides what to RENDER around this read.
export async function getFixtureInsights(
  supabase: SupabaseClient<Database>,
  fixtureId: number,
): Promise<FixtureInsight[]> {
  const { data, error } = await supabase
    .from('fixture_insights')
    .select('fixture_id, kind, payload, source, fetched_at')
    .eq('fixture_id', fixtureId);

  if (error) {
    console.error('getFixtureInsights: read failed', error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    fixture_id: row.fixture_id,
    kind: row.kind as FixtureInsight['kind'],
    payload: (row.payload as Record<string, unknown>) ?? {},
    source: row.source,
    fetched_at: row.fetched_at,
  }));
}
