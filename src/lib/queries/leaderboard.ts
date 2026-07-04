import 'server-only';

// "Beat the model" leaderboard (ARCHITECTURE.md §5/§6 v3 amendment; RAMBO
// wave 2 improvement #5). `leaderboard_standings` is a nightly, jobs-written
// snapshot: `user_id`, `display_name`, `picks_scored`, `user_mean_brier`,
// `model_mean_brier`, `beat_margin`, `rank`, `updated_at`. It is public-read
// by design (anon SELECT is allowed by RLS) and contains ONLY what a visitor
// who opted in chose to publish — no email, no other account data. This
// module is deliberately narrow: the public read below never touches
// `profiles`; the opt-in preference read is a SEPARATE function used only
// from the signed-in visitor's own /account page, through their own
// per-request client, scoped to their own row by RLS.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/lib/supabaseClient';
import type { Database } from '@/lib/database.types';

export interface LeaderboardRow {
  userId: string;
  displayName: string;
  picksScored: number;
  userMeanBrier: number;
  modelMeanBrier: number;
  /** `model_mean_brier - user_mean_brier` — positive means the player is
   *  ahead of the model on their own scored picks (lower Brier is sharper). */
  beatMargin: number;
  rank: number;
  updatedAt: string;
}

const MAX_ROWS = 200;

/**
 * The public leaderboard, ranked by beat margin (best-calibrated-vs-the-model
 * first) — read-only, anon publishable key, exactly like every other public
 * page (§5 golden rule). Degrades to [] on any error so the page can show its
 * own honest empty state rather than fail.
 */
export async function getLeaderboard(): Promise<LeaderboardRow[]> {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('leaderboard_standings')
      .select(
        'user_id, display_name, picks_scored, user_mean_brier, model_mean_brier, beat_margin, rank, updated_at',
      )
      .order('beat_margin', { ascending: false })
      .limit(MAX_ROWS);
    if (error) {
      console.error('getLeaderboard: read failed', error.message);
      return [];
    }
    return (data ?? []).map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      picksScored: r.picks_scored,
      userMeanBrier: r.user_mean_brier,
      modelMeanBrier: r.model_mean_brier,
      beatMargin: r.beat_margin,
      rank: r.rank,
      updatedAt: r.updated_at,
    }));
  } catch {
    return [];
  }
}

export interface MyLeaderboardPrefs {
  optIn: boolean;
  displayName: string | null;
}

/**
 * The SIGNED-IN visitor's OWN leaderboard preferences, for the /account
 * opt-in toggle — reads via the CALLER'S per-request, cookie-bound client
 * (never the anon singleton above), scoped by owner-read RLS to their own
 * `profiles` row. Defaults to "opted out, no name" on any error so a
 * transient read failure never accidentally implies the visitor is public.
 */
export async function getMyLeaderboardPrefs(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<MyLeaderboardPrefs> {
  const { data, error } = await supabase
    .from('profiles')
    .select('leaderboard_opt_in, leaderboard_display_name')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return { optIn: false, displayName: null };
  return { optIn: data.leaderboard_opt_in, displayName: data.leaderboard_display_name };
}
