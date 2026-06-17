-- Harden function search_path (Supabase advisor 0011 — function_search_path_mutable).
-- Both trigger functions reference only NEW/OLD and now() (pg_catalog is always
-- implicitly searched), so an empty search_path is safe and removes the mutable
-- search_path warning. create or replace keeps the existing triggers attached.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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
  return new;
end;
$$;
