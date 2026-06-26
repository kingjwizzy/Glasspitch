"""Tests for the season teardown — the go-live cutover safety net (docs/SEEDING.md).

Exercises the REAL jobs.db.SupabaseStore.delete_season / count_season_rows (run
against an in-memory FakeSupabaseClient, no DB) plus the jobs.reset_season.run
orchestration on top of them. The cutover bet is "wiping 2022 leaves the rest of
the DB untouched"; the season-isolation and FK-order tests below prove it.
"""

import pytest

from jobs.db import SupabaseStore
from jobs.reset_season import LIVE_SEASON, run


def _season_dataset(*, season, league_id, base):
    """A coherent leagues/teams/fixtures/predictions set for one season.

    ``base`` offsets row ids so two seasons never collide. Includes a LOCKED and a
    SCORED prediction (the immutable ledger rows) so teardown is exercised against
    rows the §7 trigger protects from UPDATE — delete must still remove them.
    """
    return {
        "leagues": [
            {"id": league_id, "api_league_id": league_id, "season": season,
             "name": f"WC{season}", "slug": f"wc{season}", "country": "World"},
        ],
        "teams": [
            {"id": base + 1, "api_team_id": base + 1, "league_id": league_id},
            {"id": base + 2, "api_team_id": base + 2, "league_id": league_id},
        ],
        "fixtures": [
            {"id": base + 11, "league_id": league_id, "status": "finished"},
            {"id": base + 12, "league_id": league_id, "status": "scheduled"},
        ],
        "predictions": [
            {"id": f"p{base + 101}", "fixture_id": base + 11, "status": "locked"},
            {"id": f"p{base + 102}", "fixture_id": base + 11, "status": "scored"},
            {"id": f"p{base + 103}", "fixture_id": base + 12, "status": "published"},
        ],
    }


def _merge(*datasets):
    merged = {"leagues": [], "teams": [], "fixtures": [], "predictions": []}
    for ds in datasets:
        for table, rows in ds.items():
            merged[table].extend(rows)
    return merged


# --- count_season_rows -------------------------------------------------------


def test_count_season_rows_accurate_for_seeded_season(make_supabase_client):
    client = make_supabase_client(**_season_dataset(season=2022, league_id=1, base=0))
    counts = SupabaseStore(client=client).count_season_rows(2022)
    assert counts == {"leagues": 1, "teams": 2, "fixtures": 2, "predictions": 3}


def test_count_season_rows_zero_for_absent_season(make_supabase_client):
    client = make_supabase_client(**_season_dataset(season=2022, league_id=1, base=0))
    counts = SupabaseStore(client=client).count_season_rows(2026)
    assert counts == {"leagues": 0, "teams": 0, "fixtures": 0, "predictions": 0}


# --- delete_season: correctness, FK order, isolation, immutable rows ----------


def test_delete_season_removes_all_rows_for_the_season(make_supabase_client):
    client = make_supabase_client(**_season_dataset(season=2022, league_id=1, base=0))
    store = SupabaseStore(client=client)

    deleted = store.delete_season(2022)

    assert deleted == {"leagues": 1, "teams": 2, "fixtures": 2, "predictions": 3}
    # Nothing left for the season, in any table.
    assert store.count_season_rows(2022) == {
        "leagues": 0, "teams": 0, "fixtures": 0, "predictions": 0,
    }
    assert client.tables["leagues"] == []
    assert client.tables["teams"] == []
    assert client.tables["fixtures"] == []
    assert client.tables["predictions"] == []


def test_delete_season_uses_fk_safe_order(make_supabase_client):
    """predictions -> fixtures -> teams -> leagues (children before parents)."""
    client = make_supabase_client(**_season_dataset(season=2022, league_id=1, base=0))
    SupabaseStore(client=client).delete_season(2022)
    assert client.delete_log == ["predictions", "fixtures", "teams", "leagues"]


def test_delete_season_isolates_other_seasons(make_supabase_client):
    # The property the cutover depends on: wiping 2022 leaves 2026 fully intact.
    data = _merge(
        _season_dataset(season=2022, league_id=1, base=0),
        _season_dataset(season=2026, league_id=2, base=500),
    )
    client = make_supabase_client(**data)
    store = SupabaseStore(client=client)

    before_2026 = store.count_season_rows(2026)
    deleted = store.delete_season(2022)

    assert deleted == {"leagues": 1, "teams": 2, "fixtures": 2, "predictions": 3}
    assert store.count_season_rows(2022) == {
        "leagues": 0, "teams": 0, "fixtures": 0, "predictions": 0,
    }
    # Season 2026 is untouched — same counts, and the exact rows still present.
    assert store.count_season_rows(2026) == before_2026
    assert {l["id"] for l in client.tables["leagues"]} == {2}
    assert {t["id"] for t in client.tables["teams"]} == {501, 502}
    assert {f["id"] for f in client.tables["fixtures"]} == {511, 512}
    assert {p["id"] for p in client.tables["predictions"]} == {"p601", "p602", "p603"}


def test_delete_season_removes_locked_and_scored_predictions(make_supabase_client):
    # Immutability guards UPDATE, not DELETE: the ledger's locked/scored rows must
    # still be torn down by a season reset.
    client = make_supabase_client(**_season_dataset(season=2022, league_id=1, base=0))
    statuses_before = {p["status"] for p in client.tables["predictions"]}
    assert {"locked", "scored"} <= statuses_before  # the dataset really has them

    SupabaseStore(client=client).delete_season(2022)

    assert client.tables["predictions"] == []  # locked + scored rows gone too


def test_delete_season_is_idempotent(make_supabase_client):
    client = make_supabase_client(**_season_dataset(season=2022, league_id=1, base=0))
    store = SupabaseStore(client=client)

    first = store.delete_season(2022)
    assert first == {"leagues": 1, "teams": 2, "fixtures": 2, "predictions": 3}

    deletes_after_first = len(client.delete_log)
    second = store.delete_season(2022)  # no-op, no error

    assert second == {"leagues": 0, "teams": 0, "fixtures": 0, "predictions": 0}
    # Nothing left to delete -> no further delete calls were issued.
    assert len(client.delete_log) == deletes_after_first


# --- edge cases --------------------------------------------------------------


def test_delete_season_empty_store_is_a_noop(make_supabase_client):
    client = make_supabase_client()  # nothing seeded
    deleted = SupabaseStore(client=client).delete_season(2022)
    assert deleted == {"leagues": 0, "teams": 0, "fixtures": 0, "predictions": 0}
    assert client.delete_log == []  # no league ids -> no delete calls at all


def test_delete_season_fixtures_but_no_predictions(make_supabase_client):
    data = _season_dataset(season=2022, league_id=1, base=0)
    data["predictions"] = []  # league + teams + fixtures, but no predictions
    client = make_supabase_client(**data)
    store = SupabaseStore(client=client)

    deleted = store.delete_season(2022)

    assert deleted == {"leagues": 1, "teams": 2, "fixtures": 2, "predictions": 0}
    assert store.count_season_rows(2022) == {
        "leagues": 0, "teams": 0, "fixtures": 0, "predictions": 0,
    }
    # The predictions delete still fires (guarded on fixture_ids, not on row count).
    assert client.delete_log == ["predictions", "fixtures", "teams", "leagues"]


def test_delete_season_with_no_matching_league(make_supabase_client):
    # Season present in the DB, but not the one we ask to delete.
    client = make_supabase_client(**_season_dataset(season=2026, league_id=2, base=500))
    store = SupabaseStore(client=client)

    deleted = store.delete_season(2022)

    assert deleted == {"leagues": 0, "teams": 0, "fixtures": 0, "predictions": 0}
    assert client.delete_log == []  # nothing matched -> nothing deleted
    assert store.count_season_rows(2026) == {
        "leagues": 1, "teams": 2, "fixtures": 2, "predictions": 3,
    }


# --- reset_season.run orchestration (dry-run vs live) ------------------------


def test_reset_season_dry_run_reports_counts_and_deletes_nothing(make_supabase_client):
    client = make_supabase_client(**_season_dataset(season=2022, league_id=1, base=0))
    store = SupabaseStore(client=client)

    summary = run(season=2022, dry_run=True, store=store)

    assert summary["dry_run"] is True
    assert summary["would_delete"] == {
        "leagues": 1, "teams": 2, "fixtures": 2, "predictions": 3,
    }
    # Absolutely nothing was deleted.
    assert client.delete_log == []
    assert store.count_season_rows(2022) == {
        "leagues": 1, "teams": 2, "fixtures": 2, "predictions": 3,
    }


def test_reset_season_live_deletes_and_reports_zero_remaining(make_supabase_client):
    data = _merge(
        _season_dataset(season=2022, league_id=1, base=0),
        _season_dataset(season=2026, league_id=2, base=500),
    )
    client = make_supabase_client(**data)
    store = SupabaseStore(client=client)

    summary = run(season=2022, dry_run=False, store=store)

    assert summary["dry_run"] is False
    assert summary["deleted"] == {"leagues": 1, "teams": 2, "fixtures": 2, "predictions": 3}
    assert summary["remaining"] == {"leagues": 0, "teams": 0, "fixtures": 0, "predictions": 0}
    # The other season survives the cutover.
    assert store.count_season_rows(2026) == {
        "leagues": 1, "teams": 2, "fixtures": 2, "predictions": 3,
    }


# --- safety interlock: refuse deleting the live production season -------------
# Symmetry with the seed_predictions_dev interlock: the cutover tears down the
# disposable dev season (2022), never the real 2026 ledger. A stray --season 2026
# must be refused unless --allow-live-season is passed.


def test_reset_season_refuses_live_default_season(make_supabase_client):
    client = make_supabase_client(**_season_dataset(season=LIVE_SEASON, league_id=2, base=500))
    store = SupabaseStore(client=client)

    with pytest.raises(SystemExit):
        run(season=LIVE_SEASON, dry_run=False, store=store)

    # Refusal happens before any DB work: nothing deleted, the live data is intact.
    assert client.delete_log == []
    assert store.count_season_rows(LIVE_SEASON) == {
        "leagues": 1, "teams": 2, "fixtures": 2, "predictions": 3,
    }


def test_reset_season_dry_run_does_not_bypass_interlock(make_supabase_client):
    # The interlock is about WHICH season, not about writes — even a dry-run refuses.
    client = make_supabase_client(**_season_dataset(season=LIVE_SEASON, league_id=2, base=500))
    store = SupabaseStore(client=client)

    with pytest.raises(SystemExit):
        run(season=LIVE_SEASON, dry_run=True, store=store)

    assert client.delete_log == []


def test_reset_season_allow_live_override_deletes(make_supabase_client):
    client = make_supabase_client(**_season_dataset(season=LIVE_SEASON, league_id=2, base=500))
    store = SupabaseStore(client=client)

    summary = run(season=LIVE_SEASON, dry_run=False, store=store, allow_live=True)

    assert summary["deleted"] == {"leagues": 1, "teams": 2, "fixtures": 2, "predictions": 3}
    assert summary["remaining"] == {"leagues": 0, "teams": 0, "fixtures": 0, "predictions": 0}
    assert client.delete_log == ["predictions", "fixtures", "teams", "leagues"]


def test_reset_season_dev_season_proceeds_without_override(make_supabase_client):
    # A normal dev teardown (--season 2022) is untouched by the interlock.
    client = make_supabase_client(**_season_dataset(season=2022, league_id=1, base=0))
    store = SupabaseStore(client=client)

    summary = run(season=2022, dry_run=False, store=store)

    assert summary["deleted"] == {"leagues": 1, "teams": 2, "fixtures": 2, "predictions": 3}
    assert store.count_season_rows(2022) == {
        "leagues": 0, "teams": 0, "fixtures": 0, "predictions": 0,
    }
