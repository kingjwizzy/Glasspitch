"""New job: per-league top-scorers leaderboard (ARCHITECTURE.md §8).

For each tracked league (jobs/config.py): GET /players/topscorers?league=
{api_league_id}&season={SEASON} EXACTLY ONCE PER RUN, take the top
``config.TOP_SCORERS_LIMIT`` entries (rank = list order -- the API already
returns them sorted by goals desc), and idempotently full-replace that
league's ``top_scorers`` board (``jobs/db.py``'s ``replace_top_scorers``:
upsert the current rows, then prune anyone who has fallen out of the top N).

This is PUBLIC data -- the same access class as leagues/teams/fixtures
(migration 0005), never premium and never the ledger. Only plain-text fields
are ever parsed out of the payload: player/team NAME strings only. The API
response also carries a player photo and a team logo URL; neither is read nor
stored, ever (§13).

Per-league error isolation mirrors fetch_fixtures.py/fetch_insights.py: one
bad league logs and continues (already-written leagues are kept); hitting the
per-run request budget ends the run early and gracefully (the remaining
leagues are picked up next run). A league fetch_fixtures hasn't synced yet
(no ``leagues`` row for its ``api_league_id``) is skipped without spending an
API call -- there's nothing useful to attach a leaderboard to yet.
"""

from __future__ import annotations

import logging
from typing import Optional

from jobs import config
from jobs.apiclient import ApiFootballClient, ApiFootballError, RequestBudgetExceeded
from jobs.cli import main
from jobs.db import SupabaseStore

log = logging.getLogger(__name__)


def _parse_topscorer_item(item: dict) -> Optional[dict]:
    """Parse one /players/topscorers response item into a storable row.

    Returns ``None`` (never raises) if a required field is missing, so one
    malformed item doesn't abort the whole league. NO photo/logo URL is ever
    read here, let alone stored (§13) -- only player/team NAME strings and
    plain numeric stats.
    """
    player = item.get("player") or {}
    stats_list = item.get("statistics") or []
    if not stats_list:
        return None
    stats = stats_list[0] or {}
    team = stats.get("team") or {}
    goals_block = stats.get("goals") or {}
    penalty_block = stats.get("penalty") or {}

    api_player_id = player.get("id")
    player_name = player.get("name")
    team_name = team.get("name")
    goals = goals_block.get("total")
    if api_player_id is None or not player_name or not team_name or goals is None:
        return None

    return {
        "api_player_id": api_player_id,
        "player_name": player_name,
        "team_name": team_name,
        "nationality": player.get("nationality"),
        "goals": goals,
        "assists": goals_block.get("assists"),
        "penalties": penalty_block.get("scored"),
    }


def parse_topscorers(payload: dict, *, limit: int) -> list[dict]:
    """Parse an API-Football /players/topscorers payload into up to
    ``limit`` storable rows, ranked by list order (the API already returns
    scorers ordered by goals desc). Malformed items are skipped, never fatal
    (mirrors ``fetch_fixtures.parse_fixture``'s per-item tolerance) -- rank is
    assigned only to successfully-parsed rows, so a skipped item never leaves
    a gap in the rank sequence.
    """
    response = (payload or {}).get("response") or []
    rows: list[dict] = []
    for item in response:
        if len(rows) >= limit:
            break
        try:
            parsed = _parse_topscorer_item(item)
        except (TypeError, AttributeError) as exc:
            log.warning("Skipping unparseable top-scorer item: %s", exc)
            continue
        if parsed is None:
            log.warning(
                "Skipping top-scorer item with missing required fields "
                "(player=%r).", item.get("player"),
            )
            continue
        parsed["rank"] = len(rows) + 1
        rows.append(parsed)
    return rows


def run(
    *,
    dry_run: bool = False,
    store: Optional[SupabaseStore] = None,
    api: Optional[ApiFootballClient] = None,
) -> dict:
    api = api if api is not None else ApiFootballClient()
    store = store if store is not None else SupabaseStore()

    counts = {
        "leagues_seen": len(config.TRACKED_LEAGUE_IDS),
        "leagues_skipped_no_league_row": 0,
        "leagues_fetched": 0,
        "leagues_failed": 0,
        "budget_exhausted": False,
        "players_upserted": 0,
        "players_pruned": 0,
        "api_requests": 0,
    }

    for api_league_id in config.TRACKED_LEAGUE_IDS:
        league_id = store.league_id_for_api_league_id(api_league_id)
        if league_id is None:
            counts["leagues_skipped_no_league_row"] += 1
            log.warning(
                "fetch_topscorers: no leagues row yet for api_league_id=%s "
                "(fetch_fixtures hasn't synced it); skipping this run "
                "(no API call spent).", api_league_id,
            )
            continue

        try:
            payload = api.get_topscorers(api_league_id, config.SEASON)
        except RequestBudgetExceeded as exc:
            counts["budget_exhausted"] = True
            log.warning(
                "fetch_topscorers: request budget exhausted (%s); ending the "
                "run early (remaining leagues are picked up next run).", exc,
            )
            break
        except ApiFootballError as exc:
            counts["leagues_failed"] += 1
            log.error(
                "fetch_topscorers: league %s failed (%s); continuing with "
                "any remaining tracked leagues (already-written leagues are "
                "kept).", api_league_id, exc,
            )
            continue

        counts["leagues_fetched"] += 1
        rows = parse_topscorers(payload, limit=config.TOP_SCORERS_LIMIT)

        if dry_run:
            log.info(
                "[dry-run] would replace top scorers for league api_id=%s "
                "(%d row(s)): %s",
                api_league_id, len(rows),
                [(r["rank"], r["player_name"], r["team_name"], r["goals"]) for r in rows],
            )
            continue

        result = store.replace_top_scorers(league_id=league_id, rows=rows)
        counts["players_upserted"] += result["upserted"]
        counts["players_pruned"] += result["pruned"]

    counts["api_requests"] = api.request_count
    return counts


if __name__ == "__main__":
    main(run, "Fetch top scorers")
