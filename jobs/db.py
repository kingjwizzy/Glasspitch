"""Supabase secret-key client for the Python jobs (ARCHITECTURE.md §6, §7).

The jobs are the ONLY writers to the database. They authenticate with the
secret key, which bypasses Row Level Security. That key is server-side ONLY and
must never reach the web app or the repo (§12); it is read from the
environment.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Optional

from dotenv import load_dotenv
from supabase import Client, create_client

from jobs import util

log = logging.getLogger(__name__)

# Load jobs/.env when running locally. The .env file is never committed (§12).
load_dotenv()


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
        return res.data[0]["id"]

    # ----- reads -----
    def upcoming_fixtures(self) -> list[dict]:
        return (
            self._client.table("fixtures")
            .select("*")
            .eq("status", "scheduled")
            .order("kickoff_utc")
            .execute()
            .data
        )

    def finished_fixtures(self) -> list[dict]:
        return (
            self._client.table("fixtures")
            .select("*")
            .eq("status", "finished")
            .execute()
            .data
        )

    def finished_fixtures_ordered(self) -> list[dict]:
        return (
            self._client.table("fixtures")
            .select("*")
            .eq("status", "finished")
            .order("kickoff_utc")
            .execute()
            .data
        )

    def existing_prediction_fixture_ids(self, source: str) -> set[int]:
        rows = (
            self._client.table("predictions")
            .select("fixture_id")
            .eq("source", source)
            .execute()
            .data
        )
        return {row["fixture_id"] for row in rows}

    def published_predictions_due(self, now_iso: str) -> list[dict]:
        return (
            self._client.table("predictions")
            .select("*")
            .eq("status", "published")
            .lte("locked_at", now_iso)
            .execute()
            .data
        )

    def locked_unscored_predictions(self, fixture_id: int) -> list[dict]:
        return (
            self._client.table("predictions")
            .select("*")
            .eq("fixture_id", fixture_id)
            .eq("status", "locked")
            .execute()
            .data
        )

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
