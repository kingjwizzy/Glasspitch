"""Daily job: one third-party prediction per fixture + logged Elo (ARCHITECTURE.md §8.2, §9).

For each fixture WITHIN THE KICKOFF WINDOW (config.PREDICTION_FETCH_WINDOW_HOURS
-- default 72h) that doesn't already have an api-football prediction: GET
/predictions?fixture={id} EXACTLY ONCE (the rate-limit rule, §8), parse the
home/draw/away percentages, normalise them to sum to exactly 1.0, derive a
predicted scoreline, and insert a published prediction (locked_at = kickoff).
Alongside it, compute and insert the in-house Elo prediction (logged-only, §9).

Runs in two decoupled passes: the third-party fetch loop is isolated per
fixture (one bad fixture logs + continues; RequestBudgetExceeded ends that
pass early and gracefully, never crashing the run) and the Elo pass runs for
every fixture in the window regardless of how the first pass went, since it
makes no API call and doesn't depend on the request budget.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from jobs import config, elo, util
from jobs.apiclient import ApiFootballClient, ApiFootballError, RequestBudgetExceeded
from jobs.cli import main
from jobs.db import SupabaseStore

log = logging.getLogger(__name__)


def parse_percent(value) -> float:
    """Parse an API percentage like '45%' or 45 into a fraction in [0, 1]."""
    if value is None:
        raise ValueError("missing percentage")
    return float(str(value).strip().rstrip("%")) / 100.0


def normalise_probabilities(
    home: float, draw: float, away: float
) -> tuple[float, float, float]:
    """Scale three non-negative numbers so they sum to exactly 1.0."""
    total = home + draw + away
    if total <= 0:
        raise ValueError("probabilities must sum to a positive number")
    return (home / total, draw / total, away / total)


def predicted_scoreline_from_probabilities(
    prob_home: float,
    prob_draw: float,
    prob_away: float,
    total_goals: float = elo.EXPECTED_TOTAL_GOALS,
) -> tuple[int, int]:
    """Derive an integer scoreline from H/D/A probabilities.

    API-Football's /predictions has no explicit scoreline, so we derive one: the
    home share counts a draw as half (the same convention as the Elo scoreline),
    split across a baseline total-goals figure. Documented heuristic.
    """
    home_share = prob_home + 0.5 * prob_draw
    home_goals = round(total_goals * home_share)
    away_goals = round(total_goals * (1.0 - home_share))
    return (int(home_goals), int(away_goals))


@dataclass(frozen=True)
class ParsedApiPrediction:
    prob_home: float
    prob_draw: float
    prob_away: float
    scoreline: tuple[int, int]
    advice: Optional[str]


def parse_api_prediction(payload: dict) -> Optional[ParsedApiPrediction]:
    """Parse an API-Football /predictions payload, or None if no usable data."""
    response = (payload or {}).get("response") or []
    if not response:
        return None
    predictions = (response[0] or {}).get("predictions") or {}
    percent = predictions.get("percent") or {}
    try:
        raw_home = parse_percent(percent.get("home"))
        raw_draw = parse_percent(percent.get("draw"))
        raw_away = parse_percent(percent.get("away"))
    except (TypeError, ValueError):
        return None
    if raw_home + raw_draw + raw_away <= 0:
        return None
    prob_home, prob_draw, prob_away = normalise_probabilities(raw_home, raw_draw, raw_away)
    return ParsedApiPrediction(
        prob_home=prob_home,
        prob_draw=prob_draw,
        prob_away=prob_away,
        scoreline=predicted_scoreline_from_probabilities(prob_home, prob_draw, prob_away),
        advice=predictions.get("advice"),
    )


def build_prediction_row(
    *,
    fixture_id: int,
    source: str,
    model_version: str,
    probabilities: tuple[float, float, float],
    scoreline: tuple[int, int],
    kickoff_utc: str,
    now_iso: str,
) -> dict:
    prob_home, prob_draw, prob_away = probabilities
    home_goals, away_goals = scoreline
    return {
        "fixture_id": fixture_id,
        "model_version": model_version,
        "source": source,
        "prob_home": prob_home,
        "prob_draw": prob_draw,
        "prob_away": prob_away,
        "predicted_home_goals": home_goals,
        "predicted_away_goals": away_goals,
        "published_at": now_iso,
        "locked_at": kickoff_utc,  # = kickoff (§7)
        "status": "published",
    }


def _derived_ratings(store: SupabaseStore) -> dict:
    """Current Elo ratings, derived by replaying finished fixtures (§9),
    scoped to the tracked league(s) + season (config.py) so results from other
    seasons/competitions never leak into the replayed ratings pool.
    """
    finished = store.finished_fixtures_for_replay(
        api_league_ids=config.TRACKED_LEAGUE_IDS, season=config.SEASON,
    )
    results = [
        (f["home_team_id"], f["away_team_id"], f["final_home_goals"], f["final_away_goals"])
        for f in finished
        if f.get("final_home_goals") is not None and f.get("final_away_goals") is not None
    ]
    return elo.ratings_from_results(results)


def run(
    *,
    dry_run: bool = False,
    store: Optional[SupabaseStore] = None,
    api: Optional[ApiFootballClient] = None,
    now=None,
) -> dict:
    api = api if api is not None else ApiFootballClient()
    store = store if store is not None else SupabaseStore()

    def _stamp() -> str:
        # Computed fresh per insert (not once at run start): a slow run
        # (retries, many fixtures) must not stamp published_at with a
        # run-start time that predates kickoff by more than reality -- see
        # v2 hardening notes. When ``now`` is injected (tests), it stays fixed.
        return (now or util.now_utc()).isoformat()

    upcoming = store.upcoming_fixtures_within(config.PREDICTION_FETCH_WINDOW_HOURS)
    have_api = store.existing_prediction_fixture_ids(config.THIRD_PARTY_SOURCE)
    have_elo = store.existing_prediction_fixture_ids(config.ELO_SOURCE)

    counts = {
        "upcoming": len(upcoming),
        "api_fetched": 0,
        "api_inserted": 0,
        "api_empty": 0,
        "api_skipped_existing": 0,
        "api_failed": 0,
        "budget_exhausted": False,
        "elo_inserted": 0,
        "elo_skipped_existing": 0,
    }

    # --- Pass 1: third-party (API-Football) prediction, fetched ONCE per
    # fixture, isolated per fixture so one bad fixture can't abort the run.
    for fixture in upcoming:
        fixture_id = fixture["id"]
        if fixture_id in have_api:
            counts["api_skipped_existing"] += 1
            continue

        try:
            payload = api.get_predictions(fixture["api_fixture_id"])
        except RequestBudgetExceeded as exc:
            # Subclasses ApiFootballError (jobs/apiclient.py) -- must be caught
            # FIRST and handled as "stop fetching, budget is gone", not as
            # "this one fixture failed".
            counts["budget_exhausted"] = True
            log.warning(
                "fetch_predictions: request budget exhausted (%s); ending the "
                "API-Football pass early (the Elo pass below still runs).", exc,
            )
            break
        except ApiFootballError as exc:
            counts["api_failed"] += 1
            log.error(
                "fetch_predictions: fixture %s (api_id=%s) failed (%s); "
                "continuing with remaining fixtures.",
                fixture_id, fixture["api_fixture_id"], exc,
            )
            continue

        counts["api_fetched"] += 1
        parsed = parse_api_prediction(payload)
        if parsed is None:
            counts["api_empty"] += 1
            log.info(
                "No third-party prediction for fixture %s (api_id=%s); "
                "skipping (may retry next run).",
                fixture_id, fixture["api_fixture_id"],
            )
            continue

        row = build_prediction_row(
            fixture_id=fixture_id,
            source=config.THIRD_PARTY_SOURCE,
            model_version=config.THIRD_PARTY_MODEL_VERSION,
            probabilities=(parsed.prob_home, parsed.prob_draw, parsed.prob_away),
            scoreline=parsed.scoreline,
            kickoff_utc=fixture["kickoff_utc"],
            now_iso=_stamp(),
        )
        if dry_run:
            log.info(
                "[dry-run] would insert api-football prediction for fixture "
                "%s: H/D/A=%.3f/%.3f/%.3f score=%s advice=%r",
                fixture_id, parsed.prob_home, parsed.prob_draw, parsed.prob_away,
                parsed.scoreline, parsed.advice,
            )
        elif store.insert_prediction(row) is not None:
            counts["api_inserted"] += 1

    # --- Pass 2: in-house Elo (logged-only — §9). Runs for every fixture in the
    # window regardless of pass 1's outcome: no API call, no budget dependency.
    ratings = _derived_ratings(store)
    for fixture in upcoming:
        fixture_id = fixture["id"]
        if fixture_id in have_elo:
            counts["elo_skipped_existing"] += 1
            continue

        home_rating = ratings.get(fixture["home_team_id"], elo.DEFAULT_RATING)
        away_rating = ratings.get(fixture["away_team_id"], elo.DEFAULT_RATING)
        probs = elo.match_probabilities(home_rating, away_rating)
        normalised = normalise_probabilities(probs["home"], probs["draw"], probs["away"])
        row = build_prediction_row(
            fixture_id=fixture_id,
            source=config.ELO_SOURCE,
            model_version=config.ELO_MODEL_VERSION,
            probabilities=normalised,
            scoreline=elo.predicted_scoreline(home_rating, away_rating),
            kickoff_utc=fixture["kickoff_utc"],
            now_iso=_stamp(),
        )
        if dry_run:
            log.info(
                "[dry-run] would insert elo-v1 prediction for fixture %s: "
                "H/D/A=%.3f/%.3f/%.3f score=%s (ratings %.0f/%.0f)",
                fixture_id, *normalised, row["predicted_home_goals"],
                home_rating, away_rating,
            )
        elif store.insert_prediction(row) is not None:
            counts["elo_inserted"] += 1

    # Surface true network usage (includes retries) so an operator can see how
    # much of the request budget a run — including a --dry-run — consumed (§8).
    counts["api_requests"] = api.request_count
    return counts


if __name__ == "__main__":
    main(run, "Fetch predictions")
