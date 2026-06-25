"""Daily job: fetch fixtures and upsert leagues/teams/fixtures (ARCHITECTURE.md §8.1).

GET /fixtures?league={id}&season={SEASON} for each tracked league, then upsert
the league, both teams (plain names, no crests — §13) and the fixture, keyed on
the api_* ids so re-running is safe (idempotent — §5, §8). Maps the API status to
our enum, stores kickoff in UTC, and stores the final score when finished.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from jobs import config, util
from jobs.apiclient import ApiFootballClient
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

    status = map_fixture_status((fixture.get("status") or {}).get("short"))

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
        final_home_goals=final_home,
        final_away_goals=final_away,
    )


def run(
    *,
    dry_run: bool = False,
    store: Optional[SupabaseStore] = None,
    api: Optional[ApiFootballClient] = None,
) -> dict:
    api = api if api is not None else ApiFootballClient()
    if store is None and not dry_run:
        store = SupabaseStore()

    parsed: list[ParsedFixture] = []
    for league_id in config.TRACKED_LEAGUE_IDS:
        payload = api.get_fixtures(league_id, config.SEASON)
        items = payload.get("response") or []
        log.info(
            "Fetched %d fixtures for league %s season %s.",
            len(items), league_id, config.SEASON,
        )
        paging = payload.get("paging") or {}
        if (paging.get("total") or 1) > 1:
            log.warning(
                "League %s returned %s pages but only page %s is read. Pagination "
                "is not implemented — fine for a single competition-season like the "
                "World Cup; revisit before club football.",
                league_id, paging.get("total"), paging.get("current", 1),
            )
        for item in items:
            try:
                parsed.append(parse_fixture(item, default_season=config.SEASON))
            except (KeyError, TypeError) as exc:
                log.warning("Skipping unparseable fixture item: %s", exc)

    counts = {
        "fixtures_seen": len(parsed),
        "leagues_upserted": 0,
        "teams_upserted": 0,
        "fixtures_upserted": 0,
        "api_requests": api.request_count,
    }

    if dry_run or store is None:
        for pf in parsed:
            log.info(
                "[dry-run] would upsert fixture api_id=%s: %s v %s kickoff=%s "
                "status=%s score=%s-%s",
                pf.api_fixture_id, pf.home.name, pf.away.name, pf.kickoff_utc,
                pf.status, pf.final_home_goals, pf.final_away_goals,
            )
        return counts

    # Cache ids within the run so each league/team is upserted once.
    league_ids: dict[int, int] = {}
    team_ids: dict[int, int] = {}
    for pf in parsed:
        if pf.api_league_id not in league_ids:
            league_ids[pf.api_league_id] = store.upsert_league(
                api_league_id=pf.api_league_id, name=pf.league_name,
                slug=pf.league_slug, country=pf.country, season=pf.season,
            )
            counts["leagues_upserted"] += 1
        league_id = league_ids[pf.api_league_id]

        for team in (pf.home, pf.away):
            if team.api_team_id not in team_ids:
                team_ids[team.api_team_id] = store.upsert_team(
                    api_team_id=team.api_team_id, name=team.name,
                    slug=team.slug, league_id=league_id,
                )
                counts["teams_upserted"] += 1

        store.upsert_fixture(
            api_fixture_id=pf.api_fixture_id,
            league_id=league_id,
            home_team_id=team_ids[pf.home.api_team_id],
            away_team_id=team_ids[pf.away.api_team_id],
            kickoff_utc=pf.kickoff_utc,
            status=pf.status,
            final_home_goals=pf.final_home_goals,
            final_away_goals=pf.final_away_goals,
        )
        counts["fixtures_upserted"] += 1

    return counts


if __name__ == "__main__":
    main(run, "Fetch fixtures")
