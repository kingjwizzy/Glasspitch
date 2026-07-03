'use server';

// Server Actions for the "Beat the Model" game (ARCHITECTURE.md §5 v3
// game-picks amendment). Every write goes through the CALLER'S per-request,
// cookie-bound Supabase client (lib/supabase/server.ts) — the publishable key
// under the user's own RLS. Never the service key, never a proxy that could
// out-privilege the visitor: the database enforces everything (owner-scoped
// policies, the kickoff write-window trigger, column grants, the sum-to-1
// CHECK) and these actions merely translate its verdicts into honest copy.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/auth/redirect';

// ── picks ────────────────────────────────────────────────────────────────────

// NOTE: a "use server" module may only export async functions at runtime —
// the matching initial-state CONST lives in PickCard.tsx; only the TYPE (which
// is erased) is exported from here.
export interface PickFormState {
  status: 'idle' | 'saved' | 'error';
  message: string;
}

function parsePercent(raw: FormDataEntryValue | null): number | null {
  const n = Number(String(raw ?? ''));
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
}

/** Postgres/PostgREST error codes we translate for the visitor. The DB is the
 *  boundary — a rejected write here is the system working, not failing. */
const LOCKED_CODES = new Set(['23514', 'P0001']); // check_violation / raise

export async function savePickAction(
  _prev: PickFormState,
  formData: FormData,
): Promise<PickFormState> {
  const fixtureId = Number(String(formData.get('fixtureId') ?? ''));
  const h = parsePercent(formData.get('home'));
  const d = parsePercent(formData.get('draw'));
  const a = parsePercent(formData.get('away'));

  if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
    return { status: 'error', message: 'Something went wrong — reload and try again.' };
  }
  if (h === null || d === null || a === null || h + d + a !== 100) {
    return {
      status: 'error',
      message: 'The three probabilities must be whole percentages totalling 100.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: 'error', message: 'Sign in to save a pick.' };
  }

  const probs = { prob_home: h / 100, prob_draw: d / 100, prob_away: a / 100 };

  // Update-then-insert on the (user_id, fixture_id) unique key. The column
  // grants deliberately don't allow a blanket upsert (UPDATE covers prob_*
  // only), so a literal .upsert() would be rejected by the DB.
  const { data: updated, error: updateError } = await supabase
    .from('user_predictions')
    .update(probs)
    .eq('user_id', user.id)
    .eq('fixture_id', fixtureId)
    .select('id');

  if (updateError) {
    return { status: 'error', message: writeErrorMessage(updateError.code) };
  }

  if (!updated || updated.length === 0) {
    const { error: insertError } = await supabase
      .from('user_predictions')
      .insert({ user_id: user.id, fixture_id: fixtureId, ...probs });
    if (insertError && insertError.code === '23505') {
      // Raced a concurrent insert of the same pick — retry as an update.
      const { error: retryError } = await supabase
        .from('user_predictions')
        .update(probs)
        .eq('user_id', user.id)
        .eq('fixture_id', fixtureId);
      if (retryError) {
        return { status: 'error', message: writeErrorMessage(retryError.code) };
      }
    } else if (insertError) {
      return { status: 'error', message: writeErrorMessage(insertError.code) };
    }
  }

  return {
    status: 'saved',
    message: 'Saved. You can adjust it until kickoff — then it locks, like ours.',
  };
}

function writeErrorMessage(code: string | undefined): string {
  if (code && LOCKED_CODES.has(code)) {
    return 'This fixture has locked — picks close at kickoff, no exceptions.';
  }
  if (code === '42501') {
    return 'That write isn’t allowed. Reload and try again.';
  }
  return 'Could not save your pick right now. Please try again shortly.';
}

// ── pools ────────────────────────────────────────────────────────────────────

const NAME_MAX = 60;
const DISPLAY_NAME_MAX = 24;

function cleanText(raw: FormDataEntryValue | null, max: number): string | null {
  const s = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length >= 1 && s.length <= max ? s : null;
}

/** Where a failed pools action returns to (validated like every next-path). */
function returnPath(formData: FormData): string {
  return safeNextPath(String(formData.get('return') ?? ''), '/play/pools');
}

export async function createPoolAction(formData: FormData): Promise<void> {
  const back = returnPath(formData);
  const name = cleanText(formData.get('name'), NAME_MAX);
  const displayName = cleanText(formData.get('displayName'), DISPLAY_NAME_MAX);
  if (!name || !displayName) {
    redirect(`${back}?error=create-invalid`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(back)}`);

  const { data: pool, error } = await supabase
    .from('pools')
    .insert({ name, owner_user_id: user.id })
    .select('id')
    .single();

  if (error || !pool) {
    console.error('createPoolAction: insert failed', error?.message);
    redirect(`${back}?error=create-failed`);
  }

  // The owner joins their own pool immediately (the direct self-insert the
  // migration's policies exist for). A failure here still leaves a usable
  // pool — the owner can join via their own invite link.
  const { error: memberError } = await supabase
    .from('pool_members')
    .insert({ pool_id: pool.id, user_id: user.id, display_name: displayName });
  if (memberError) {
    console.error('createPoolAction: self-join failed', memberError.message);
  }

  redirect(`/play/pools/${pool.id}`);
}

export async function joinPoolAction(formData: FormData): Promise<void> {
  const back = returnPath(formData);
  const code = String(formData.get('code') ?? '')
    .trim()
    .toLowerCase();
  const displayName = cleanText(formData.get('displayName'), DISPLAY_NAME_MAX);
  if (!/^[a-z0-9-]{4,64}$/.test(code) || !displayName) {
    redirect(`${back}?error=join-invalid`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(back)}`);

  const { data, error } = await supabase.rpc('join_pool', {
    p_invite_code: code,
    p_display_name: displayName,
  });

  if (error) {
    // join_pool raises no_data_found (P0002) for an unknown code.
    const notFound = error.code === 'P0002' || /invalid invite/i.test(error.message);
    redirect(`${back}?error=${notFound ? 'join-badcode' : 'join-failed'}`);
  }

  const poolId =
    data && typeof data === 'object' && !Array.isArray(data)
      ? String((data as Record<string, unknown>).pool_id ?? '')
      : '';
  redirect(poolId ? `/play/pools/${poolId}` : '/play/pools');
}
