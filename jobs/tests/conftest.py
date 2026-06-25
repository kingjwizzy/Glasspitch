"""Shared test doubles and sample payloads for the jobs tests.

No network and no database: the jobs take an injectable ``store`` and ``api``,
and these in-memory fakes mimic the subset of behaviour the jobs rely on.
"""

from __future__ import annotations

import pytest

from jobs import util


class FakeStore:
    """In-memory stand-in for jobs.db.SupabaseStore (same method surface)."""

    def __init__(self, *, upcoming=None, finished=None, predictions=None):
        self._upcoming = list(upcoming or [])
        self._finished = list(finished or [])
        self.predictions = [dict(p) for p in (predictions or [])]
        # recorded writes
        self.upserted_leagues: list[dict] = []
        self.upserted_teams: list[dict] = []
        self.upserted_fixtures: list[dict] = []
        self.inserted_predictions: list[dict] = []
        self.locked: list[str] = []
        self.voided: list[str] = []
        self.scored: list[dict] = []
        self._seq = 0

    # ----- reads -----
    def upcoming_fixtures(self):
        return [dict(f) for f in self._upcoming]

    def finished_fixtures(self):
        return [dict(f) for f in self._finished]

    def finished_fixtures_ordered(self):
        return [dict(f) for f in sorted(self._finished, key=lambda f: f["kickoff_utc"])]

    def existing_prediction_fixture_ids(self, source):
        return {p["fixture_id"] for p in self.predictions if p["source"] == source}

    def published_predictions_due(self, now_iso):
        now = util.parse_iso(now_iso)
        return [
            dict(p)
            for p in self.predictions
            if p["status"] == "published" and util.parse_iso(p["locked_at"]) <= now
        ]

    def locked_unscored_predictions(self, fixture_id):
        return [
            dict(p)
            for p in self.predictions
            if p["fixture_id"] == fixture_id and p["status"] == "locked"
        ]

    # ----- writes -----
    def upsert_league(self, **kw):
        self.upserted_leagues.append(kw)
        self._seq += 1
        return 1000 + self._seq

    def upsert_team(self, **kw):
        self.upserted_teams.append(kw)
        self._seq += 1
        return 2000 + self._seq

    def upsert_fixture(self, **kw):
        self.upserted_fixtures.append(kw)
        self._seq += 1
        return 3000 + self._seq

    def insert_prediction(self, row):
        for existing in self.predictions:
            if (
                existing["fixture_id"] == row["fixture_id"]
                and existing["model_version"] == row["model_version"]
            ):
                return None  # unique (fixture_id, model_version) violation
        self._seq += 1
        new = dict(row)
        new.setdefault("status", "published")
        new["id"] = f"pred-{self._seq}"
        self.predictions.append(new)
        self.inserted_predictions.append(new)
        return new["id"]

    def mark_locked(self, prediction_id):
        self.locked.append(prediction_id)
        for p in self.predictions:
            if p["id"] == prediction_id:
                p["status"] = "locked"

    def mark_unlocked_void(self, prediction_id):
        self.voided.append(prediction_id)
        for p in self.predictions:
            if p["id"] == prediction_id:
                p["status"] = "unlocked_void"

    def write_prediction_score(
        self, prediction_id, *, final_home_goals, final_away_goals, result,
        brier_score, log_loss, scored_at=None,
    ):
        self.scored.append(
            {
                "id": prediction_id,
                "result": result,
                "brier_score": brier_score,
                "log_loss": log_loss,
                "scored_at": scored_at,
            }
        )
        for p in self.predictions:
            if p["id"] == prediction_id:
                p.update(
                    {
                        "status": "scored",
                        "final_home_goals": final_home_goals,
                        "final_away_goals": final_away_goals,
                        "result": result,
                        "brier_score": brier_score,
                        "log_loss": log_loss,
                        "scored_at": scored_at,
                    }
                )


class FakeApiClient:
    """In-memory stand-in for jobs.apiclient.ApiFootballClient."""

    def __init__(self, *, fixtures=None, predictions=None):
        self._fixtures = fixtures if fixtures is not None else {"response": []}
        self._predictions = predictions or {}  # api_fixture_id -> payload
        self.request_count = 0
        self.fixture_calls: list[tuple[int, int]] = []
        self.prediction_calls: list[int] = []

    def get_fixtures(self, league, season):
        self.request_count += 1
        self.fixture_calls.append((league, season))
        return self._fixtures

    def get_predictions(self, fixture):
        self.request_count += 1
        self.prediction_calls.append(fixture)
        return self._predictions.get(fixture, {"response": []})


# --- fixtures (factories keep tests terse and isolated) ----------------------


@pytest.fixture
def store():
    return FakeStore()


@pytest.fixture
def make_store():
    return FakeStore


@pytest.fixture
def make_api():
    return FakeApiClient


@pytest.fixture
def make_fixture():
    def _make(**overrides):
        base = {
            "id": 300,
            "api_fixture_id": 9000,
            "league_id": 100,
            "home_team_id": 200,
            "away_team_id": 201,
            "kickoff_utc": "2026-06-11T18:00:00+00:00",
            "status": "scheduled",
            "final_home_goals": None,
            "final_away_goals": None,
        }
        base.update(overrides)
        return base

    return _make


@pytest.fixture
def make_prediction():
    def _make(**overrides):
        base = {
            "id": "pred-1",
            "fixture_id": 300,
            "model_version": "api-football-v1",
            "source": "api-football",
            "prob_home": 0.5,
            "prob_draw": 0.3,
            "prob_away": 0.2,
            "predicted_home_goals": 2,
            "predicted_away_goals": 1,
            "published_at": "2026-06-11T10:00:00+00:00",
            "locked_at": "2026-06-11T18:00:00+00:00",
            "status": "published",
            "tier": "free",
            "final_home_goals": None,
            "final_away_goals": None,
            "result": None,
            "brier_score": None,
            "log_loss": None,
            "scored_at": None,
        }
        base.update(overrides)
        return base

    return _make


@pytest.fixture
def fixtures_payload():
    """A realistic API-Football /fixtures payload: one upcoming, one finished."""
    return {
        "response": [
            {
                "fixture": {
                    "id": 9001,
                    "date": "2026-06-11T16:00:00+00:00",
                    "status": {"short": "NS", "long": "Not Started"},
                },
                "league": {"id": 1, "name": "World Cup", "country": "World", "season": 2026},
                "teams": {
                    "home": {"id": 2380, "name": "Brazil"},
                    "away": {"id": 26, "name": "Argentina"},
                },
                "goals": {"home": None, "away": None},
                "score": {"fulltime": {"home": None, "away": None}},
            },
            {
                "fixture": {
                    "id": 9002,
                    "date": "2026-06-10T16:00:00+00:00",
                    "status": {"short": "FT", "long": "Match Finished"},
                },
                "league": {"id": 1, "name": "World Cup", "country": "World", "season": 2026},
                "teams": {
                    "home": {"id": 2, "name": "France"},
                    "away": {"id": 25, "name": "Germany"},
                },
                "goals": {"home": 2, "away": 1},
                "score": {"fulltime": {"home": 2, "away": 1}},
            },
        ]
    }


@pytest.fixture
def predictions_payload():
    """A realistic API-Football /predictions payload (percentages sum to 100)."""
    return {
        "response": [
            {
                "predictions": {
                    "winner": {"id": 2380, "name": "Brazil", "comment": "Win or draw"},
                    "percent": {"home": "50%", "draw": "30%", "away": "20%"},
                    "advice": "Double chance : Brazil or draw",
                    "goals": {"home": "-1.5", "away": "-1.5"},
                },
                "teams": {},
            }
        ]
    }
