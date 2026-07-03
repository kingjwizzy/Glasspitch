"""Supabase secret-key client for the Python jobs (ARCHITECTURE.md §6, §7).

The jobs are the ONLY writers to the database. They authenticate with the
secret key, which bypasses Row Level Security. That key is server-side ONLY and
must never reach the web app or the repo (§12); it is read from the
environment.
"""

from __future__ import annotations

import logging
import os
from datetime import timedelta
from functools import lru_cache
from pathlib import Path
from typing import Callable, Optional

from dotenv import load_dotenv
from supabase import Client, create_client

from jobs import util

log = logging.getLogger(__name__)

# Load jobs/.env (the .env next to this file) by EXPLICIT path so secrets resolve
# the same way no matter how a job is invoked (python -m, -c, pytest). Never
# committed (§12).
load_dotenv(Path(__file__).with_name(".env"))

# PostgREST's default Max Rows cap (Supabase's default project setting). Every
# list read pages through this in a loop rather than trusting a single request
# to return everything -- silent truncation at this boundary previously broke
# fetch-once / scoring / Elo replay at club scale (v2 hardening).
_PAGE_SIZE = 1000
# Defensive cap on how many pages a single read will loop through -- guards
# against an unbounded loop from a bug (query never shrinking) rather than a
# real data volume this product expects any time soon.
_MAX_PAGES = 500


@lru_cache(maxsize=1)
def get_client() -> Client:
    """Return a memoised Supabase client authenticated as the service role."""
    url = os.environ.get("SUPABASE_URL")
    secret_key = os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not secret_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SECRET_KEY must be set "
            "(see jobs/.env.example). The secret key is server-side only."
        )
    return create_client(url, secret_key)


def _is_unique_violation(exc: Exception) -> bool:
    """True if ``exc`` is a Postgres unique-constraint violation (SQLSTATE 23505)."""
    if getattr(exc, "code", None) == "23505":
        return True
    text = f"{getattr(exc, 'message', '')} {exc}".lower()
    return (
        "23505" in text
        or "duplicate key" in text
        or "predictions_fixture_model_unique" in text
    )


class SupabaseStore:
    """Data-access layer for the jobs over the Supabase secret-key client.

    All writes are idempotent and keyed on the ``api_*`` ids (ARCHITECTURE.md
    §8), so re-running a job is safe. The web app never uses this — it is
    jobs-only. The jobs depend on this interface (not the raw client) so tests
    can inject an in-memory fake.
    """

    def __init__(self, client: Optional[Client] = None) -> None:
        self._client = client if client is not None else get_client()

    # ----- pagination helper (v2 hardening: PostgREST's 1000-row default cap) --
    def _paginated(self, query_factory: Callable[[], object]) -> list[dict]:
        """Run ``query_factory()`` (a fresh, un-ranged query builder each call)
        repeatedly with ``.range()`` until a short page, aggregating all rows.

        ``query_factory`` must return a NEW builder each invocation (select +
        filters + order already applied, but no ``.range()``); supabase-py
        query builders are single-use, so the caller supplies a callable rather
        than a pre-built object.
        """
        rows: list[dict] = []
        offset = 0
        for _ in range(_MAX_PAGES):
            page = (
                query_factory()
                .range(offset, offset + _PAGE_SIZE - 1)
                .execute()
                .data
            )
            rows.extend(page)
            if len(page) < _PAGE_SIZE:
                return rows
            offset += _PAGE_SIZE
        log.error(
            "SupabaseStore._paginated: hit the %d-page safety cap (%d rows) -- "
            "stopping early; this should never happen at this product's scale.",
            _MAX_PAGES, len(rows),
        )
        return rows

    # ----- fetch_fixtures: idempotent upserts keyed on api_* ids -----
    def upsert_league(
        self, *, api_league_id: int, name: str, slug: str, country: str, season: int
    ) -> int:
        row = {
            "api_league_id": api_league_id,
            "name": name,
            "slug": slug,
            "country": country,
            "season": season,
        }
        res = (
            self._client.table("leagues")
            .upsert(row, on_conflict="api_league_id")
            .execute()
        )
        return res.data[0]["id"]

    def upsert_team(
        self, *, api_team_id: int, name: str, slug: str, league_id: int
    ) -> int:
        row = {
            "api_team_id": api_team_id,
            "name": name,
            "slug": slug,
            "league_id": league_id,
        }
        res = (
            self._client.table("teams").upsert(row, on_conflict="api_team_id").execute()
        )
        return res.data[0]["id"]

    def upsert_fixture(
        self,
        *,
        api_fixture_id: int,
        league_id: int,
        home_team_id: int,
        away_team_id: int,
        kickoff_utc: str,
        status: str,
        final_home_goals: Optional[int],
        final_away_goals: Optional[int],
    ) -> int:
        """Upsert one fixture, keyed on ``api_fixture_id``.

        If the fixture already existed with a DIFFERENT ``kickoff_utc`` (a
        reschedule), reconciles its still-``published`` predictions'
        ``locked_at`` to the new kickoff -- otherwise the "locked at kickoff"
        guarantee silently drifts from the real kickoff (v2 hardening; see
        ``reconcile_kickoff_change``).
        """
        existing = (
            self._client.table("fixtures")
            .select("id, kickoff_utc")
            .eq("api_fixture_id", api_fixture_id)
            .execute()
            .data
        )
        previous_kickoff = existing[0]["kickoff_utc"] if existing else None

        row = {
            "api_fixture_id": api_fixture_id,
            "league_id": league_id,
            "home_team_id": home_team_id,
            "away_team_id": away_team_id,
            "kickoff_utc": kickoff_utc,
            "status": status,
            "final_home_goals": final_home_goals,
            "final_away_goals": final_away_goals,
        }
        res = (
            self._client.table("fixtures")
            .upsert(row, on_conflict="api_fixture_id")
            .execute()
        )
        fixture_id = res.data[0]["id"]

        if previous_kickoff is not None and util.parse_iso(previous_kickoff) != util.parse_iso(
            kickoff_utc
        ):
            self.reconcile_kickoff_change(fixture_id, new_kickoff_utc=kickoff_utc)

        return fixture_id

    def reconcile_kickoff_change(self, fixture_id: int, *, new_kickoff_utc: str) -> dict:
        """A fixture's kickoff moved: resync its still-``published``
        predictions' ``locked_at`` to match (still writable pre-lock, per the
        §7 trigger), or void them if the new kickoff has already passed (or
        already-passed publish can no longer be trusted to predate it).

        Locked/scored predictions are left untouched: the §7 trigger freezes
        ``locked_at`` on those anyway, and voiding a prediction that already
        made its call at the (old, real) kickoff would erase a real ledger row
        rather than fix a bug.
        """
        published = (
            self._client.table("predictions")
            .select("id, published_at")
            .eq("fixture_id", fixture_id)
            .eq("status", "published")
            .execute()
            .data
        )
        now = util.now_utc()
        new_kickoff_dt = util.parse_iso(new_kickoff_utc)
        resynced = 0
        voided = 0
        for pred in published:
            still_valid = new_kickoff_dt > now and util.parse_iso(
                pred["published_at"]
            ) <= new_kickoff_dt
            if still_valid:
                self._client.table("predictions").update(
                    {"locked_at": new_kickoff_utc}
                ).eq("id", pred["id"]).execute()
                resynced += 1
            else:
                self._client.table("predictions").update(
                    {"status": "unlocked_void"}
                ).eq("id", pred["id"]).execute()
                voided += 1
                log.warning(
                    "Fixture %s kickoff moved to %s; prediction %s voided "
                    "(published_at %s no longer predates the new kickoff).",
                    fixture_id, new_kickoff_utc, pred["id"], pred["published_at"],
                )
        return {"resynced": resynced, "voided": voided}

    def close_out_terminal_fixture_predictions(self, fixture_id: int) -> int:
        """A fixture reached a terminal non-played state (cancelled, abandoned,
        or postponed beyond ``config.POSTPONED_VOID_HORIZON_DAYS`` with no
        reschedule): close out any still-open (``published``/``locked``)
        predictions with ``status='void_cancelled'`` so no ledger row is left
        in permanent limbo. Already-``scored``/``unlocked_void``/
        ``void_cancelled`` rows are left alone (idempotent).
        """
        open_predictions = (
            self._client.table("predictions")
            .select("id")
            .eq("fixture_id", fixture_id)
            .in_("status", ["published", "locked"])
            .execute()
            .data
        )
        for pred in open_predictions:
            self._client.table("predictions").update(
                {"status": "void_cancelled"}
            ).eq("id", pred["id"]).execute()
        return len(open_predictions)

    # ----- reads -----
    def upcoming_fixtures(self) -> list[dict]:
        return self._paginated(
            lambda: self._client.table("fixtures")
            .select("*")
            .eq("status", "scheduled")
            .order("kickoff_utc")
        )

    def upcoming_fixtures_within(self, hours: float) -> list[dict]:
        """Scheduled fixtures kicking off within ``hours`` from now.

        fetch_predictions.py uses this instead of the unbounded
        ``upcoming_fixtures`` -- without a window, a full season's worth of
        scheduled fixtures each cost one /predictions call on the very next
        run, which can exceed the daily budget in one go and store predictions
        for matches months away, long before API-Football has anything useful
        to say about them (v2 hardening).
        """
        now = util.now_utc()
        until_iso = (now + timedelta(hours=hours)).isoformat()
        return self._paginated(
            lambda: self._client.table("fixtures")
            .select("*")
            .eq("status", "scheduled")
            .gte("kickoff_utc", now.isoformat())
            .lte("kickoff_utc", until_iso)
            .order("kickoff_utc")
        )

    def finished_fixtures_for_season(self, season: int) -> list[dict]:
        """Finished fixtures scoped to one season (via ``leagues.season``).

        Used by ``jobs/seed_predictions_dev.py`` so its write set is
        PHYSICALLY confined to the configured dev season -- unlike the old
        unscoped ``finished_fixtures_ordered``, it cannot back-date predictions
        onto another (e.g. live) season's finished fixtures in a mixed DB
        (docs/STATUS.md "close before the live cutover").
        """
        return self._paginated(
            lambda: self._client.table("fixtures")
            .select("*, leagues!inner(season)")
            .eq("status", "finished")
            .eq("leagues.season", season)
            .order("kickoff_utc")
        )

    def finished_fixtures_for_replay(
        self, *, api_league_ids: list[int], season: int
    ) -> list[dict]:
        """Finished fixtures for the Elo rating replay, scoped to the tracked
        league(s) + season (``jobs/config.py``) so results from other
        seasons/competitions never leak into the replayed ratings pool -- an
        unscoped replay would blend a dev back-test season with the live one
        (or, at multi-league scope, unrelated competitions) into a single Elo
        pool (§9 hardening).
        """
        if not api_league_ids:
            return []
        return self._paginated(
            lambda: self._client.table("fixtures")
            .select("*, leagues!inner(api_league_id, season)")
            .eq("status", "finished")
            .eq("leagues.season", season)
            .in_("leagues.api_league_id", api_league_ids)
            .order("kickoff_utc")
        )

    def existing_prediction_fixture_ids(self, source: str) -> set[int]:
        rows = self._paginated(
            lambda: self._client.table("predictions")
            .select("fixture_id")
            .eq("source", source)
        )
        return {row["fixture_id"] for row in rows}

    # ----- v2 premium: fixture_insights (ARCHITECTURE.md v2 §4/§7) -----------
    def existing_insight_fixture_ids(self, kind: str) -> set[int]:
        """Fixture ids that already have a ``fixture_insights`` row of
        ``kind`` -- mirrors ``existing_prediction_fixture_ids``'s "have we
        already fetched this" set-difference pattern (fetch_predictions.py /
        fetch_insights.py never re-fetch what's already stored)."""
        rows = self._paginated(
            lambda: self._client.table("fixture_insights")
            .select("fixture_id")
            .eq("kind", kind)
        )
        return {row["fixture_id"] for row in rows}

    def _finished_fixtures_with_scored_prediction(
        self, *, api_league_ids: list[int], season: int
    ) -> list[dict]:
        """Finished fixtures (tracked league(s) + season) that already carry a
        SCORED api-football prediction -- fetch_insights.py's candidate pool,
        before subtracting fixtures that already have a post_match_stats
        insight (see ``fixtures_needing_stats``). Ordered most-recently-
        finished first (``kickoff_utc`` descending) so a budget-limited run
        makes progress on the freshest matches first -- also what a premium
        subscriber is likeliest to look up. Embeds each side's api_team_id
        (disambiguated by FK constraint name, same convention as
        src/lib/queries/*.ts) so the caller can call the statistics endpoint
        without a second round-trip per fixture.
        """
        if not api_league_ids:
            return []
        rows = self._paginated(
            lambda: self._client.table("fixtures")
            .select(
                "id, api_fixture_id, kickoff_utc, "
                "home_team:teams!fixtures_home_team_id_fkey(api_team_id), "
                "away_team:teams!fixtures_away_team_id_fkey(api_team_id), "
                "leagues!inner(api_league_id, season), "
                "predictions!inner(source, status)"
            )
            .eq("status", "finished")
            .eq("leagues.season", season)
            .in_("leagues.api_league_id", api_league_ids)
            .eq("predictions.source", "api-football")
            .eq("predictions.status", "scored")
            .order("kickoff_utc", desc=True)
        )
        # The embedded predictions!inner filter is per-row, not per-fixture --
        # a fixture only ever has ONE scored api-football prediction
        # (predictions_fixture_model_unique + one row per source), but guard
        # against PostgREST ever multiplying a fixture row per embedded match
        # anyway; keep first-seen (already-sorted by kickoff_utc desc).
        seen: dict[int, dict] = {}
        for row in rows:
            seen.setdefault(row["id"], row)
        return list(seen.values())

    def fixtures_needing_stats(
        self, *, api_league_ids: list[int], season: int
    ) -> list[dict]:
        """fetch_insights.py's work queue: finished fixtures (tracked
        league(s) + season) with a SCORED api-football prediction but NO
        ``post_match_stats`` insight yet, most-recently-finished first. Each
        returned dict carries ``id``, ``api_fixture_id``, ``kickoff_utc``,
        ``home_team_api_id``, ``away_team_api_id``.
        """
        candidates = self._finished_fixtures_with_scored_prediction(
            api_league_ids=api_league_ids, season=season
        )
        have_stats = self.existing_insight_fixture_ids("post_match_stats")

        result = []
        for row in candidates:
            if row["id"] in have_stats:
                continue
            home_team = row.get("home_team") or {}
            away_team = row.get("away_team") or {}
            result.append(
                {
                    "id": row["id"],
                    "api_fixture_id": row["api_fixture_id"],
                    "kickoff_utc": row["kickoff_utc"],
                    "home_team_api_id": home_team.get("api_team_id"),
                    "away_team_api_id": away_team.get("api_team_id"),
                }
            )
        return result

    def insert_insight(
        self, *, fixture_id: int, kind: str, payload: dict, source: str = "api-football"
    ) -> Optional[int]:
        """Idempotent upsert into ``fixture_insights``, keyed on its own
        (fixture_id, kind) primary key -- unlike ``insert_prediction``,
        there's no surrogate id to catch a unique-violation on; the natural
        key IS the conflict target, so a plain upsert is both the simplest
        and the correct idempotent write (safe to re-run; a second call for
        the same (fixture_id, kind) just re-stores the same curated payload).
        """
        row = {
            "fixture_id": fixture_id,
            "kind": kind,
            "payload": payload,
            "source": source,
        }
        res = (
            self._client.table("fixture_insights")
            .upsert(row, on_conflict="fixture_id,kind")
            .execute()
        )
        return res.data[0]["fixture_id"] if res.data else None

    # ----- top_scorers (jobs/fetch_topscorers.py) -- PUBLIC data, same access
    # class as leagues/teams/fixtures (migration 0005), not premium -----------
    def league_id_for_api_league_id(self, api_league_id: int) -> Optional[int]:
        """Resolve the internal ``leagues.id`` for a tracked API league id.

        fetch_topscorers.py never upserts a league itself (that's
        fetch_fixtures.py's job) -- a league that hasn't been synced yet
        simply has no top-scorers row written for it this run (returns
        ``None``; the caller skips it, isolated per league like
        fetch_fixtures' per-league try/except).
        """
        rows = (
            self._client.table("leagues")
            .select("id")
            .eq("api_league_id", api_league_id)
            .execute()
            .data
        )
        return rows[0]["id"] if rows else None

    def replace_top_scorers(self, *, league_id: int, rows: list[dict]) -> dict:
        """Idempotent full-replace of one league's top-scorers leaderboard.

        Upserts every incoming row keyed on the (league_id, api_player_id)
        PRIMARY KEY -- an unchanged rank/stat line is a plain no-op UPDATE --
        then deletes any EXISTING row for this league whose ``api_player_id``
        is NOT in the new set: a player who has fallen out of the top N
        (overtaken, or transferred out of a tracked league) must not linger on
        the board forever. Unlike the predictions LEDGER, this table carries
        no immutability guarantee and no historical record to protect -- it is
        a live leaderboard, not a scored record -- so pruning here is safe and
        correct in a way it never would be on ``predictions``.

        Upsert-then-prune (rather than delete-then-insert) also means the
        leaderboard is never observably empty for this league between the two
        steps: every row that is still current is written before any stale
        row is removed.
        """
        if not rows:
            return {"upserted": 0, "pruned": 0}

        payload = [{**row, "league_id": league_id} for row in rows]
        self._client.table("top_scorers").upsert(
            payload, on_conflict="league_id,api_player_id"
        ).execute()

        keep_ids = {row["api_player_id"] for row in rows}
        existing = (
            self._client.table("top_scorers")
            .select("api_player_id")
            .eq("league_id", league_id)
            .execute()
            .data
        )
        stale_ids = [
            r["api_player_id"] for r in existing if r["api_player_id"] not in keep_ids
        ]
        pruned = 0
        if stale_ids:
            self._client.table("top_scorers").delete().eq(
                "league_id", league_id
            ).in_("api_player_id", stale_ids).execute()
            pruned = len(stale_ids)

        return {"upserted": len(rows), "pruned": pruned}

    def top_scorers_for_league(self, league_id: int) -> list[dict]:
        """Top scorers for one league ordered by rank -- the read the WEB
        mirrors directly via supabase-js (frontend-dev owns ``src/``); kept
        here too so a job (or a future dry-run diff/verification script) can
        read back what's stored without inventing a second query shape.
        """
        return self._paginated(
            lambda: self._client.table("top_scorers")
            .select("*")
            .eq("league_id", league_id)
            .order("rank")
        )

    def published_predictions_due(self, now_iso: str) -> list[dict]:
        return self._paginated(
            lambda: self._client.table("predictions")
            .select("*")
            .eq("status", "published")
            .lte("locked_at", now_iso)
        )

    def locked_predictions_due_for_scoring(self) -> list[dict]:
        """The self-draining set score_results.py scores: LOCKED predictions
        whose fixture is already FINISHED, each row carrying its fixture's
        finals embedded under ``"fixture"``. Replaces the old
        all-finished-fixtures scan + one locked-predictions query PER fixture
        (O(all finished fixtures) forever) with a single bounded, paginated
        query that only ever returns unscored work (v2 hardening).
        """
        return self._paginated(
            lambda: self._client.table("predictions")
            .select(
                "*, fixture:fixtures!inner(id, status, final_home_goals, final_away_goals)"
            )
            .eq("status", "locked")
            .eq("fixture.status", "finished")
        )

    def scored_predictions_with_mismatched_final_score(self) -> list[dict]:
        """SCORED predictions whose fixture's CURRENT final score no longer
        matches what was scored -- i.e. the data provider corrected a result
        after we scored it. The migration-0003 trigger freezes scored fields,
        so this is read-only: score_results.py logs these loudly for manual
        review; it never silently rewrites the public record.
        """
        rows = self._paginated(
            lambda: self._client.table("predictions")
            .select(
                "id, model_version, final_home_goals, final_away_goals, "
                "fixture:fixtures!inner(id, final_home_goals, final_away_goals)"
            )
            .eq("status", "scored")
        )
        mismatches = []
        for row in rows:
            fixture = row.get("fixture") or {}
            if (
                fixture.get("final_home_goals") != row.get("final_home_goals")
                or fixture.get("final_away_goals") != row.get("final_away_goals")
            ):
                mismatches.append(row)
        return mismatches

    # ----- writes -----
    def insert_prediction(self, row: dict) -> Optional[str]:
        """Insert one prediction. Returns its id, or None if it already exists.

        Only the UNIQUE (fixture_id, model_version) violation is swallowed (it
        makes re-running safe). Any OTHER error — a CHECK / NOT-NULL / enum
        violation or an infrastructure failure — is re-raised so bad data fails
        loudly instead of being silently dropped.
        """
        try:
            res = self._client.table("predictions").insert(row).execute()
        except Exception as exc:  # noqa: BLE001
            if _is_unique_violation(exc):
                log.warning(
                    "insert_prediction skipped (already exists) for fixture %s / %s.",
                    row.get("fixture_id"),
                    row.get("model_version"),
                )
                return None
            raise
        return res.data[0]["id"] if res.data else None

    def mark_locked(self, prediction_id: str) -> None:
        self._client.table("predictions").update({"status": "locked"}).eq(
            "id", prediction_id
        ).execute()

    def mark_unlocked_void(self, prediction_id: str) -> None:
        self._client.table("predictions").update({"status": "unlocked_void"}).eq(
            "id", prediction_id
        ).execute()

    def write_prediction_score(
        self,
        prediction_id: str,
        *,
        final_home_goals: int,
        final_away_goals: int,
        result: str,
        brier_score: float,
        log_loss: float,
        scored_at: Optional[str] = None,
    ) -> None:
        # Only scoring fields are written post-lock; the §7 immutability trigger
        # permits these and rejects any change to the prediction itself.
        self._client.table("predictions").update(
            {
                "final_home_goals": final_home_goals,
                "final_away_goals": final_away_goals,
                "result": result,
                "brier_score": brier_score,
                "log_loss": log_loss,
                "status": "scored",
                "scored_at": scored_at or util.now_utc().isoformat(),
            }
        ).eq("id", prediction_id).execute()

    # ----- observability (migration 0003: job_runs) -----
    def record_job_run(
        self,
        *,
        job: str,
        started_at: str,
        finished_at: str,
        ok: bool,
        counts: dict,
        error: Optional[str],
    ) -> None:
        """Write one job_runs row (jobs/cli.py, from a ``finally`` block on
        every LIVE -- non-dry-run -- invocation). service-role-only table; never
        read by the web app (ARCHITECTURE.md §5)."""
        self._client.table("job_runs").insert(
            {
                "job": job,
                "started_at": started_at,
                "finished_at": finished_at,
                "ok": ok,
                "counts": counts,
                "error": error,
            }
        ).execute()

    # ----- teardown (dev tooling — see jobs/reset_season.py & docs/SEEDING.md) -----
    # ``season`` lives only on ``leagues``; everything else is reached via
    # league_id / fixture_id. These run as the service role.
    def _league_ids_for_season(self, season: int) -> list[int]:
        rows = (
            self._client.table("leagues")
            .select("id")
            .eq("season", season)
            .execute()
            .data
        )
        return [row["id"] for row in rows]

    def _fixture_ids_for_leagues(self, league_ids: list[int]) -> list[int]:
        if not league_ids:
            return []
        rows = (
            self._client.table("fixtures")
            .select("id")
            .in_("league_id", league_ids)
            .execute()
            .data
        )
        return [row["id"] for row in rows]

    def count_season_rows(self, season: int) -> dict:
        """Count the rows ``teardown_season`` would remove (for --dry-run / verify)."""
        league_ids = self._league_ids_for_season(season)
        fixture_ids = self._fixture_ids_for_leagues(league_ids)
        predictions = 0
        if fixture_ids:
            predictions = len(
                self._client.table("predictions")
                .select("id")
                .in_("fixture_id", fixture_ids)
                .execute()
                .data
            )
        teams = 0
        if league_ids:
            teams = len(
                self._client.table("teams")
                .select("id")
                .in_("league_id", league_ids)
                .execute()
                .data
            )
        return {
            "leagues": len(league_ids),
            "teams": teams,
            "fixtures": len(fixture_ids),
            "predictions": predictions,
        }

    def teardown_season(self, season: int) -> dict:
        """Season-scoped, FK-safe ledger teardown via the server-side
        SECURITY DEFINER RPC (supabase/migrations/0003_harden_db.sql). A direct
        client-side DELETE on a locked/scored prediction is rejected by the
        BEFORE DELETE guard added in that migration; the RPC is the only
        sanctioned way to remove those rows (it sets
        ``glasspitch.allow_ledger_teardown='on'`` transaction-locally before
        deleting). Only the service role can call it (EXECUTE is revoked from
        anon/authenticated).
        """
        res = self._client.rpc("teardown_season", {"p_season": season}).execute()
        data = res.data or {}
        return {
            "leagues": data.get("leagues", 0),
            "teams": data.get("teams", 0),
            "fixtures": data.get("fixtures", 0),
            "predictions": data.get("predictions", 0),
        }
