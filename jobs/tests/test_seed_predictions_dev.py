"""Tests for the dev-only historical seeder (docs/SEEDING.md).

seed_predictions_dev backfills predictions for ALREADY-FINISHED fixtures by reusing
the real fetch_predictions helpers, stamping published_at just before kickoff so the
stock lock/score jobs then treat them as valid pre-kickoff predictions. Covered here:
helper reuse + back-dating, --limit, idempotency, and the DB-only dry-run.

The live-season interlock (the seeder HARD-REFUSES the live default season 2026
unless --allow-live-season is passed) is covered by the interlock tests at the end.
"""

from datetime import timedelta

import pytest

from jobs import config, elo, util
from jobs.config import LIVE_SEASON
from jobs.seed_predictions_dev import PUBLISH_LEAD, run

NOOP_SLEEP = lambda _seconds: None  # noqa: E731 — keep tests off the 7s pacing clock


@pytest.fixture(autouse=True)
def _dev_season(monkeypatch):
    """Default every test here to a DEV season (mirrors WC_SEASON=2022 in jobs/.env),
    so the live-season interlock stays dormant for the behaviour tests. The interlock
    tests re-patch config.SEASON to the live default explicitly."""
    monkeypatch.setattr(config, "SEASON", 2022)


def _finished(make_fixture, **overrides):
    base = dict(status="finished", final_home_goals=2, final_away_goals=1)
    base.update(overrides)
    return make_fixture(**base)


def test_seed_inserts_backdated_api_and_elo(
    make_store, make_api, make_fixture, predictions_payload
):
    fixture = _finished(
        make_fixture, id=300, api_fixture_id=9001,
        home_team_id=200, away_team_id=201,
        kickoff_utc="2022-11-20T16:00:00+00:00",
    )
    store = make_store(finished=[fixture])
    api = make_api(predictions={9001: predictions_payload})

    counts = run(dry_run=False, store=store, api=api, sleep=NOOP_SLEEP)

    assert counts["api_inserted"] == 1 and counts["elo_inserted"] == 1
    assert {p["source"] for p in store.inserted_predictions} == {"api-football", "inhouse-elo"}

    expected_publish = util.parse_iso("2022-11-20T16:00:00+00:00") - PUBLISH_LEAD
    for pred in store.inserted_predictions:
        # locked_at is kickoff; published_at is back-dated a full day BEFORE it, so
        # the real lock_predictions counts it as a valid pre-kickoff prediction.
        assert pred["locked_at"] == "2022-11-20T16:00:00+00:00"
        assert util.parse_iso(pred["published_at"]) == expected_publish
        assert util.parse_iso(pred["published_at"]) < util.parse_iso(pred["locked_at"])
        assert pred["locked_at"] != pred["published_at"]
        assert pred["prob_home"] + pred["prob_draw"] + pred["prob_away"] == pytest.approx(1.0)

    # Reuses the real parse/build helpers: the api-football row carries the parsed
    # 50/30/20 split and a derived scoreline, not some seeder-local fabrication.
    api_row = next(p for p in store.inserted_predictions if p["source"] == "api-football")
    assert api_row["prob_home"] == pytest.approx(0.5)
    assert api_row["prob_draw"] == pytest.approx(0.3)
    assert api_row["prob_away"] == pytest.approx(0.2)
    assert api_row["predicted_home_goals"] == 2 and api_row["predicted_away_goals"] == 1


def test_publish_lead_is_one_day():
    # The back-date margin is what keeps a seeded row on the valid side of kickoff.
    assert PUBLISH_LEAD == timedelta(days=1)


def test_limit_caps_new_api_fetches(
    make_store, make_api, make_fixture, predictions_payload
):
    fixtures = [
        _finished(
            make_fixture, id=300 + i, api_fixture_id=9000 + i,
            kickoff_utc=f"2022-11-2{i}T16:00:00+00:00",
        )
        for i in range(3)
    ]
    store = make_store(finished=fixtures)
    api = make_api(predictions={9000 + i: predictions_payload for i in range(3)})

    counts = run(dry_run=False, store=store, api=api, limit=1, sleep=NOOP_SLEEP)

    assert counts["api_fetched"] == 1  # capped
    assert api.prediction_calls == [9000]  # only the first finished fixture
    # Only that one fixture got seeded (its api + elo rows): 2 predictions total.
    assert len(store.inserted_predictions) == 2


def test_seed_is_idempotent(make_store, make_api, make_fixture, predictions_payload):
    fixture = _finished(make_fixture, id=300, api_fixture_id=9001)
    store = make_store(finished=[fixture])

    first = run(
        dry_run=False, store=store,
        api=make_api(predictions={9001: predictions_payload}), sleep=NOOP_SLEEP,
    )
    assert first["api_inserted"] == 1 and first["elo_inserted"] == 1
    assert len(store.predictions) == 2

    # Re-run against the now-seeded store with a fresh API client.
    api2 = make_api(predictions={9001: predictions_payload})
    second = run(dry_run=False, store=store, api=api2, sleep=NOOP_SLEEP)

    assert second["api_inserted"] == 0 and second["elo_inserted"] == 0
    assert second["api_skipped_existing"] == 1 and second["elo_skipped_existing"] == 1
    assert api2.prediction_calls == []  # already-seeded fixture is never re-fetched
    assert len(store.predictions) == 2  # no duplicates


def test_dry_run_writes_nothing_and_calls_no_api(
    make_store, make_api, make_fixture, predictions_payload
):
    fixture = _finished(make_fixture, id=300, api_fixture_id=9001)
    store = make_store(finished=[fixture])
    api = make_api(predictions={9001: predictions_payload})

    counts = run(dry_run=True, store=store, api=api, sleep=NOOP_SLEEP)

    assert store.inserted_predictions == []  # no writes
    # Unlike the stock jobs, the seeder's dry-run is DB-only: it spends no budget.
    assert api.request_count == 0
    assert api.prediction_calls == []
    assert counts["api_fetched"] == 1  # but still reports what it WOULD fetch


def test_dry_run_handles_empty_store(make_store, make_api):
    counts = run(dry_run=True, store=make_store(finished=[]), api=make_api(), sleep=NOOP_SLEEP)
    assert counts["finished"] == 0
    assert counts["api_fetched"] == 0 and counts["elo_inserted"] == 0


# --- the write set is PHYSICALLY confined to config.SEASON, not just the -----
# config-identity interlock (v2 hardening: the seeder must not be able to
# back-date predictions onto a DIFFERENT season's finished fixtures in a
# mixed DB -- the exact scenario mid-cutover, when both the disposable 2022
# dev season and the live 2026 season coexist) ------------------------------


def test_seeder_never_touches_a_different_seasons_finished_fixtures(
    make_store, make_api, make_fixture, predictions_payload
):
    # config.SEASON == 2022 here (autouse _dev_season). A finished fixture
    # explicitly tagged as the LIVE 2026 season must be read-invisible to the
    # seeder even though it's sitting right there in the same store.
    dev_fixture = _finished(
        make_fixture, id=300, api_fixture_id=9001, season=2022,
        kickoff_utc="2022-11-20T16:00:00+00:00",
    )
    live_fixture = _finished(
        make_fixture, id=301, api_fixture_id=9002, season=2026,
        kickoff_utc="2026-06-20T16:00:00+00:00",
    )
    store = make_store(finished=[dev_fixture, live_fixture])
    api = make_api(predictions={9001: predictions_payload, 9002: predictions_payload})

    counts = run(dry_run=False, store=store, api=api, sleep=NOOP_SLEEP)

    assert counts["finished"] == 1  # only the dev-season fixture was ever seen
    assert api.prediction_calls == [9001]  # the live fixture's API was never called
    fixture_ids_seeded = {p["fixture_id"] for p in store.inserted_predictions}
    assert fixture_ids_seeded == {300}  # the live fixture (301) was never touched


def test_seeded_elo_uses_replayed_ratings(make_store, make_api, make_fixture):
    # Elo ratings are derived by replaying finished results; a 2-0 win should lift
    # the home side above the cold-start default. Empty api payload isolates Elo.
    fixture = _finished(
        make_fixture, id=300, api_fixture_id=9001,
        home_team_id=200, away_team_id=201,
        final_home_goals=2, final_away_goals=0,
        kickoff_utc="2022-11-20T16:00:00+00:00",
    )
    store = make_store(finished=[fixture])
    api = make_api(predictions={9001: {"response": []}})

    counts = run(dry_run=False, store=store, api=api, sleep=NOOP_SLEEP)

    assert counts["elo_inserted"] == 1
    elo_row = next(p for p in store.inserted_predictions if p["source"] == "inhouse-elo")
    default_home = elo.match_probabilities(elo.DEFAULT_RATING, elo.DEFAULT_RATING)["home"]
    assert elo_row["prob_home"] > default_home


# --- safety interlock: refuse the live production season ----------------------


def test_refuses_live_default_season(
    monkeypatch, make_store, make_api, make_fixture, predictions_payload
):
    # Configured for the live default (2026): seeding back-dated rows onto the real
    # ledger must be refused outright.
    monkeypatch.setattr(config, "SEASON", LIVE_SEASON)
    store = make_store(finished=[_finished(make_fixture, id=300, api_fixture_id=9001)])
    api = make_api(predictions={9001: predictions_payload})

    with pytest.raises(SystemExit):
        run(dry_run=False, store=store, api=api, sleep=NOOP_SLEEP)

    # The refusal happens BEFORE any work: nothing written, no API budget spent.
    assert store.inserted_predictions == []
    assert api.request_count == 0


def test_dry_run_does_not_bypass_the_interlock(
    monkeypatch, make_store, make_api, make_fixture, predictions_payload
):
    # The interlock is about WHICH season, not about writes — a dry-run must refuse too.
    monkeypatch.setattr(config, "SEASON", LIVE_SEASON)
    store = make_store(finished=[_finished(make_fixture, id=300, api_fixture_id=9001)])
    api = make_api(predictions={9001: predictions_payload})

    with pytest.raises(SystemExit):
        run(dry_run=True, store=store, api=api, sleep=NOOP_SLEEP)


def test_allow_live_season_overrides_the_interlock(
    monkeypatch, make_store, make_api, make_fixture, predictions_payload
):
    monkeypatch.setattr(config, "SEASON", LIVE_SEASON)
    store = make_store(finished=[_finished(make_fixture, id=300, api_fixture_id=9001)])
    api = make_api(predictions={9001: predictions_payload})

    counts = run(dry_run=False, store=store, api=api, sleep=NOOP_SLEEP, allow_live=True)

    assert counts["api_inserted"] == 1 and counts["elo_inserted"] == 1  # proceeds


def test_dev_season_seeds_without_override(
    make_store, make_api, make_fixture, predictions_payload
):
    # config.SEASON is a dev season here (autouse _dev_season) -> no override needed.
    store = make_store(finished=[_finished(make_fixture, id=300, api_fixture_id=9001)])
    api = make_api(predictions={9001: predictions_payload})

    counts = run(dry_run=False, store=store, api=api, sleep=NOOP_SLEEP)

    assert counts["api_inserted"] == 1 and counts["elo_inserted"] == 1
