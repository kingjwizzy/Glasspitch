"""Integration tests against a REAL local Postgres/Supabase stack (opt-in tier).

Everything else in jobs/tests/ runs against in-memory fakes (conftest.py) --
this file is the one place the actual Postgres trigger/CHECK/RPC/RLS behaviour
the product's trust story rests on gets exercised for real, per
docs/STATUS.md's "test-hardening" backlog item and the audit digest's
"no integration tests against real Postgres" finding.

SAFETY (read before touching this file): jobs/config.py + jobs/db.py load
jobs/.env by explicit path on every import -- in ANY environment where that
file is the real project's credentials (exactly the case in this repo's dev
sandbox), a naive "is SUPABASE_URL set?" gate would happily run DDL-adjacent
RPCs, inserts and deletes against the LIVE database. So the target resolver
below:

  1. Prefers SUPABASE_TEST_URL (+ SUPABASE_TEST_SECRET_KEY) -- a project a
     developer has deliberately set aside for this purpose.
  2. Otherwise falls back to SUPABASE_URL / SUPABASE_SECRET_KEY -- what CI's
     `jobs-integration` job exports from its OWN ephemeral `supabase start`
     stack (.github/workflows/ci.yml) -- but ONLY when that URL's host is the
     well-known local Supabase CLI address (127.0.0.1 / localhost / ::1).
  3. Otherwise: every test in this file is skipped (not failed, not xfailed)
     with a clear reason. This is the "skip cleanly when there's no safe
     target" contract pytest.ini's `integration` marker documents.

Every test that mutates data cleans up via the sanctioned `teardown_season`
RPC in a `finally` block, using a season number unique to that test run (see
`_isolated_season`), so repeated runs against a persistent (non-CI) project
never accumulate garbage and never collide with concurrent runs.

These tests assume migrations 0001 -> 0004 are ALREADY applied to the target
(CI's `supabase db reset` step does this before invoking `pytest -m
integration`; a developer running this locally runs the same via the Supabase
CLI). We don't re-apply the migration files ourselves -- instead, every
0003-introduced object/behaviour (job_runs, 'void_cancelled', the DELETE
guard, the extended freeze, teardown_season) AND every 0004-introduced
object/behaviour (`profiles`/`subscriptions`/`stripe_events`/
`fixture_insights`, `handle_new_user()`, `public.is_premium()`, and their RLS)
is exercised directly, so a schema that DIDN'T migrate cleanly to 0004 fails
these tests immediately (table/column/function/policy would not exist)
rather than silently no-op'ing.

v2 premium (0004) additions to this file create REAL `auth.users` rows via the
service-role client's `auth.admin.create_user()`/`delete_user()` (the local
stack's GoTrue, started by `supabase start`) so RLS can be exercised as a
genuinely authenticated user, not just anon vs. service-role -- every such
test deletes the user(s) it creates in a `finally` block, which cascades
(`on delete cascade`) through `profiles` and `subscriptions` automatically.
"""

from __future__ import annotations

import os
import uuid
from datetime import timedelta
from urllib.parse import urlparse

import pytest
from supabase import create_client

from jobs import util
from jobs.db import SupabaseStore

pytestmark = pytest.mark.integration


def _is_local_host(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host in {"127.0.0.1", "localhost", "::1"}


def _resolve_target():
    test_url = os.environ.get("SUPABASE_TEST_URL")
    test_key = os.environ.get("SUPABASE_TEST_SECRET_KEY") or os.environ.get(
        "SUPABASE_TEST_SERVICE_ROLE_KEY"
    )
    if test_url and test_key:
        return test_url, test_key

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY")
    if url and key and _is_local_host(url):
        return url, key

    return None


_TARGET = _resolve_target()

requires_real_db = pytest.mark.skipif(
    _TARGET is None,
    reason=(
        "No safe integration-test target configured. Set SUPABASE_TEST_URL "
        "(+ SUPABASE_TEST_SECRET_KEY) for a dedicated test project, or run "
        "against a local `supabase start` stack so SUPABASE_URL/"
        "SUPABASE_SECRET_KEY point at 127.0.0.1/localhost (what CI's "
        "jobs-integration job exports). jobs/.env's real project URL is "
        "deliberately NOT a valid target -- these tests write, delete and "
        "run DDL-adjacent RPCs."
    ),
)


def _resolve_anon_key() -> str | None:
    return (
        os.environ.get("SUPABASE_TEST_ANON_KEY")
        or os.environ.get("SUPABASE_ANON_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
    )


@pytest.fixture(scope="module")
def real_store():
    url, key = _TARGET
    return SupabaseStore(client=create_client(url, key))


@pytest.fixture
def isolated_season():
    """A season/league-id number unlikely to collide with real or concurrent
    test data -- every seeded row in a test is scoped under it so
    `teardown_season` can cleanly remove exactly (and only) that test's rows."""
    return 900_000 + (uuid.uuid4().int % 90_000)


def _seed_prediction(store, *, season, status, locked_delta, published_delta=None, **overrides):
    """Create one league/2 teams/1 fixture/1 prediction under `season`, return
    (fixture_id, prediction_id). `locked_delta` (a timedelta applied to
    util.now_utc()) controls whether the row is pre- or post-kickoff for the
    trigger's `locked_at <= now()` freeze condition."""
    league_id = store.upsert_league(
        api_league_id=season, name=f"Integration League {season}",
        slug=f"integration-league-{season}", country="Testland", season=season,
    )
    home_id = store.upsert_team(
        api_team_id=season * 10 + 1, name="Integration Home FC",
        slug=f"integration-home-{season}", league_id=league_id,
    )
    away_id = store.upsert_team(
        api_team_id=season * 10 + 2, name="Integration Away FC",
        slug=f"integration-away-{season}", league_id=league_id,
    )
    kickoff = util.now_utc() + locked_delta
    fixture_id = store.upsert_fixture(
        api_fixture_id=season * 100, league_id=league_id,
        home_team_id=home_id, away_team_id=away_id,
        kickoff_utc=kickoff.isoformat(), status="finished",
        final_home_goals=2, final_away_goals=1,
    )
    published_at = kickoff + (published_delta or timedelta(hours=-6))
    row = {
        "fixture_id": fixture_id,
        "model_version": "integration-test-v1",
        "source": "api-football",
        "prob_home": 0.5, "prob_draw": 0.3, "prob_away": 0.2,
        "predicted_home_goals": 2, "predicted_away_goals": 1,
        "published_at": published_at.isoformat(),
        "locked_at": kickoff.isoformat(),
        "status": status,
    }
    row.update(overrides)
    pred_id = store.insert_prediction(row)
    assert pred_id is not None, "seed insert unexpectedly hit a unique-violation swallow"
    return fixture_id, pred_id


# --- (g) migration 0003 objects exist: job_runs + 'void_cancelled' -----------


@requires_real_db
def test_migration_0003_objects_are_present(real_store, isolated_season):
    """Proves 0001->0003 applied: job_runs is writable (0003) and
    'void_cancelled' is an accepted predictions.status value (0003 extended
    the CHECK; neither existed before this migration)."""
    real_store.record_job_run(
        job="integration-test-probe",
        started_at=util.now_utc().isoformat(),
        finished_at=util.now_utc().isoformat(),
        ok=True,
        counts={"probe": True},
        error=None,
    )

    try:
        _fixture_id, pred_id = _seed_prediction(
            real_store, season=isolated_season, status="void_cancelled",
            locked_delta=timedelta(days=-1),
        )
        row = (
            real_store._client.table("predictions")
            .select("status")
            .eq("id", pred_id)
            .execute()
            .data[0]
        )
        assert row["status"] == "void_cancelled"
    finally:
        real_store.teardown_season(isolated_season)


# --- (d) immutability: locked freeze, scoring fields writable pre-scored, ----
# scored freeze (extended in 0003) --------------------------------------------


@requires_real_db
def test_immutability_trigger_freezes_locked_row_but_allows_scoring_then_refreezes(
    real_store, isolated_season
):
    _fixture_id, pred_id = _seed_prediction(
        real_store, season=isolated_season, status="locked",
        locked_delta=timedelta(hours=-2),  # kickoff in the past -> locked
    )
    try:
        # Frozen pre-scored fields: prob_*, model_version, source, published_at,
        # locked_at, fixture_id are all rejected once locked_at <= now().
        with pytest.raises(Exception):
            real_store._client.table("predictions").update(
                {"prob_home": 0.99}
            ).eq("id", pred_id).execute()
        with pytest.raises(Exception):
            real_store._client.table("predictions").update(
                {"model_version": "hacked-v2"}
            ).eq("id", pred_id).execute()

        # Scoring fields are STILL writable pre-scored (score_results' whole
        # job depends on this).
        real_store.write_prediction_score(
            pred_id, final_home_goals=2, final_away_goals=1, result="home",
            brier_score=0.24, log_loss=0.48,
        )
        row = (
            real_store._client.table("predictions")
            .select("status, brier_score, log_loss, result")
            .eq("id", pred_id)
            .execute()
            .data[0]
        )
        assert row["status"] == "scored"
        assert row["brier_score"] == pytest.approx(0.24)
        assert row["result"] == "home"

        # Migration-0003 extension: once scored, THOSE fields re-freeze too.
        with pytest.raises(Exception):
            real_store._client.table("predictions").update(
                {"brier_score": 0.01}
            ).eq("id", pred_id).execute()
        with pytest.raises(Exception):
            real_store._client.table("predictions").update(
                {"status": "locked"}
            ).eq("id", pred_id).execute()
    finally:
        real_store.teardown_season(isolated_season)


# --- (c) DELETE guard blocks a direct delete; teardown_season is the ---------
# sanctioned escape hatch ------------------------------------------------------


@requires_real_db
def test_delete_guard_blocks_direct_delete_but_teardown_season_hatch_works(
    real_store, isolated_season
):
    _fixture_id, pred_id = _seed_prediction(
        real_store, season=isolated_season, status="locked",
        locked_delta=timedelta(hours=-2),
    )
    try:
        with pytest.raises(Exception):
            real_store._client.table("predictions").delete().eq("id", pred_id).execute()

        # Still there -- the guard actually blocked the delete, not a no-op.
        still_there = (
            real_store._client.table("predictions").select("id").eq("id", pred_id).execute().data
        )
        assert len(still_there) == 1
    finally:
        deleted = real_store.teardown_season(isolated_season)
        assert deleted["predictions"] >= 1
        assert deleted["leagues"] == 1

    remaining = real_store.count_season_rows(isolated_season)
    assert remaining == {"leagues": 0, "teams": 0, "fixtures": 0, "predictions": 0}


# --- (a) prob-sum CHECK -------------------------------------------------------


@requires_real_db
def test_prob_sum_check_rejects_probabilities_far_from_one(real_store, isolated_season):
    try:
        fixture_id, _pred_id = _seed_prediction(
            real_store, season=isolated_season, status="published",
            locked_delta=timedelta(days=1),  # future kickoff: not locked yet
        )
        with pytest.raises(Exception):
            real_store._client.table("predictions").insert(
                {
                    "fixture_id": fixture_id,
                    "model_version": "bad-probs-v1",
                    "source": "api-football",
                    "prob_home": 0.9,
                    "prob_draw": 0.9,
                    "prob_away": 0.9,  # sums to 2.7 -- CHECK requires ~1.0
                    "predicted_home_goals": 1,
                    "predicted_away_goals": 1,
                    "locked_at": util.now_utc().isoformat(),
                    "status": "published",
                }
            ).execute()
    finally:
        real_store.teardown_season(isolated_season)


# --- anon role cannot write (RLS + migration-0003 privilege revoke) ----------


@requires_real_db
def test_anon_role_cannot_write(isolated_season):
    anon_key = _resolve_anon_key()
    if not anon_key:
        pytest.skip(
            "No anon/publishable key available -- set SUPABASE_TEST_ANON_KEY, "
            "SUPABASE_ANON_KEY, or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to "
            "exercise this specific assertion. Every other integration test in "
            "this file still runs without it."
        )
    url, _key = _TARGET
    anon_client = create_client(url, anon_key)

    with pytest.raises(Exception):
        anon_client.table("leagues").insert(
            {
                "api_league_id": isolated_season,
                "name": "Anon should not be able to insert this",
                "slug": f"anon-write-test-{isolated_season}",
                "country": "Nowhere",
                "season": isolated_season,
            }
        ).execute()


# ==============================================================================
# v2 premium (migration 0004): profiles / subscriptions / stripe_events /
# fixture_insights, handle_new_user(), public.is_premium(), and their RLS.
# ==============================================================================


def _require_anon_key() -> str:
    """Shared skip guard for the 0004 tests below -- same reason/env-var list
    as ``test_anon_role_cannot_write``, factored out because several new tests
    need the anon/publishable key (either directly, or to sign a real user
    in)."""
    anon_key = _resolve_anon_key()
    if not anon_key:
        pytest.skip(
            "No anon/publishable key available -- set SUPABASE_TEST_ANON_KEY, "
            "SUPABASE_ANON_KEY, or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to "
            "exercise this specific assertion. Every other integration test in "
            "this file still runs without it."
        )
    return anon_key


def _anon_client_or_skip():
    url, _key = _TARGET
    return create_client(url, _require_anon_key())


def _new_test_email(label: str) -> str:
    return f"integration-{label}-{uuid.uuid4().hex}@example.test"


def _create_confirmed_user(service_client, *, email: str, password: str) -> str:
    """Create a REAL, already-confirmed auth.users row via the service-role
    client's GoTrue admin API -- this is what fires handle_new_user() and
    therefore auto-creates the matching `profiles` row. Returns the new
    user's id."""
    resp = service_client.auth.admin.create_user(
        {"email": email, "password": password, "email_confirm": True}
    )
    return resp.user.id


def _signed_in_client(anon_key: str, *, email: str, password: str):
    """A fresh client, signed in as a real user over the anon/publishable key
    -- exactly the credential shape the web app itself uses, so the resulting
    session's `auth.uid()` is genuinely subject to RLS as `authenticated`
    (not `service_role`, and not the grant-less `anon` role)."""
    url, _key = _TARGET
    client = create_client(url, anon_key)
    client.auth.sign_in_with_password({"email": email, "password": password})
    return client


@requires_real_db
def test_migration_0004_objects_are_present(real_store):
    """Proves 0001->0004 applied: profiles/subscriptions/stripe_events/
    fixture_insights and public.is_premium() didn't exist before this
    migration -- a schema that didn't migrate cleanly to 0004 fails this (and
    every other 0004 test in this section) immediately, rather than silently
    no-op'ing."""
    result = real_store._client.rpc("is_premium", {"uid": str(uuid.uuid4())}).execute()
    assert result.data is False  # a random uuid genuinely has no subscription

    for table in ("profiles", "subscriptions", "stripe_events", "fixture_insights"):
        # service_role bypasses RLS -- this only proves the table/columns exist.
        real_store._client.table(table).select("*").limit(1).execute()


@requires_real_db
def test_handle_new_user_auto_provisions_a_profile_row(real_store):
    """The SECURITY DEFINER on_auth_user_created trigger must fire
    synchronously as part of the auth.users insert -- by the time
    create_user() returns, the matching profiles row already exists."""
    email = _new_test_email("auto-profile")
    password = uuid.uuid4().hex
    user_id = _create_confirmed_user(real_store._client, email=email, password=password)
    try:
        rows = (
            real_store._client.table("profiles").select("id, is_18_plus").eq("id", user_id).execute().data
        )
        assert len(rows) == 1
        assert rows[0]["is_18_plus"] is False  # default, never auto-attested
    finally:
        real_store._client.auth.admin.delete_user(user_id)
        # Cascade proof: deleting the auth.users row removes the profiles row too.
        remaining = (
            real_store._client.table("profiles").select("id").eq("id", user_id).execute().data
        )
        assert remaining == []


@requires_real_db
def test_anon_has_zero_access_to_every_billing_and_insights_table(isolated_season):
    """anon gets NO grant at all (not even SELECT) on any of the four 0004
    tables -- every one of these must raise (a PostgREST/PostgreSQL
    permission error), never just return an empty/filtered result set."""
    anon_client = _anon_client_or_skip()

    for table in ("profiles", "subscriptions", "stripe_events", "fixture_insights"):
        with pytest.raises(Exception):
            anon_client.table(table).select("*").execute()

    with pytest.raises(Exception):
        anon_client.table("profiles").insert(
            {"id": str(uuid.uuid4()), "is_18_plus": True}
        ).execute()
    with pytest.raises(Exception):
        anon_client.table("subscriptions").insert(
            {
                "user_id": str(uuid.uuid4()),
                "stripe_customer_id": f"cus_anon_test_{isolated_season}",
                "status": "active",
            }
        ).execute()
    with pytest.raises(Exception):
        anon_client.table("stripe_events").insert(
            {"id": f"evt_anon_test_{isolated_season}", "type": "test"}
        ).execute()


@requires_real_db
def test_authenticated_cannot_write_subscriptions_or_access_stripe_events(real_store):
    """A genuinely signed-in user: profiles has no INSERT policy/grant at all
    (only owner SELECT/UPDATE); subscriptions has NO write policy for
    authenticated whatsoever (writes are service-role/webhook-only); and
    stripe_events has ZERO authenticated grant, not even SELECT."""
    anon_key = _require_anon_key()

    email = _new_test_email("billing-writes")
    password = uuid.uuid4().hex
    user_id = _create_confirmed_user(real_store._client, email=email, password=password)
    try:
        user_client = _signed_in_client(anon_key, email=email, password=password)

        # profiles: no INSERT policy at all (a fresh, unrelated id rules out a
        # PK-conflict false-positive -- this proves the GRANT is absent, not
        # merely that inserting over their own row would collide).
        with pytest.raises(Exception):
            user_client.table("profiles").insert(
                {"id": str(uuid.uuid4()), "is_18_plus": True}
            ).execute()

        # subscriptions: no write policy for authenticated at all.
        with pytest.raises(Exception):
            user_client.table("subscriptions").insert(
                {
                    "user_id": user_id,
                    "stripe_customer_id": f"cus_self_test_{user_id}",
                    "status": "active",
                }
            ).execute()
        with pytest.raises(Exception):
            user_client.table("subscriptions").update({"status": "canceled"}).eq(
                "user_id", user_id
            ).execute()

        # stripe_events: zero grant, not even SELECT.
        with pytest.raises(Exception):
            user_client.table("stripe_events").select("id").execute()
        with pytest.raises(Exception):
            user_client.table("stripe_events").insert(
                {"id": f"evt_self_test_{user_id}", "type": "test"}
            ).execute()
    finally:
        real_store._client.auth.admin.delete_user(user_id)


@requires_real_db
def test_is_premium_gates_fixture_insights_by_subscription_status(real_store, isolated_season):
    """The full matrix requested for this table: anon sees zero rows (denied
    at the grant level), a signed-in user with NO subscription sees zero rows
    (RLS-filtered, not denied), and a signed-in user with an ACTIVE
    subscription sees the row -- proving public.is_premium() and the
    fixture_insights SELECT policy actually gate on subscription status, not
    merely on being authenticated."""
    anon_key = _require_anon_key()
    url, _key = _TARGET
    anon_client = create_client(url, anon_key)

    fixture_id, _pred_id = _seed_prediction(
        real_store, season=isolated_season, status="scored",
        locked_delta=timedelta(hours=-2),
    )
    real_store.insert_insight(
        fixture_id=fixture_id,
        kind="prediction_detail",
        payload={"note": "integration-test payload"},
        source="api-football",
    )

    no_sub_email = _new_test_email("no-sub")
    active_sub_email = _new_test_email("active-sub")
    password = uuid.uuid4().hex
    no_sub_id = _create_confirmed_user(real_store._client, email=no_sub_email, password=password)
    active_sub_id = _create_confirmed_user(
        real_store._client, email=active_sub_email, password=password
    )
    try:
        # An active subscription, written the only way it's ever legitimately
        # written -- the service-role client (standing in for the webhook).
        real_store._client.table("subscriptions").insert(
            {
                "user_id": active_sub_id,
                "stripe_customer_id": f"cus_active_test_{active_sub_id}",
                "status": "active",
                "current_period_end": None,
            }
        ).execute()

        # anon: denied outright (grant-level), regardless of any row's contents.
        with pytest.raises(Exception):
            anon_client.table("fixture_insights").select("*").eq(
                "fixture_id", fixture_id
            ).execute()

        # Authenticated, no subscription row at all: RLS filters to zero rows
        # -- a plain empty result, NOT an exception (the grant IS present).
        no_sub_client = _signed_in_client(anon_key, email=no_sub_email, password=password)
        no_sub_rows = (
            no_sub_client.table("fixture_insights")
            .select("*")
            .eq("fixture_id", fixture_id)
            .execute()
            .data
        )
        assert no_sub_rows == []

        # Authenticated, with an active subscription: sees exactly the one row.
        active_sub_client = _signed_in_client(
            anon_key, email=active_sub_email, password=password
        )
        active_sub_rows = (
            active_sub_client.table("fixture_insights")
            .select("*")
            .eq("fixture_id", fixture_id)
            .execute()
            .data
        )
        assert len(active_sub_rows) == 1
        assert active_sub_rows[0]["payload"]["note"] == "integration-test payload"
    finally:
        real_store._client.auth.admin.delete_user(no_sub_id)
        real_store._client.auth.admin.delete_user(active_sub_id)
        real_store.teardown_season(isolated_season)  # cascades to fixture_insights too


@requires_real_db
def test_is_premium_excludes_a_subscription_past_its_current_period_end(
    real_store, isolated_season
):
    """status='active' alone isn't enough once current_period_end has passed
    -- public.is_premium() must also check that (or a null period_end, for a
    subscription with no fixed end)."""
    anon_key = _require_anon_key()

    fixture_id, _pred_id = _seed_prediction(
        real_store, season=isolated_season, status="scored",
        locked_delta=timedelta(hours=-2),
    )
    real_store.insert_insight(
        fixture_id=fixture_id, kind="prediction_detail",
        payload={"note": "expired-sub test"}, source="api-football",
    )

    email = _new_test_email("expired-sub")
    password = uuid.uuid4().hex
    user_id = _create_confirmed_user(real_store._client, email=email, password=password)
    try:
        expired_end = (util.now_utc() - timedelta(days=1)).isoformat()
        real_store._client.table("subscriptions").insert(
            {
                "user_id": user_id,
                "stripe_customer_id": f"cus_expired_test_{user_id}",
                "status": "active",
                "current_period_end": expired_end,
            }
        ).execute()

        expired_client = _signed_in_client(anon_key, email=email, password=password)
        rows = (
            expired_client.table("fixture_insights")
            .select("*")
            .eq("fixture_id", fixture_id)
            .execute()
            .data
        )
        assert rows == []
    finally:
        real_store._client.auth.admin.delete_user(user_id)
        real_store.teardown_season(isolated_season)
