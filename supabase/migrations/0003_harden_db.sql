-- Glass Pitch — v2 hardening migration (extends 0001_init_schema.sql +
-- 0002_harden_function_search_path.sql). Must apply cleanly, in order, on a
-- FRESH database (0001 -> 0002 -> 0003) AND on the already-provisioned live
-- database (which additionally carries a platform-installed
-- public.rls_auto_enable() / ensure_rls not defined by any migration — see (b)).
--
-- This migration:
--   (a) Revokes write privileges from anon/authenticated on every public table
--       (RLS already denies writes with no write policies; this removes the
--       redundant Supabase-default GRANT so read-only is enforced at BOTH the
--       grant layer and the RLS layer) and makes deny-by-default (minus SELECT)
--       the rule for every table created in `public` from now on.
--   (b) Hardens public.rls_auto_enable() (§ live-DB drift, undocumented in
--       0001/0002) by revoking EXECUTE from anon/authenticated, and documents
--       the function + its `ensure_rls` event trigger here so the repo — not
--       just the live project — is the source of truth for it.
--   (c) Adds a BEFORE DELETE guard on predictions (0001/0002's trigger is
--       UPDATE-only — DELETE silently bypasses ledger immutability, and so does
--       the fixtures/leagues ON DELETE CASCADE) plus a SECURITY DEFINER
--       teardown_season() RPC that is the ONLY sanctioned way to remove
--       locked/scored rows (dev/test season teardown only).
--   (d) Extends enforce_prediction_immutability so a SCORED prediction's
--       scoring fields freeze too, once written — the scored record is now as
--       immutable as the locked one. `tier` stays deliberately mutable
--       (monetisation gating, by design — ARCHITECTURE.md §4/§7).
--   (e) Adds composite/partial indexes for the jobs' + web's hot read paths and
--       drops the indexes they make redundant.
--   (f) Adds job_runs, a service-role-only scheduler observability table.
--   (g) Extends predictions.status with 'void_cancelled' — the terminal-fixture
--       closure status for locked/published predictions whose fixture turns
--       out to be cancelled/abandoned/postponed-beyond-recovery (see
--       jobs/fetch_fixtures.py's terminal-fixture closure, companion to this
--       migration).

-- ============================================================================
-- (a) Deny-by-default privileges for anon/authenticated (ARCHITECTURE.md §7)
-- ============================================================================
-- RLS already has no write policies for anon/authenticated (0001), so writes
-- were already rejected at the RLS layer — but Supabase's stock default ACL
-- additionally GRANTs the full DML/DDL privilege set (INSERT/UPDATE/DELETE/
-- TRUNCATE/REFERENCES/TRIGGER, verified live via information_schema) on every
-- table created in `public`, so the read-only guarantee rested on RLS alone.
-- Belt-and-suspenders: revoke those privileges outright (SELECT is untouched —
-- anon/authenticated keep read access, gated per-table by RLS as before), and
-- make deny-by-default the rule for every table created from now on (v2's
-- profiles/subscriptions tables inherit this automatically instead of needing a
-- bespoke revoke each time).

revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public
  from anon, authenticated;

-- `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` targets the grantor role whose
-- default ACL is what actually auto-grants anon/authenticated on new tables in
-- a standard Supabase project (verified live: current_user = postgres, and
-- postgres owns every table 0001/0002 created) -- but guard it anyway: this
-- statement requires BEING role postgres (or superuser), which could differ in
-- an unusual environment, and this migration must apply cleanly regardless.
do $$
begin
  begin
    execute 'alter default privileges for role postgres in schema public '
      || 'revoke insert, update, delete, truncate, references, trigger '
      || 'on tables from anon, authenticated';
  exception
    when insufficient_privilege or undefined_object then
      raise notice 'glasspitch 0003: skipped "alter default privileges for role postgres" (%): % -- falling back to the current-role variant below.', sqlstate, sqlerrm;
  end;
end;
$$;

-- Belt-and-suspenders for whichever role actually runs migrations in a given
-- environment (targets the CURRENT role's default ACL; a no-op if it never
-- creates tables, but always succeeds).
alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger
  on tables from anon, authenticated;

-- ============================================================================
-- (b) Harden public.rls_auto_enable() (Supabase-provisioned safety net)
-- ============================================================================
-- DOCUMENTED DRIFT: this function + the `ensure_rls` event trigger exist on the
-- live project but were never defined by any migration in this repo — they were
-- created at provisioning time, outside version control, and flagged by the
-- Supabase security advisor (anon_security_definer_function_executable /
-- authenticated_security_definer_function_executable — anon/authenticated can
-- invoke it directly via `/rest/v1/rpc/rls_auto_enable`).
--
-- Verified live (2026-07, read-only introspection via pg_proc/pg_event_trigger):
--   owner:            postgres (so a normal migration CAN revoke/alter it)
--   security:         SECURITY DEFINER
--   search_path:      already pinned to 'pg_catalog' (safe — the body only
--                     calls pg_catalog builtins) — NOT the mutable-search-path
--                     advisor finding, a separate EXECUTE-grant finding.
--   EXECUTE granted:  PUBLIC, anon, authenticated (the actual WARN)
--   behaviour:        a ddl_command_end event trigger that force-enables Row
--                     Level Security on any new `public` table — a free safety
--                     net so a future migration (v2 profiles/subscriptions,
--                     etc.) forgetting `enable row level security` is still
--                     protected. We KEEP it — only the EXECUTE grant is wrong.
--
-- Live source, captured verbatim for the record (this migration does NOT
-- alter the live function's body/config — only its EXECUTE grant):
--
--   create function public.rls_auto_enable()
--   returns event_trigger
--   language plpgsql
--   security definer
--   set search_path = 'pg_catalog'
--   as $body$
--     DECLARE
--       cmd record;
--     BEGIN
--       FOR cmd IN
--         SELECT * FROM pg_event_trigger_ddl_commands()
--         WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
--           AND object_type IN ('table','partitioned table')
--       LOOP
--          IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public')
--             AND cmd.schema_name NOT IN ('pg_catalog','information_schema')
--             AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%'
--          THEN
--            BEGIN
--              EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
--              RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
--            EXCEPTION WHEN OTHERS THEN
--              RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
--            END;
--          ELSE
--             RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)',
--               cmd.object_identity, cmd.schema_name;
--          END IF;
--       END LOOP;
--     END;
--   $body$;
--
--   create event trigger ensure_rls
--     on ddl_command_end
--     when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
--     execute function public.rls_auto_enable();
--
-- This migration must ALSO apply cleanly on a FRESH database (0001+0002 only,
-- none of the platform extras above), so the block below tolerates the
-- function/event trigger being absent (installs an equivalent, pre-hardened
-- version instead), and tolerates lacking the privilege to CREATE EVENT
-- TRIGGER (stock Postgres requires superuser for that; a hosted migration role
-- may not have it even though the platform's own provisioning does) —
-- everything degrades to a RAISE NOTICE rather than failing the migration.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    -- Already exists (the live project, or a re-run of this migration): only
    -- tighten the grant — never touch the body/config of a function we don't
    -- own the source of by convention.
    begin
      revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
      raise notice 'glasspitch 0003: rls_auto_enable() already existed — revoked EXECUTE from public/anon/authenticated.';
    exception
      when insufficient_privilege then
        raise notice 'glasspitch 0003: rls_auto_enable() exists but this role lacks privilege to REVOKE EXECUTE on it (not the owner in this environment) — SKIPPED, needs manual follow-up.';
    end;
  else
    -- Fresh DB: install an equivalent safety net, owned by whoever runs this
    -- migration, hardened from the start (EXECUTE revoked immediately;
    -- search_path pinned EMPTY — safe, every call below is schema-qualified).
    begin
      create function public.rls_auto_enable()
      returns event_trigger
      language plpgsql
      security definer
      set search_path = ''
      as $fn$
      declare
        cmd record;
      begin
        for cmd in
          select * from pg_catalog.pg_event_trigger_ddl_commands()
          where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
            and object_type in ('table', 'partitioned table')
        loop
          if cmd.schema_name = 'public' then
            begin
              execute pg_catalog.format(
                'alter table if exists %s enable row level security', cmd.object_identity
              );
              raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
            exception
              when others then
                raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
            end;
          end if;
        end loop;
      end;
      $fn$;

      revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

      create event trigger ensure_rls
        on ddl_command_end
        when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
        execute function public.rls_auto_enable();

      raise notice 'glasspitch 0003: installed rls_auto_enable() + ensure_rls fresh (EXECUTE pre-revoked).';
    exception
      when insufficient_privilege then
        raise notice 'glasspitch 0003: skipped installing rls_auto_enable()/ensure_rls — CREATE EVENT TRIGGER needs superuser on this environment. Non-blocking: every table in these migrations already calls "enable row level security" explicitly, so this is a missing nice-to-have safety net, not a missing requirement.';
      when others then
        raise notice 'glasspitch 0003: skipped installing rls_auto_enable()/ensure_rls (sqlstate %): %', sqlstate, sqlerrm;
    end;
  end if;
end;
$$;

-- ============================================================================
-- (g) Extend predictions.status with 'void_cancelled' (terminal-fixture close-out)
-- ============================================================================
-- Cancelled/abandoned fixtures (and postponed-beyond-a-horizon ones) leave any
-- locked/published predictions in permanent limbo today — never scored, never
-- voided. jobs/fetch_fixtures.py now closes these out explicitly rather than
-- overloading 'unlocked_void' (which means something different — published
-- after kickoff): a distinct status keeps the reason legible in the data.
-- Never surfaced on the public site either way (only status='scored' is shown).

alter table public.predictions drop constraint predictions_status_check;
alter table public.predictions add constraint predictions_status_check
  check (status in ('published', 'locked', 'scored', 'unlocked_void', 'void_cancelled'));

-- ============================================================================
-- (c) Ledger DELETE guard + sanctioned teardown RPC (ARCHITECTURE.md §7)
-- ============================================================================
-- 0001/0002's enforce_prediction_immutability is BEFORE UPDATE only — a
-- service-role DELETE on a locked/scored prediction (or a cascaded delete via
-- fixtures/leagues ON DELETE CASCADE) bypasses immutability with no trigger at
-- all. Add a BEFORE DELETE guard, with a narrow, transaction-scoped escape
-- hatch used ONLY by the teardown_season() RPC below (jobs/reset_season.py now
-- calls it via RPC instead of raw client-side deletes — see jobs/db.py).

create or replace function public.enforce_prediction_no_delete_after_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.locked_at <= now()
     and coalesce(current_setting('glasspitch.allow_ledger_teardown', true), 'off') <> 'on'
  then
    raise exception
      'Prediction % is locked (locked_at=%); locked/scored predictions cannot be deleted (ARCHITECTURE.md §7). Use public.teardown_season() for the sanctioned dev/test season teardown.',
      old.id, old.locked_at
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists predictions_enforce_no_delete_after_lock on public.predictions;
create trigger predictions_enforce_no_delete_after_lock
  before delete on public.predictions
  for each row
  execute function public.enforce_prediction_no_delete_after_lock();

-- Season-scoped, FK-safe teardown — the ONLY way to delete locked/scored
-- ledger rows outside of a genuine live-DB incident. SECURITY DEFINER so it can
-- set the escape-hatch flag and delete in one transaction regardless of caller
-- privileges. EXECUTE is revoked from PUBLIC/anon/authenticated and granted
-- only to service_role (jobs/reset_season.py calls it over RPC using the
-- secret key). `search_path` is pinned empty; every reference is
-- schema-qualified.
create or replace function public.teardown_season(p_season integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league_ids bigint[];
  v_fixture_ids bigint[];
  v_counts jsonb;
begin
  -- Transaction-local (3rd arg = true): reverts automatically at commit or
  -- rollback, so the escape hatch can never leak into another transaction or
  -- session.
  perform set_config('glasspitch.allow_ledger_teardown', 'on', true);

  select coalesce(array_agg(id), array[]::bigint[]) into v_league_ids
    from public.leagues where season = p_season;

  select coalesce(array_agg(id), array[]::bigint[]) into v_fixture_ids
    from public.fixtures where league_id = any(v_league_ids);

  v_counts := jsonb_build_object(
    'leagues', coalesce(array_length(v_league_ids, 1), 0),
    'teams', (select count(*) from public.teams where league_id = any(v_league_ids)),
    'fixtures', coalesce(array_length(v_fixture_ids, 1), 0),
    'predictions', (select count(*) from public.predictions where fixture_id = any(v_fixture_ids))
  );

  -- FK-safe order: children before parents (mirrors the prior client-side order
  -- in jobs/db.py).
  delete from public.predictions where fixture_id = any(v_fixture_ids);
  delete from public.fixtures where league_id = any(v_league_ids);
  delete from public.teams where league_id = any(v_league_ids);
  delete from public.leagues where id = any(v_league_ids);

  return v_counts;
end;
$$;

revoke execute on function public.teardown_season(integer) from public, anon, authenticated;
grant execute on function public.teardown_season(integer) to service_role;

-- ============================================================================
-- (d) Freeze scoring fields once a prediction is SCORED (ARCHITECTURE.md §7, §10)
-- ============================================================================
-- 0001/0002 leave final_*/result/brier_score/log_loss/scored_at/status writable
-- forever so score_results can finish the row — but nothing re-freezes them
-- once written. A provider score correction after scoring (or a buggy rescore)
-- could otherwise silently rewrite the public track record. `tier` stays
-- EXCLUDED from this freeze — monetisation gating remains mutable post-score by
-- design (ARCHITECTURE.md §4/§7; see also the "tier grain" premium finding).

create or replace function public.enforce_prediction_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.locked_at <= now() then
    if new.prob_home            is distinct from old.prob_home
       or new.prob_draw         is distinct from old.prob_draw
       or new.prob_away         is distinct from old.prob_away
       or new.predicted_home_goals is distinct from old.predicted_home_goals
       or new.predicted_away_goals is distinct from old.predicted_away_goals
       or new.model_version     is distinct from old.model_version
       or new.source            is distinct from old.source
       or new.published_at      is distinct from old.published_at
       or new.locked_at         is distinct from old.locked_at
       or new.fixture_id        is distinct from old.fixture_id
       or new.id                is distinct from old.id
       or new.created_at        is distinct from old.created_at
    then
      raise exception
        'Prediction % is locked (locked_at=%); prob_*/predicted_*/model_version/source/published_at/locked_at/fixture_id/id/created_at are immutable (ARCHITECTURE.md §7).',
        old.id, old.locked_at
        using errcode = 'check_violation';
    end if;
  end if;

  if old.scored_at is not null then
    if new.final_home_goals is distinct from old.final_home_goals
       or new.final_away_goals is distinct from old.final_away_goals
       or new.result            is distinct from old.result
       or new.brier_score       is distinct from old.brier_score
       or new.log_loss          is distinct from old.log_loss
       or new.scored_at         is distinct from old.scored_at
       or new.status            is distinct from old.status
    then
      raise exception
        'Prediction % is scored (scored_at=%); final_*/result/brier_score/log_loss/scored_at/status are immutable once scored (ARCHITECTURE.md §7/§10, migration 0003 hardening).',
        old.id, old.scored_at
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- (the BEFORE UPDATE trigger predictions_enforce_immutability already exists
-- from 0001 and points at this function by name — create or replace above is
-- enough, no need to recreate the trigger itself.)

-- ============================================================================
-- (e) Composite/partial indexes for the jobs' + web's hot read paths
-- ============================================================================

-- lock_predictions' due-scan: status='published' AND locked_at <= now().
create index if not exists idx_predictions_due
  on public.predictions (locked_at)
  where status = 'published';

-- score_results' inverted scan (jobs/score_results.py, this migration's
-- companion code change): status='locked', joined to its fixture.
create index if not exists idx_predictions_locked
  on public.predictions (fixture_id)
  where status = 'locked';

-- ledger / homepage scored feed: source + status='scored' ORDER BY scored_at DESC.
create index if not exists idx_predictions_scored_feed
  on public.predictions (scored_at desc)
  where status = 'scored' and source = 'api-football';

-- fixtures' status+kickoff scan (homepage upcoming/live feed, lock/score jobs'
-- polling) replaces the two single-column indexes below, which it covers for
-- every current query shape.
create index if not exists idx_fixtures_status_kickoff
  on public.fixtures (status, kickoff_utc);

drop index if exists public.idx_fixtures_status;
drop index if exists public.idx_fixtures_kickoff;

-- Redundant now that the partial indexes above target the specific statuses
-- the jobs actually scan for; a whole-table 4/5-value low-cardinality index
-- adds write overhead for little read benefit at scale (the audit's flagged
-- redundant index).
drop index if exists public.idx_predictions_status;

-- ============================================================================
-- (f) job_runs — scheduler observability (ARCHITECTURE.md §5, §8)
-- ============================================================================
-- One row per job invocation (jobs/cli.py writes it in a `finally` block for
-- live, non-dry-run runs — see jobs/db.py.record_job_run). Lets an operator (or
-- a future alerting step) see "the pipeline went quiet" / "N predictions voided
-- this run" without grepping GitHub Actions logs. service_role only —
-- anon/authenticated get NO access (not even SELECT): these are operational
-- logs, not public ledger data.

create table if not exists public.job_runs (
  id           bigint generated always as identity primary key,
  job          text        not null,
  started_at   timestamptz not null,
  finished_at  timestamptz,
  ok           boolean,
  counts       jsonb,
  error        text,
  created_at   timestamptz not null default now()
);

comment on table public.job_runs is
  'Scheduler observability: one row per jobs.<name> invocation, written by jobs/cli.py. Not part of the public ledger — service-role only, no anon/authenticated access at all (ARCHITECTURE.md §5).';

create index if not exists idx_job_runs_job_started on public.job_runs (job, started_at desc);

alter table public.job_runs enable row level security;
-- No policies for anon/authenticated -> RLS denies all access by default.
-- Explicit belt-and-suspenders on top of that default-deny (and on top of (a)'s
-- default-privilege revoke, which already excludes this table from DML grants):
revoke all on public.job_runs from anon, authenticated;

grant all on public.job_runs to service_role;
grant usage, select on all sequences in schema public to service_role;
