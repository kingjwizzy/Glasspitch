-- Glass Pitch — v2 billing hardening: past_due grace window (audit action #17).
-- Extends 0004_premium.sql's public.is_premium(uid); must apply cleanly, in
-- order, after 0001 -> 0002 -> 0003 -> 0004 -> 0005 -> 0006 -> 0007.
--
-- Rationale: Stripe moves a subscription to `past_due` on the FIRST failed
-- recurring card charge, then retries (Smart Retries) over several days
-- before eventually marking it `canceled`/`unpaid`. Revoking premium access
-- the instant a charge fails (the pre-existing 'active','trialing' IN-list)
-- punishes involuntary churn -- an expired/declined card, not a deliberate
-- cancellation -- with an outage the subscriber hasn't consented to and may
-- not have noticed yet. Treating `past_due` the same as `active`/`trialing`
-- gives the card-retry cycle a chance to succeed without an access gap.
--
-- This is safe, not a loophole, because it is already bounded by the
-- pre-existing `current_period_end` check on the very same row: `past_due`
-- only grants access up to the period the subscriber already paid for, same
-- as every other status in the list. It does not extend access a single day
-- beyond what `current_period_end` allows, and does not touch how that
-- column is maintained -- the Stripe webhook handler (0004 §5) still owns
-- writing `status` and `current_period_end` on every relevant event; this
-- migration only changes which status values `is_premium()` treats as
-- current.
--
-- The function is otherwise byte-for-byte identical to 0004's definition --
-- same signature, `security invoker`, `stable`, `set search_path = ''`,
-- grants, and comment style -- only the `status in (...)` list changes.

-- ============================================================================
-- Functions
-- ============================================================================

create or replace function public.is_premium(uid uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = uid
      and s.status in ('active', 'trialing', 'past_due')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;

comment on function public.is_premium(uuid) is
  'True if uid has an active/trialing/past_due subscription that has not passed current_period_end. past_due is included deliberately (0008): it grants a grace window across involuntary card-decline retries rather than an instant revoke, bounded by the same current_period_end check as every other status -- see this migration''s header comment. SECURITY INVOKER by design -- see the definition comment in 0004''s "Functions" section.';

revoke execute on function public.is_premium(uuid) from public, anon;
grant execute on function public.is_premium(uuid) to authenticated, service_role;
