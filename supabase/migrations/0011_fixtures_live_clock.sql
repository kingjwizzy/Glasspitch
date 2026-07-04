-- Glass Pitch — store the live match clock on fixtures (v3, RAMBO WAVE 3,
-- UI-overhaul spec item #1: "show the live minute, not just Live").
--
-- ARCHITECTURE.md §7's `fixtures.status` is already the right COARSE enum
-- (scheduled/live/finished/postponed) that status badges key off, but it
-- collapses away the exact API-Football short code (1H/HT/2H/ET/BT/P/...)
-- and the elapsed-minute clock, so today there is no way to render "67'" or
-- "HT" on a live fixture -- only the word "Live". This migration adds that,
-- purely additive/nullable, no backfill (existing rows go null until their
-- next fetch_fixtures sweep -- same convention as migration 0007's
-- round/api_round). No new API call: jobs/fetch_fixtures.py already polls
-- /fixtures (incl. fixture.status) every ~15 min for lock/score detection;
-- this reads three more fields off that SAME already-fetched response.
--
-- elapsed_extra_minute is one column beyond the task's literal two-column
-- ask: the SAME /fixtures payload also carries fixture.status.extra
-- (added/stoppage minutes, e.g. "90+2" = elapsed 90, extra 2) -- without it
-- the UI can show "67'"/"HT" but never the stoppage-time "+2" the spec's own
-- worked example names. Additive/nullable, zero extra API cost; flagged in
-- the handback note in case the frontend/parent agent wants it dropped.

alter table public.fixtures
  add column elapsed_minute       integer
    check (elapsed_minute is null or (elapsed_minute between 0 and 130)),
  add column status_short        text
    check (status_short is null or char_length(status_short) <= 10),
  add column elapsed_extra_minute integer
    check (elapsed_extra_minute is null or (elapsed_extra_minute between 0 and 60));

comment on column public.fixtures.elapsed_minute is
  'Live match clock in minutes (API-Football fixture.status.elapsed), e.g. 67 during the 2nd half. Null when not live (scheduled/finished/postponed) or when the provider omits it. Sourced from the SAME /fixtures poll jobs/fetch_fixtures.py already runs every ~15 min -- zero new API calls.';
comment on column public.fixtures.status_short is
  'Raw, UNNORMALISED API-Football fixture.status.short code (e.g. ''1H''/''HT''/''2H''/''ET''/''BT''/''P''/''FT''/''AET''/''PEN''/''PST''/''CANC''), kept alongside the coarse `status` enum -- `status` alone cannot distinguish half-time from a live minute, or extra-time from full-time-at-90. Same raw-value-kept-beside-normalised-sibling convention as `api_round` (migration 0007).';
comment on column public.fixtures.elapsed_extra_minute is
  'Added/stoppage time in minutes (API-Football fixture.status.extra), e.g. 2 when the live clock reads "90+2''". Null outside of added time or when the provider omits it. Same source payload as elapsed_minute/status_short -- zero new API calls.';
