"""Daily job: fetch fixtures and upsert leagues/teams/fixtures (ARCHITECTURE.md §8.1).

GET /fixtures?league={id}&season={SEASON} for each tracked league (looping
through every page API-Football returns), then upsert the league, both teams
(plain names, no crests — §13) and the fixture, keyed on the api_* ids so
re-running is safe (idempotent — §5, §8). Maps the API status to our enum,
stores kickoff in UTC, and stores the final score when finished.

Each tracked league is fetched-then-written independently: a failure on one
league (a transient API error, or the per-run request budget running out)
no longer discards fixtures already written for an earlier league, and the
run continues on to the remaining leagues (unless the budget itself is gone).

Terminal-fixture handling (v2 hardening): a fixture that comes back
cancelled/abandoned, or has sat 'postponed' for longer than
``config.POSTPONED_VOID_HORIZON_DAYS`` with no reschedule, has its still-open
predictions closed out (``status='void_cancelled'``) so no ledger row is left
in permanent limbo. A kickoff-time change on an existing fixture also
reconciles its still-``published`` predictions' ``locked_at`` (see
``jobs/db.py``).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from jobs import config, util
from jobs.apiclient import ApiFootballClient, ApiFootballError, RequestBudgetExceeded
from jobs.cli import main
from jobs.db import SupabaseStore

log = logging.getLogger(__name__)

# API-Football fixture.status.short -> our enum (ARCHITECTURE.md §7).
_STATUS_MAP = {
    "TBD": "scheduled",
    "NS": "scheduled",
    "1H": "live",
    "HT": "live",
    "2H": "live",
    "ET": "live",
    "BT": "live",
    "P": "live",
    "SUSP": "live",
    "INT": "live",
    "LIVE": "live",
    "FT": "finished",
    "AET": "finished",
    "PEN": "finished",
    "WO": "finished",
    "AWD": "finished",
    "PST": "postponed",
    "CANC": "postponed",
    "ABD": "postponed",
}

# Raw API-Football short codes that mean "definitely not going to be played as
# scheduled" -- as opposed to plain 'PST', which may still be rescheduled.
_DEFINITIVELY_TERMINAL_SHORTS = frozenset({"CANC", "ABD"})


def map_fixture_status(short: Optional[str]) -> str:
    """Map an API-Football status code to scheduled/live/finished/postponed."""
    if not short:
        return "scheduled"
    status = _STATUS_MAP.get(short.upper())
    if status is None:
        log.warning("Unknown API fixture status %r; defaulting to 'scheduled'.", short)
        return "scheduled"
    return status


@dataclass(frozen=True)
class ParsedTeam:
    api_team_id: int
    name: str
    slug: str


@dataclass(frozen=True)
class ParsedFixture:
    api_league_id: int
    league_name: str
    league_slug: str
    country: str
    season: int
    home: ParsedTeam
    away: ParsedTeam
    api_fixture_id: int
    kickoff_utc: str
    status: str
    api_status_short: Optional[str]
    final_home_goals: Optional[int]
    final_away_goals: Optional[int]


def _parse_team(node: dict) -> ParsedTeam:
    return ParsedTeam(
        api_team_id=node["id"],
        name=node["name"],
        slug=util.slugify(node["name"]),
    )


def parse_fixture(item: dict, *, default_season: int) -> ParsedFixture:
    """Parse one API-Football /fixtures response item into a ParsedFixture."""
    fixture = item["fixture"]
    league = item["league"]
    teams = item["teams"]

    short = (fixture.get("status") or {}).get("short")
    status = map_fixture_status(short)

    # Final score only when the match is finished; otherwise leave it null.
    # Prefer score.fulltime, falling back to the goals object when fulltime is
    # absent OR explicitly null (the API uses {"home": null} for an empty score).
    if status == "finished":
        fulltime = (item.get("score") or {}).get("fulltime") or {}
        goals = item.get("goals") or {}
        final_home = fulltime.get("home")
        if final_home is None:
            final_home = goals.get("home")
        final_away = fulltime.get("away")
        if final_away is None:
            final_away = goals.get("away")
    else:
        final_home = final_away = None

    league_name = league.get("name") or f"League {league['id']}"
    return ParsedFixture(
        api_league_id=league["id"],
        league_name=league_name,
        league_slug=util.slugify(league_name),
        country=league.get("country") or "World",
        season=league.get("season") or default_season,
        home=_parse_team(teams["home"]),
        away=_parse_team(teams["away"]),
        api_fixture_id=fixture["id"],
        kickoff_utc=util.to_utc_iso(fixture["date"]),
        status=status,
        api_status_short=(short.upper() if short else None),
        final_home_goals=final_home,
        final_away_goals=final_away,
    )


def _is_terminal_non_played(pf: ParsedFixture, *, now) -> bool:
    """True if ``pf`` is 'postponed' and definitively won't be played as
    scheduled: a hard cancel/abandon code, or a plain postponement that has sat
    unresolved for longer than the configured horizon."""
    if pf.status != "postponed":
        return False
    if pf.api_status_short in _DEFINITIVELY_TERMINAL_SHORTS:
        return True
    kickoff_dt = util.parse_iso(pf.kickoff_utc)
    horizon = config.POSTPONED_VOID_HORIZON_DAYS
    return (now - kickoff_dt).days > horizon


def _fetch_all_pages(api: ApiFootballClient, league_id: int, season: int) -> list[dict]:
    """Fetch every page of /fixtures for one league/season, aggregating items."""
    items: list[dict] = []
    page = 1
    while True:
        payload = api.get_fixtures(league_id, season, page=page)
        batch = payload.get("response") or []
        items.extend(batch)
        paging = payload.get("paging") or {}
        total = paging.get("total") or 1
        current = paging.get("current") or page
        log.info(
            "Fetched page %s/%s for league %s season %s (%d items).",
            current, total, league_id, season, len(batch),
        )
        if current >= total:
            break
        page = current + 1
    return items


def run(
    *,
    dry_run: bool = False,
    store: Optional[SupabaseStore] = None,
    api: Optional[ApiFootballClient] = None,
) -> dict:
    api = api if api is not None else ApiFootballClient()
    if store is None and not dry_run:
        store = SupabaseStore()

    now = util.now_utc()
    counts = {
        "fixtures_seen": 0,
        "leagues_upserted": 0,
        "teams_upserted": 0,
        "fixtures_upserted": 0,
        "leagues_failed": 0,
        "predictions_closed_terminal": 0,
        "api_requests": 0,
    }

    # Caches shared ACROSS leagues within the run so each league/team is
    # upserted once even if referenced from more than one tracked league.
    league_ids: dict[int, int] = {}
    team_ids: dict[int, int] = {}

    for league_id in config.TRACKED_LEAGUE_IDS:
        try:
            items = _fetch_all_pages(api, league_id, config.SEASON)
        except RequestBudgetExceeded as exc:
            counts["leagues_failed"] += 1
            log.warning(
                "fetch_fixtures: request budget exhausted at league %s (%s); "
                "ending the run early.", league_id, exc,
            )
            break
        except ApiFootballError as exc:
            counts["leagues_failed"] += 1
            log.error(
                "fetch_fixtures: league %s failed (%s); continuing with any "
                "remaining tracked leagues (already-written leagues are kept).",
                league_id, exc,
            )
            continue

        parsed_league: list[ParsedFixture] = []
        for item in items:
            try:
                parsed_league.append(parse_fixture(item, default_season=config.SEASON))
            except (KeyError, TypeError) as exc:
                log.warning("Skipping unparseable fixture item: %s", exc)
        counts["fixtures_seen"] += len(parsed_league)

        if dry_run or store is None:
            for pf in parsed_league:
                log.info(
                    "[dry-run] would upsert fixture api_id=%s: %s v %s kickoff=%s "
                    "status=%s score=%s-%s",
                    pf.api_fixture_id, pf.home.name, pf.away.name, pf.kickoff_utc,
                    pf.status, pf.final_home_goals, pf.final_away_goals,
                )
            continue

        for pf in parsed_league:
            if pf.api_league_id not in league_ids:
                league_ids[pf.api_league_id] = store.upsert_league(
                    api_league_id=pf.api_league_id, name=pf.league_name,
                    slug=pf.league_slug, country=pf.country, season=pf.season,
                )
                counts["leagues_upserted"] += 1
            resolved_league_id = league_ids[pf.api_league_id]

            for team in (pf.home, pf.away):
                if team.api_team_id not in team_ids:
                    team_ids[team.api_team_id] = store.upsert_team(
                        api_team_id=team.api_team_id, name=team.name,
                        slug=team.slug, league_id=resolved_league_id,
                    )
                    counts["teams_upserted"] += 1

            fixture_id = store.upsert_fixture(
                api_fixture_id=pf.api_fixture_id,
                league_id=resolved_league_id,
                home_team_id=team_ids[pf.home.api_team_id],
                away_team_id=team_ids[pf.away.api_team_id],
                kickoff_utc=pf.kickoff_utc,
                status=pf.status,
                final_home_goals=pf.final_home_goals,
                final_away_goals=pf.final_away_goals,
            )
            counts["fixtures_upserted"] += 1

            if _is_terminal_non_played(pf, now=now):
                closed = store.close_out_terminal_fixture_predictions(fixture_id)
                if closed:
                    counts["predictions_closed_terminal"] += closed
                    log.warning(
                        "Fixture %s (api_id=%s) is terminally non-played "
                        "(status_short=%s); closed out %d open prediction(s) "
                        "as void_cancelled.",
                        fixture_id, pf.api_fixture_id, pf.api_status_short, closed,
                    )

    counts["api_requests"] = api.request_count
    return counts


if __name__ == "__main__":
    main(run, "Fetch fixtures")
