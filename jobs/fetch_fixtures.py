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

Live match clock (migration 0011, UI-overhaul spec item #1): also stores the
raw ``fixture.status.short`` code and ``fixture.status.elapsed``/``.extra``
(added time) off this SAME already-fetched response, so match pages can
render "67'"/"HT"/"90+2'" instead of just the word "Live" -- zero extra API
calls, since this ~15-minutely poll already exists for lock/score detection.
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


# Canonical round strings this job normalises RAW API-Football `league.round`
# values into (matched case/whitespace-insensitively against the raw string).
# Confirmed LIVE against API-Football (2026-07-03): the WC 2026 season (in
# progress) currently returns 'Group Stage - 1'/'- 2'/'- 3', 'Round of 32',
# 'Round of 16' verbatim; the knockout strings beyond Round of 16 were
# confirmed against the COMPLETED 2022 Qatar World Cup (season=2022, same
# competition/provider -- only the 48-vs-32-team format differs):
# 'Quarter-finals', 'Semi-finals', '3rd Place Final', 'Final'. This map only
# canonicalises spelling VARIANTS of those already-confirmed strings (e.g. a
# hyphen-less 'Quarterfinals') -- it never guesses at a round it hasn't seen;
# see normalize_round()'s docstring for what happens to anything else
# (group-stage rounds, and eventually club-football round strings).
_ROUND_CANONICAL: dict[str, str] = {
    variant: canonical
    for canonical, variants in {
        "Round of 32": ("round of 32",),
        "Round of 16": ("round of 16",),
        "Quarter-finals": ("quarter-finals", "quarterfinals", "quarter finals"),
        "Semi-finals": ("semi-finals", "semifinals", "semi finals"),
        "3rd Place Final": (
            "3rd place final", "third place final",
            "3rd place play-off", "3rd place playoff",
        ),
        "Final": ("final",),
    }.items()
    for variant in variants
}


def normalize_round(raw: Optional[str]) -> Optional[str]:
    """Normalise a raw API-Football `league.round` string (jobs/db.py's
    `fixtures.round`; the raw value is kept alongside as `api_round`).

    Collapses whitespace and canonicalises known knockout-round spelling
    variants (``_ROUND_CANONICAL`` above, confirmed live -- see that dict's
    comment). Anything unrecognised -- a group-stage round ('Group Stage -
    1'), or a future club-football round string -- is returned
    whitespace-collapsed as-is: normalisation never drops or guesses at data
    it doesn't recognise. Returns ``None`` for a null/empty input.
    """
    if not raw:
        return None
    cleaned = " ".join(raw.split())
    if not cleaned:
        return None
    return _ROUND_CANONICAL.get(cleaned.lower(), cleaned)


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
    round: Optional[str]
    api_round: Optional[str]
    winner_api_team_id: Optional[int]
    # Live match clock (migration 0011, UI-overhaul spec item #1) -- sourced
    # from the SAME fixture.status node api_status_short already reads; null
    # whenever the provider omits them (not started/finished/no stoppage).
    elapsed_minute: Optional[int]
    elapsed_extra_minute: Optional[int]


def _parse_team(node: dict) -> ParsedTeam:
    return ParsedTeam(
        api_team_id=node["id"],
        name=node["name"],
        slug=util.slugify(node["name"]),
    )


def _parse_winner_api_team_id(
    teams_node: dict, home: ParsedTeam, away: ParsedTeam
) -> Optional[int]:
    """The API's own definitive winner flag (`teams.home/away.winner`) --
    NOT derivable from the final score alone for a knockout match decided by
    extra time or penalties: API-Football's `goals`/`score.fulltime` stays
    the NORMAL-TIME score (verified live 2026-07-03, e.g. Germany 1-1
    Paraguay decided on penalties -- `score.penalty: {home: 3, away: 4}`, but
    `teams.away.winner: true`). Exactly one of the two `winner` booleans is
    `true` for a decided match; both are `null` for a genuine draw (only
    possible outside the knockout stage) or a not-yet-played fixture -- see
    migration 0007's header comment for why this is stored at all
    (jobs/simulate_chances.py's bracket progression needs it).
    """
    home_winner = (teams_node.get("home") or {}).get("winner")
    away_winner = (teams_node.get("away") or {}).get("winner")
    if home_winner is True and away_winner is not True:
        return home.api_team_id
    if away_winner is True and home_winner is not True:
        return away.api_team_id
    return None


def parse_fixture(item: dict, *, default_season: int) -> ParsedFixture:
    """Parse one API-Football /fixtures response item into a ParsedFixture."""
    fixture = item["fixture"]
    league = item["league"]
    teams = item["teams"]

    status_node = fixture.get("status") or {}
    short = status_node.get("short")
    status = map_fixture_status(short)
    # Live match clock (migration 0011): elapsed/extra come straight off this
    # SAME status node -- no extra parsing, no extra API cost. Whatever the
    # provider returns (an int, or absent/null) is stored as-is; API-Football
    # itself nulls these outside of live play, so no separate status-based
    # branching is needed here.
    elapsed_minute = status_node.get("elapsed")
    elapsed_extra_minute = status_node.get("extra")

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

    home = _parse_team(teams["home"])
    away = _parse_team(teams["away"])
    league_name = league.get("name") or f"League {league['id']}"
    api_round = league.get("round")
    return ParsedFixture(
        api_league_id=league["id"],
        league_name=league_name,
        league_slug=util.slugify(league_name),
        country=league.get("country") or "World",
        season=league.get("season") or default_season,
        home=home,
        away=away,
        api_fixture_id=fixture["id"],
        kickoff_utc=util.to_utc_iso(fixture["date"]),
        status=status,
        api_status_short=(short.upper() if short else None),
        final_home_goals=final_home,
        final_away_goals=final_away,
        round=normalize_round(api_round),
        api_round=api_round,
        winner_api_team_id=_parse_winner_api_team_id(teams, home, away),
        elapsed_minute=elapsed_minute,
        elapsed_extra_minute=elapsed_extra_minute,
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
                    "status=%s (short=%s elapsed=%s+%s) score=%s-%s round=%r "
                    "winner_api_team_id=%s",
                    pf.api_fixture_id, pf.home.name, pf.away.name, pf.kickoff_utc,
                    pf.status, pf.api_status_short, pf.elapsed_minute,
                    pf.elapsed_extra_minute, pf.final_home_goals, pf.final_away_goals,
                    pf.round, pf.winner_api_team_id,
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

            # winner_api_team_id, when present, is always one of home/away --
            # both are guaranteed already-resolved by the upsert loop above.
            resolved_winner_team_id = (
                team_ids[pf.winner_api_team_id]
                if pf.winner_api_team_id is not None
                else None
            )
            fixture_id = store.upsert_fixture(
                api_fixture_id=pf.api_fixture_id,
                league_id=resolved_league_id,
                home_team_id=team_ids[pf.home.api_team_id],
                away_team_id=team_ids[pf.away.api_team_id],
                kickoff_utc=pf.kickoff_utc,
                status=pf.status,
                final_home_goals=pf.final_home_goals,
                final_away_goals=pf.final_away_goals,
                round_name=pf.round,
                api_round=pf.api_round,
                winner_team_id=resolved_winner_team_id,
                status_short=pf.api_status_short,
                elapsed_minute=pf.elapsed_minute,
                elapsed_extra_minute=pf.elapsed_extra_minute,
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
