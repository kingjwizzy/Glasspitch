"""Shared test doubles and sample payloads for the jobs tests.

No network and no database: the jobs take an injectable ``store`` and ``api``,
and these in-memory fakes mimic the subset of behaviour the jobs rely on.

v2 hardening note: several FakeStore reads use a "wildcard" convention for new
optional keys (``season`` / ``api_league_id``) on fixture dicts -- if a test's
fixture doesn't set the key, it matches whatever season/league is requested.
This keeps every pre-existing test (which never set those keys) passing
unchanged while letting NEW tests opt into season/league scoping assertions by
setting the key explicitly on some fixtures and not others.
"""

from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace

import pytest

from jobs import util


class FakeStore:
    """In-memory stand-in for jobs.db.SupabaseStore (same method surface)."""

    # 6 hours before make_fixture's default kickoff (18:00 same day) -- well
    # within any sane PREDICTION_FETCH_WINDOW_HOURS, so every pre-existing test
    # that never thought about the kickoff window still passes unchanged.
    DEFAULT_NOW = "2026-06-11T12:00:00+00:00"

    def __init__(
        self,
        *,
        upcoming=None,
        finished=None,
        predictions=None,
        insights=None,
        now=None,
        leagues=None,
        top_scorers=None,
    ):
        self._upcoming = list(upcoming or [])
        self._finished = list(finished or [])
        self.predictions = [dict(p) for p in (predictions or [])]
        self.insights: list[dict] = [dict(i) for i in (insights or [])]
        self._now = util.parse_iso(now) if now else util.parse_iso(self.DEFAULT_NOW)
        # {api_league_id: internal league_id} -- jobs.fetch_topscorers.py's
        # league_id_for_api_league_id lookup. Absent by default: a league not
        # explicitly seeded here mirrors "fetch_fixtures hasn't synced it yet".
        self._leagues: dict[int, int] = dict(leagues or {})
        self.top_scorers: list[dict] = [dict(r) for r in (top_scorers or [])]
        # recorded writes
        self.upserted_leagues: list[dict] = []
        self.upserted_teams: list[dict] = []
        self.upserted_fixtures: list[dict] = []
        self.inserted_predictions: list[dict] = []
        self.locked: list[str] = []
        self.voided: list[str] = []
        self.closed_terminal: list[int] = []
        self.scored: list[dict] = []
        self.replace_top_scorers_calls: list[dict] = []
        self._seq = 0

    # ----- reads -----
    def upcoming_fixtures_within(self, hours):
        until = self._now + timedelta(hours=hours)
        return [
            dict(f)
            for f in self._upcoming
            if f.get("status") == "scheduled"
            and self._now <= util.parse_iso(f["kickoff_utc"]) <= until
        ]

    def finished_fixtures_for_season(self, season):
        # Wildcard: a fixture without a "season" key matches ANY requested
        # season (see module docstring) -- lets pre-existing tests ignore
        # scoping entirely while new tests assert it by setting "season".
        return [dict(f) for f in self._finished if f.get("season", season) == season]

    def finished_fixtures_for_replay(self, *, api_league_ids, season):
        if not api_league_ids:
            return []
        default_league = api_league_ids[0]  # wildcard default, see above
        return [
            dict(f)
            for f in self._finished
            if f.get("season", season) == season
            and f.get("api_league_id", default_league) in api_league_ids
        ]

    def existing_prediction_fixture_ids(self, source):
        return {p["fixture_id"] for p in self.predictions if p["source"] == source}

    # ----- top_scorers (jobs/fetch_topscorers.py, migration 0005) -- mirrors
    # jobs.db.SupabaseStore's upsert-then-prune semantics exactly, so job-level
    # tests exercise the real idempotency contract, not a simplified stand-in.
    def league_id_for_api_league_id(self, api_league_id):
        return self._leagues.get(api_league_id)

    def replace_top_scorers(self, *, league_id, rows):
        self.replace_top_scorers_calls.append(
            {"league_id": league_id, "rows": [dict(r) for r in rows]}
        )
        if not rows:
            return {"upserted": 0, "pruned": 0}

        keep_ids = set()
        for row in rows:
            keep_ids.add(row["api_player_id"])
            existing = next(
                (
                    r
                    for r in self.top_scorers
                    if r["league_id"] == league_id and r["api_player_id"] == row["api_player_id"]
                ),
                None,
            )
            if existing is not None:
                existing.update(row)
            else:
                new_row = dict(row)
                new_row["league_id"] = league_id
                self.top_scorers.append(new_row)

        stale = [
            r
            for r in self.top_scorers
            if r["league_id"] == league_id and r["api_player_id"] not in keep_ids
        ]
        for r in stale:
            self.top_scorers.remove(r)

        return {"upserted": len(rows), "pruned": len(stale)}

    def top_scorers_for_league(self, league_id):
        rows = [dict(r) for r in self.top_scorers if r["league_id"] == league_id]
        rows.sort(key=lambda r: r["rank"])
        return rows

    # ----- v2 premium: fixture_insights (mirrors jobs.db.SupabaseStore) -------
    def existing_insight_fixture_ids(self, kind):
        return {i["fixture_id"] for i in self.insights if i["kind"] == kind}

    def fixtures_needing_stats(self, *, api_league_ids, season):
        """Mirrors jobs.db.SupabaseStore.fixtures_needing_stats: finished
        fixtures (tracked league(s) + season, wildcard convention -- see
        module docstring) with a SCORED api-football prediction but no
        post_match_stats insight yet, most-recently-finished first."""
        if not api_league_ids:
            return []
        default_league = api_league_ids[0]  # wildcard default, see module docstring
        have_stats = self.existing_insight_fixture_ids("post_match_stats")
        scored_fixture_ids = {
            p["fixture_id"]
            for p in self.predictions
            if p["source"] == "api-football" and p["status"] == "scored"
        }
        candidates = [
            dict(f)
            for f in self._finished
            if f.get("status") == "finished"
            and f.get("season", season) == season
            and f.get("api_league_id", default_league) in api_league_ids
            and f["id"] in scored_fixture_ids
            and f["id"] not in have_stats
        ]
        candidates.sort(key=lambda f: f["kickoff_utc"], reverse=True)
        return [
            {
                "id": f["id"],
                "api_fixture_id": f["api_fixture_id"],
                "kickoff_utc": f["kickoff_utc"],
                "home_team_api_id": f.get("home_team_api_id"),
                "away_team_api_id": f.get("away_team_api_id"),
            }
            for f in candidates
        ]

    def published_predictions_due(self, now_iso):
        now = util.parse_iso(now_iso)
        return [
            dict(p)
            for p in self.predictions
            if p["status"] == "published" and util.parse_iso(p["locked_at"]) <= now
        ]

    def locked_predictions_due_for_scoring(self):
        """Mirrors jobs.db.SupabaseStore.locked_predictions_due_for_scoring:
        LOCKED predictions whose fixture is FINISHED, with the fixture's finals
        embedded under "fixture" -- built from the SAME (finished, predictions)
        lists the old finished_fixtures_ordered()+locked_unscored_predictions()
        pair used, so existing test setups keep working unchanged."""
        finished_by_id = {f["id"]: f for f in self._finished}
        rows = []
        for p in self.predictions:
            if p["status"] != "locked":
                continue
            fixture = finished_by_id.get(p["fixture_id"])
            if fixture is None or fixture.get("status") != "finished":
                continue
            row = dict(p)
            row["fixture"] = {
                "id": fixture["id"],
                "status": fixture["status"],
                "final_home_goals": fixture.get("final_home_goals"),
                "final_away_goals": fixture.get("final_away_goals"),
            }
            rows.append(row)
        return rows

    def scored_predictions_with_mismatched_final_score(self):
        """Mirrors jobs.db.SupabaseStore.scored_predictions_with_mismatched_final_score."""
        finished_by_id = {f["id"]: f for f in self._finished}
        mismatches = []
        for p in self.predictions:
            if p["status"] != "scored":
                continue
            fixture = finished_by_id.get(p["fixture_id"])
            if fixture is None:
                continue
            if fixture.get("final_home_goals") != p.get(
                "final_home_goals"
            ) or fixture.get("final_away_goals") != p.get("final_away_goals"):
                row = dict(p)
                row["fixture"] = {
                    "id": fixture["id"],
                    "final_home_goals": fixture.get("final_home_goals"),
                    "final_away_goals": fixture.get("final_away_goals"),
                }
                mismatches.append(row)
        return mismatches

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
        # Deterministic (independent of call order/other upserts in the same
        # run) so tests can predict the id a fixture will be assigned without
        # tracking the shared league/team _seq counter -- e.g. to pre-seed a
        # prediction row that a terminal-closure test expects to be touched.
        return 900_000 + kw["api_fixture_id"]

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

    def insert_insight(self, *, fixture_id, kind, payload, source="api-football"):
        """Idempotent upsert keyed on (fixture_id, kind) -- mirrors
        jobs.db.SupabaseStore.insert_insight's real composite-conflict-target
        upsert: a second call for the same (fixture_id, kind) replaces the
        stored payload/source rather than erroring or duplicating the row."""
        for existing in self.insights:
            if existing["fixture_id"] == fixture_id and existing["kind"] == kind:
                existing["payload"] = payload
                existing["source"] = source
                return fixture_id
        self.insights.append(
            {"fixture_id": fixture_id, "kind": kind, "payload": payload, "source": source}
        )
        return fixture_id

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

    def close_out_terminal_fixture_predictions(self, fixture_id):
        count = 0
        for p in self.predictions:
            if p["fixture_id"] == fixture_id and p["status"] in ("published", "locked"):
                p["status"] = "void_cancelled"
                count += 1
        if count:
            self.closed_terminal.append(fixture_id)
        return count

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
    """In-memory stand-in for jobs.apiclient.ApiFootballClient.

    ``fixtures``: a single-page /fixtures payload returned for every
      league/page (the common case: one tracked league, one page).
    ``fixtures_pages``: a list of payloads, page N (1-indexed) =
      fixtures_pages[N-1] -- lets pagination tests simulate a multi-page
      /fixtures response (jobs/fetch_fixtures.py loops until
      paging.current >= paging.total).
    ``fixtures_by_league``: {api_league_id: payload_or_pages_or_exception};
      overrides both of the above for that league -- lets per-league
      error-isolation tests make ONE tracked league fail/exhaust budget while
      another still succeeds. A mapped Exception INSTANCE is raised.
    ``predictions``: {api_fixture_id: payload_or_exception}; a mapped
      Exception instance is raised instead of returned -- per-fixture
      error-isolation tests for fetch_predictions.
    ``statistics``: {api_fixture_id: payload_or_exception}; same convention as
      ``predictions`` -- per-fixture error-isolation tests for fetch_insights.
    ``topscorers``: {api_league_id: payload_or_exception}; same convention as
      ``predictions``/``statistics`` -- per-league error-isolation tests for
      fetch_topscorers.
    """

    def __init__(
        self,
        *,
        fixtures=None,
        fixtures_pages=None,
        fixtures_by_league=None,
        predictions=None,
        statistics=None,
        topscorers=None,
    ):
        self._fixtures = fixtures if fixtures is not None else {"response": []}
        self._fixtures_pages = fixtures_pages
        self._fixtures_by_league = fixtures_by_league or {}
        self._predictions = predictions or {}  # api_fixture_id -> payload | Exception
        self._statistics = statistics or {}  # api_fixture_id -> payload | Exception
        self._topscorers = topscorers or {}  # api_league_id -> payload | Exception
        self.request_count = 0
        self.fixture_calls: list[tuple[int, int, int]] = []
        self.prediction_calls: list[int] = []
        self.statistics_calls: list[int] = []
        self.topscorers_calls: list[tuple[int, int]] = []

    def get_fixtures(self, league, season, *, page=1):
        self.request_count += 1
        self.fixture_calls.append((league, season, page))

        if league in self._fixtures_by_league:
            entry = self._fixtures_by_league[league]
            if isinstance(entry, BaseException):
                raise entry
            pages = entry if isinstance(entry, list) else [entry]
        elif self._fixtures_pages is not None:
            pages = self._fixtures_pages
        else:
            return self._fixtures

        idx = page - 1
        return pages[idx] if 0 <= idx < len(pages) else {"response": []}

    def get_predictions(self, fixture):
        self.request_count += 1
        self.prediction_calls.append(fixture)
        entry = self._predictions.get(fixture, {"response": []})
        if isinstance(entry, BaseException):
            raise entry
        return entry

    def get_fixture_statistics(self, fixture):
        self.request_count += 1
        self.statistics_calls.append(fixture)
        entry = self._statistics.get(fixture, {"response": []})
        if isinstance(entry, BaseException):
            raise entry
        return entry

    def get_topscorers(self, league, season):
        self.request_count += 1
        self.topscorers_calls.append((league, season))
        entry = self._topscorers.get(league, {"response": []})
        if isinstance(entry, BaseException):
            raise entry
        return entry


class _FakeQuery:
    """Minimal stand-in for the supabase-py query builder.

    Supports ``table(t).select(cols).eq(c, v).in_(c, vals)`` plus
    ``.update()``/``.insert()``/``.upsert()``/``.delete()``/``.execute()`` --
    the operations jobs.db.SupabaseStore's teardown/reconcile/closure/job_runs
    methods actually use. Anything else is intentionally absent so a test
    can't lean on behaviour the real store never exercises.
    """

    def __init__(self, client, table):
        self._client = client
        self._table = table
        self._op = "select"
        self._filters: list[tuple[str, str, object]] = []
        self._update_values: dict | None = None
        self._insert_rows: list[dict] | None = None
        self._upsert_rows: list[dict] | None = None
        self._on_conflict: str | None = None
        self._order_col: str | None = None
        self._order_desc: bool = False
        self._range: tuple[int, int] | None = None

    def select(self, *cols):
        self._op = "select"
        return self

    def delete(self):
        self._op = "delete"
        return self

    def update(self, values):
        self._op = "update"
        self._update_values = dict(values)
        return self

    def insert(self, row):
        self._op = "insert"
        self._insert_rows = [dict(row)] if isinstance(row, dict) else [dict(r) for r in row]
        return self

    def upsert(self, row, on_conflict=None):
        """Accepts either a single dict row OR a list of dict rows -- the
        latter is what a real batch upsert (e.g. jobs.db.SupabaseStore's
        replace_top_scorers) sends. ``on_conflict`` may name more than one
        column, comma-separated (e.g. "league_id,api_player_id") -- the
        composite key is matched as a tuple, not a single literal column."""
        self._op = "upsert"
        self._upsert_rows = [dict(row)] if isinstance(row, dict) else [dict(r) for r in row]
        self._on_conflict = on_conflict
        return self

    def eq(self, col, value):
        self._filters.append(("eq", col, value))
        return self

    def in_(self, col, values):
        self._filters.append(("in", col, list(values)))
        return self

    def order(self, col, *, desc=False):
        self._order_col = col
        self._order_desc = desc
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def _matches(self, row) -> bool:
        for kind, col, value in self._filters:
            if kind == "eq" and row.get(col) != value:
                return False
            if kind == "in" and row.get(col) not in value:
                return False
        return True

    def execute(self):
        rows = self._client.tables[self._table]

        if self._op == "select":
            matched = [r for r in rows if self._matches(r)]
            if self._order_col is not None:
                matched.sort(key=lambda r: r.get(self._order_col), reverse=self._order_desc)
            if self._range is not None:
                start, end = self._range
                matched = matched[start : end + 1]
            return SimpleNamespace(data=[dict(r) for r in matched])

        if self._op == "delete":
            self._client.delete_log.append(self._table)
            matched = [r for r in rows if self._matches(r)]
            self._client.tables[self._table] = [r for r in rows if not self._matches(r)]
            return SimpleNamespace(data=[dict(r) for r in matched])

        if self._op == "update":
            matched = [r for r in rows if self._matches(r)]
            for r in matched:
                r.update(self._update_values)
            return SimpleNamespace(data=[dict(r) for r in matched])

        if self._op == "insert":
            inserted = []
            for row in self._insert_rows:
                row = dict(row)
                row.setdefault("id", f"{self._table}-{len(rows) + len(inserted) + 1}")
                rows.append(row)
                inserted.append(row)
            return SimpleNamespace(data=[dict(r) for r in inserted])

        if self._op == "upsert":
            conflict_cols = (self._on_conflict or "id").split(",")
            result_rows = []
            for upsert_row in self._upsert_rows:
                key = tuple(upsert_row.get(c) for c in conflict_cols)
                existing = next(
                    (r for r in rows if tuple(r.get(c) for c in conflict_cols) == key),
                    None,
                )
                if existing is not None:
                    existing.update(upsert_row)
                    result_rows.append(existing)
                else:
                    result_row = dict(upsert_row)
                    result_row.setdefault("id", len(rows) + len(result_rows) + 1)
                    rows.append(result_row)
                    result_rows.append(result_row)
            return SimpleNamespace(data=[dict(r) for r in result_rows])

        raise NotImplementedError(f"_FakeQuery: unsupported op {self._op!r}")


class _FakeRpc:
    def __init__(self, data):
        self._data = data

    def execute(self):
        return SimpleNamespace(data=self._data)


class FakeSupabaseClient:
    """In-memory stand-in for the supabase-py Client, scoped to the
    table/select/insert/update/upsert/delete/eq/in_/rpc surface that
    jobs.db.SupabaseStore's teardown/reconcile/closure/job_runs methods use.
    Lets the REAL SupabaseStore run against in-memory rows -- no network, no
    DB -- so the actual store logic (FK-safe order, season isolation, kickoff
    reconciliation, RPC plumbing) is what gets tested, not a reimplementation
    of it.

    Seed it with table rows; ``delete_log`` records the order of delete()
    calls so tests can assert the FK-safe sequence
    predictions -> fixtures -> teams -> leagues. ``rpc_calls`` records every
    ``.rpc(name, params)`` invocation.
    """

    def __init__(
        self,
        *,
        leagues=None,
        teams=None,
        fixtures=None,
        predictions=None,
        job_runs=None,
        top_scorers=None,
    ):
        self.tables: dict[str, list[dict]] = {
            "leagues": [dict(r) for r in (leagues or [])],
            "teams": [dict(r) for r in (teams or [])],
            "fixtures": [dict(r) for r in (fixtures or [])],
            "predictions": [dict(r) for r in (predictions or [])],
            "job_runs": [dict(r) for r in (job_runs or [])],
            "top_scorers": [dict(r) for r in (top_scorers or [])],
        }
        self.delete_log: list[str] = []
        self.rpc_calls: list[tuple[str, dict]] = []

    def table(self, name):
        self.tables.setdefault(name, [])
        return _FakeQuery(self, name)

    def rpc(self, fn_name, params=None):
        params = params or {}
        self.rpc_calls.append((fn_name, params))
        if fn_name == "teardown_season":
            return _FakeRpc(self._teardown_season(params["p_season"]))
        raise NotImplementedError(f"FakeSupabaseClient.rpc: no fake implemented for {fn_name!r}")

    def _teardown_season(self, season):
        """Mirrors supabase/migrations/0003_harden_db.sql's teardown_season()
        RPC: FK-safe cascade delete (predictions -> fixtures -> teams ->
        leagues), guarded on there being matching league ids at all so an
        absent/mismatched season issues NO delete calls."""
        league_ids = [l["id"] for l in self.tables["leagues"] if l.get("season") == season]
        fixture_ids = (
            [f["id"] for f in self.tables["fixtures"] if f.get("league_id") in league_ids]
            if league_ids
            else []
        )

        predictions_deleted = 0
        if fixture_ids:
            before = len(self.tables["predictions"])
            self.tables["predictions"] = [
                p for p in self.tables["predictions"] if p.get("fixture_id") not in fixture_ids
            ]
            self.delete_log.append("predictions")
            predictions_deleted = before - len(self.tables["predictions"])

        fixtures_deleted = 0
        teams_deleted = 0
        leagues_deleted = 0
        if league_ids:
            before = len(self.tables["fixtures"])
            self.tables["fixtures"] = [
                f for f in self.tables["fixtures"] if f.get("league_id") not in league_ids
            ]
            self.delete_log.append("fixtures")
            fixtures_deleted = before - len(self.tables["fixtures"])

            before = len(self.tables["teams"])
            self.tables["teams"] = [
                t for t in self.tables["teams"] if t.get("league_id") not in league_ids
            ]
            self.delete_log.append("teams")
            teams_deleted = before - len(self.tables["teams"])

            before = len(self.tables["leagues"])
            self.tables["leagues"] = [
                l for l in self.tables["leagues"] if l.get("id") not in league_ids
            ]
            self.delete_log.append("leagues")
            leagues_deleted = before - len(self.tables["leagues"])

        return {
            "leagues": leagues_deleted,
            "teams": teams_deleted,
            "fixtures": fixtures_deleted,
            "predictions": predictions_deleted,
        }


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
def make_supabase_client():
    return FakeSupabaseClient


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


@pytest.fixture
def rich_predictions_payload():
    """A FULLER API-Football /predictions payload than ``predictions_payload``
    -- also carries win_or_draw/under_over plus the comparison, teams.last_5
    and h2h sections that build_prediction_detail_payload (v2 premium depth
    content, jobs/fetch_predictions.py) curates into a fixture_insights row.
    Used to prove the curation keeps every section when the upstream payload
    actually has one (predictions_payload proves the opposite: sparse input
    curates down to a smaller, still-non-None payload with no empty shells
    for the sections that were genuinely absent)."""
    return {
        "response": [
            {
                "predictions": {
                    "winner": {"id": 2380, "name": "Brazil", "comment": "Win or draw"},
                    "win_or_draw": True,
                    "under_over": "-2.5",
                    "goals": {"home": "-1.5", "away": "-1.5"},
                    "advice": "Double chance : Brazil or draw",
                    "percent": {"home": "50%", "draw": "30%", "away": "20%"},
                },
                "teams": {
                    "home": {
                        "last_5": {
                            "form": "WWDLW",
                            "played": {"total": 5},
                            "goals": {"for": {"total": {"total": 9}}},
                        },
                    },
                    "away": {
                        "last_5": {
                            "form": "LWDWD",
                            "played": {"total": 5},
                            "goals": {"for": {"total": {"total": 6}}},
                        },
                    },
                },
                "comparison": {
                    "form": {"home": "60%", "away": "45%"},
                    "att": {"home": "70%", "away": "55%"},
                    "def": {"home": "65%", "away": "50%"},
                    "poisson_distribution": {"home": "45%", "away": "25%"},
                    "h2h": {"home": "55%", "away": "45%"},
                    "goals": {"home": "60%", "away": "40%"},
                    "total": {"home": "58%", "away": "42%"},
                },
                "h2h": [
                    {
                        "fixture": {"date": "2022-06-01T18:00:00+00:00"},
                        "teams": {"home": {"name": "Brazil"}, "away": {"name": "Argentina"}},
                        "goals": {"home": 2, "away": 1},
                    },
                    {
                        "fixture": {"date": "2019-06-01T18:00:00+00:00"},
                        "teams": {"home": {"name": "Argentina"}, "away": {"name": "Brazil"}},
                        "goals": {"home": 1, "away": 1},
                    },
                ],
            }
        ]
    }


@pytest.fixture
def statistics_payload():
    """A realistic API-Football /fixtures/statistics payload for two teams
    (jobs/fetch_insights.py) -- covers every _STAT_KEY_MAP entry plus one
    UNMAPPED stat type ("Expected goals bucket") that must be dropped, and a
    percent-string stat that must be converted to a plain float."""
    return {
        "response": [
            {
                "team": {"id": 2380, "name": "Brazil"},
                "statistics": [
                    {"type": "Shots on Goal", "value": 5},
                    {"type": "Shots off Goal", "value": 3},
                    {"type": "Total Shots", "value": 10},
                    {"type": "Blocked Shots", "value": 2},
                    {"type": "Shots insidebox", "value": 6},
                    {"type": "Shots outsidebox", "value": 4},
                    {"type": "Fouls", "value": 8},
                    {"type": "Corner Kicks", "value": 4},
                    {"type": "Offsides", "value": 1},
                    {"type": "Ball Possession", "value": "55%"},
                    {"type": "Yellow Cards", "value": 2},
                    {"type": "Red Cards", "value": 0},
                    {"type": "Goalkeeper Saves", "value": 3},
                    {"type": "Total passes", "value": 450},
                    {"type": "Passes accurate", "value": 400},
                    {"type": "Passes %", "value": "89%"},
                    {"type": "expected_goals", "value": "1.8"},
                    {"type": "Expected goals bucket", "value": 99},
                ],
            },
            {
                "team": {"id": 26, "name": "Argentina"},
                "statistics": [
                    {"type": "Ball Possession", "value": "45%"},
                    {"type": "expected_goals", "value": "1.1"},
                ],
            },
        ]
    }


@pytest.fixture
def topscorers_payload():
    """A realistic API-Football /players/topscorers payload
    (jobs/fetch_topscorers.py) -- already ordered by goals desc, exactly like
    the real endpoint. Each item deliberately carries a player.photo and a
    team.logo URL, exactly as the real API does, so tests can prove those
    fields are present in the raw payload but never read into a stored row
    (§13 -- plain text/numeric fields only). The third entry omits
    nationality/assists/penalties entirely, proving those nullable fields
    degrade to ``None`` rather than raising."""
    return {
        "response": [
            {
                "player": {
                    "id": 306,
                    "name": "Bruno Fernandes",
                    "nationality": "Portugal",
                    "photo": "https://media.api-sports.io/football/players/306.png",
                },
                "statistics": [
                    {
                        "team": {
                            "id": 33,
                            "name": "Portugal",
                            "logo": "https://media.api-sports.io/football/teams/33.png",
                        },
                        "goals": {"total": 7, "assists": 3},
                        "penalty": {"scored": 1},
                    }
                ],
            },
            {
                "player": {
                    "id": 874,
                    "name": "Kylian Mbappe",
                    "nationality": "France",
                    "photo": "https://media.api-sports.io/football/players/874.png",
                },
                "statistics": [
                    {
                        "team": {
                            "id": 2,
                            "name": "France",
                            "logo": "https://media.api-sports.io/football/teams/2.png",
                        },
                        "goals": {"total": 6, "assists": None},
                        "penalty": {"scored": 0},
                    }
                ],
            },
            {
                "player": {"id": 91, "name": "New Talent", "photo": None},
                "statistics": [
                    {
                        "team": {"id": 7, "name": "Testland", "logo": None},
                        "goals": {"total": 4},
                    },
                ],
            },
        ]
    }
