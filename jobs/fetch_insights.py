"""New v2 job: post-match stats depth content (ARCHITECTURE.md v2 §4/§7, §8).

For finished fixtures (the tracked league(s) + season, config.py) that already
have a SCORED api-football prediction but no ``post_match_stats`` insight yet
(``jobs/db.py``'s ``fixtures_needing_stats`` -- most-recently-finished first):
GET /fixtures/statistics?fixture={id} EXACTLY ONCE, curate xG/shots/possession/
cards/passes per side, and store the result as a ``fixture_insights`` row
(``kind='post_match_stats'``). Same fetch-once-and-cache discipline as
``fetch_predictions.py`` -- idempotent (``fixtures_needing_stats`` never
re-offers a fixture that already has one), budget-guarded via the shared
``ApiFootballClient``/``RequestBudgetExceeded`` (a run stops early, gracefully,
once the per-run budget is spent -- the remaining fixtures are simply picked
up by a later run), and windowed to the freshest finished matches first so a
budget-limited run always makes progress on what a premium subscriber is
likeliest to look up right now.

This table is never the free ledger and never gates the free prediction set
(ARCHITECTURE.md v2 §4): it is readable only via ``public.is_premium()`` RLS
(``supabase/migrations/0004_premium.sql``), and the web app's free pages never
read it.
"""

from __future__ import annotations

import logging
from typing import Optional

from jobs import config
from jobs.apiclient import ApiFootballClient, ApiFootballError, RequestBudgetExceeded
from jobs.cli import main
from jobs.db import SupabaseStore

log = logging.getLogger(__name__)

# API-Football /fixtures/statistics "type" strings (case-insensitive, matched
# lowercased/stripped) -> our curated, stable keys. Anything not in this map
# is dropped -- never store a raw, provider-shaped stat blob (§4/§7).
_STAT_KEY_MAP = {
    "shots on goal": "shots_on_goal",
    "shots off goal": "shots_off_goal",
    "total shots": "shots_total",
    "blocked shots": "shots_blocked",
    "shots insidebox": "shots_inside_box",
    "shots outsidebox": "shots_outside_box",
    "fouls": "fouls",
    "corner kicks": "corners",
    "offsides": "offsides",
    "ball possession": "possession_pct",
    "yellow cards": "yellow_cards",
    "red cards": "red_cards",
    "goalkeeper saves": "goalkeeper_saves",
    "total passes": "passes_total",
    "passes accurate": "passes_accurate",
    "passes %": "passes_accuracy_pct",
    "expected_goals": "xg",
}

# Keys whose raw value is a "NN%" string that must become a plain float.
_PERCENT_KEYS = frozenset({"possession_pct", "passes_accuracy_pct"})


def _curate_team_statistics(block: dict) -> dict:
    """Curate one team's ``statistics`` array into a flat, typed dict."""
    curated: dict = {}
    for stat in block.get("statistics") or []:
        stat_type = (stat.get("type") or "").strip().lower()
        key = _STAT_KEY_MAP.get(stat_type)
        if key is None:
            continue
        value = stat.get("value")
        if value is None:
            continue
        if key in _PERCENT_KEYS and isinstance(value, str):
            try:
                value = float(value.rstrip("%"))
            except ValueError:
                continue
        elif key == "xg":
            try:
                value = float(value)
            except (TypeError, ValueError):
                continue
        curated[key] = value
    return curated


def parse_fixture_statistics(
    payload: dict, *, home_team_api_id: Optional[int], away_team_api_id: Optional[int]
) -> Optional[dict]:
    """Parse an API-Football /fixtures/statistics payload into a curated
    ``{"home": {...}, "away": {...}}`` dict, or ``None`` if the API has no
    statistics for this fixture yet (coverage isn't guaranteed for every
    fixture) -- lets the caller skip cleanly (retry next run) rather than
    storing an empty shell.
    """
    response = (payload or {}).get("response") or []
    if not response:
        return None

    by_team: dict[int, dict] = {}
    for block in response:
        team_id = (block.get("team") or {}).get("id")
        if team_id is None:
            continue
        by_team[team_id] = _curate_team_statistics(block)

    home = by_team.get(home_team_api_id) if home_team_api_id is not None else None
    away = by_team.get(away_team_api_id) if away_team_api_id is not None else None
    if not home and not away:
        return None
    return {"home": home or {}, "away": away or {}}


def run(
    *,
    dry_run: bool = False,
    store: Optional[SupabaseStore] = None,
    api: Optional[ApiFootballClient] = None,
) -> dict:
    api = api if api is not None else ApiFootballClient()
    store = store if store is not None else SupabaseStore()

    candidates = store.fixtures_needing_stats(
        api_league_ids=config.TRACKED_LEAGUE_IDS, season=config.SEASON,
    )

    counts = {
        "candidates": len(candidates),
        "fetched": 0,
        "inserted": 0,
        "empty": 0,
        "failed": 0,
        "budget_exhausted": False,
        "api_requests": 0,
    }

    for fixture in candidates:
        try:
            payload = api.get_fixture_statistics(fixture["api_fixture_id"])
        except RequestBudgetExceeded as exc:
            counts["budget_exhausted"] = True
            log.warning(
                "fetch_insights: request budget exhausted (%s); ending the "
                "run early (remaining fixtures are picked up next run).", exc,
            )
            break
        except ApiFootballError as exc:
            counts["failed"] += 1
            log.error(
                "fetch_insights: fixture %s (api_id=%s) failed (%s); "
                "continuing with remaining fixtures.",
                fixture["id"], fixture["api_fixture_id"], exc,
            )
            continue

        counts["fetched"] += 1
        parsed = parse_fixture_statistics(
            payload,
            home_team_api_id=fixture.get("home_team_api_id"),
            away_team_api_id=fixture.get("away_team_api_id"),
        )
        if parsed is None:
            counts["empty"] += 1
            log.info(
                "No statistics yet for fixture %s (api_id=%s); skipping "
                "(may retry next run).", fixture["id"], fixture["api_fixture_id"],
            )
            continue

        if dry_run:
            log.info(
                "[dry-run] would insert post_match_stats for fixture %s: %s",
                fixture["id"], parsed,
            )
        else:
            store.insert_insight(
                fixture_id=fixture["id"],
                kind="post_match_stats",
                payload=parsed,
                source="api-football",
            )
            counts["inserted"] += 1

    counts["api_requests"] = api.request_count
    return counts


if __name__ == "__main__":
    main(run, "Fetch insights")
