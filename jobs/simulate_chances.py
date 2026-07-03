"""Nightly(-ish) job: Monte Carlo simulation of the remaining World Cup
knockout bracket -- "World Cup Chances" (ARCHITECTURE.md v3, ROADMAP.md §4
item 7, migration 0007). DB-only: makes NO football-API call.

## What this simulates, and from what

Scoped to ``config.KNOCKOUT_ROUND_ORDER`` (``['Round of 32', 'Round of 16',
'Quarter-finals', 'Semi-finals', 'Final']``) -- the group stage is OUT OF
SCOPE for v1 (see "Known limitation" below). For every fixture already in
the DB whose normalised ``round`` is in that list (jobs/fetch_fixtures.py's
``normalize_round``), each of ``config.MONTE_CARLO_SIMS`` (default 10,000)
independent trials resolves the ENTIRE remaining bracket:

* A fixture that's already ``finished`` uses its TRUE outcome (never
  sampled) -- via ``fixtures.winner_team_id`` (migration 0007), which is the
  API's own definitive winner flag and, unlike the final score alone,
  correctly captures a match decided by extra time or penalties (a 90-minute
  draw that still has a real winner -- see that migration's header comment).
  A truly finished match therefore contributes the SAME certain outcome to
  every trial.
* A fixture that hasn't kicked off yet (``scheduled``/``live``) samples its
  winner from a three-way H/D/A probability: the fixture's own stored
  ``api-football`` prediction if one already exists on the ledger, else this
  job's own Elo-derived estimate (``jobs.elo.match_probabilities``, replayed
  the SAME way ``fetch_predictions.py``/``snapshot_probabilities.py`` do --
  never a second, divergent Elo implementation).
* A round that ISN'T FULLY PUBLISHED yet by the data provider (API-Football
  only publishes a knockout fixture once BOTH its feeder matches are
  decided -- confirmed live 2026-07-03: only 6 of 8 Round-of-16 slots existed
  while 2 Round-of-32 matches were still unplayed) is filled in by pairing
  that round's remaining, not-yet-paired survivors ourselves, in kickoff-order
  (see "Bracket-derivation convention" below) -- a synthetic match, priced
  purely from Elo (no home advantage: we don't know who would host a match
  that doesn't exist yet).

**Extra-time/penalties convention (knockout draws):** a sampled result of
'draw' can't stand for a knockout match -- it is resolved by a coin weighted
by the two sides' RELATIVE 90-minute strength, i.e.
``P(home advances | drawn after 90) = prob_home / (prob_home + prob_away)``.
This is a deliberately simple, documented approximation of "extra time and
penalties are close to a coin flip, tilted slightly toward the side that was
already favoured" -- it is not a claim to model shootouts specifically.

**Bracket-derivation convention (documented, honest limitation):**
API-Football does not expose the official FIFA bracket tree (which Round-of-32
slot's winner meets which other slot's winner), and this job makes NO extra
API call to go looking for one. For any round-of-N slot NOT already resolved
by a real, provider-published fixture, this job pairs that round's
UN-paired survivors from the previous round ADJACENTLY, in
``(kickoff_utc, api_fixture_id)`` order of the match that produced them. This
is an approximation, not the true bracket -- verified live against WC 2026
that it does NOT always match the real published pairing (the real bracket's
adjacency doesn't strictly follow kickoff-chronological order, because of
scheduling/venue logistics). It only ever affects the HANDFUL of slots not
yet published, and self-corrects daily: once the data provider publishes the
real pairing (via the next `fetch_fixtures` sweep), this job uses that REAL
fixture directly instead, the very next time it runs.

**Known limitation (out of scope for v1):** this job assumes its EARLIEST
present knockout round (typically 'Round of 32') is already fully populated
with real fixtures -- i.e. group-stage-to-knockout qualification (which of
48 teams advance, including 3rd-placed-team tie-breaks) is NOT itself
simulated. If the tracked competition hasn't reached the knockout stage yet,
this job finds no candidate fixtures and no-ops.

## What gets a row

One ``tournament_chances`` row per snapshot_date per SURVIVING team: every
team that has ever appeared in a knockout fixture, MINUS anyone already
eliminated by an already-``finished`` match (``fixtures.winner_team_id``/
final score) -- computed directly from ground truth, not from the simulation
(a team's elimination is a certainty once its match is over, not a
probability). ``p_win_tournament`` / ``p_reach_final`` / ``p_reach_semi`` are
the trial-fraction of times that team was the champion / a Final
participant / a Semi-finals participant respectively.
"""

from __future__ import annotations

import logging
import random
from typing import Optional

from jobs import config, elo, util
from jobs.cli import main
from jobs.db import SupabaseStore

log = logging.getLogger(__name__)


def _derived_ratings(store: SupabaseStore) -> dict:
    """Current Elo ratings, replayed from finished fixtures -- kept as a
    separate copy (not a shared import) so each job's replay stays
    self-contained, matching fetch_predictions.py/snapshot_probabilities.py's
    own copies; all three call the same public ``jobs.elo.ratings_from_results``.
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


def _true_winner(fixture: dict) -> Optional[int]:
    """The real team_id that advanced from an already-``finished`` knockout
    fixture. Prefers ``winner_team_id`` (migration 0007 -- correct even when
    a shootout followed a 90-minute draw); falls back to comparing the final
    score for a legacy/edge-case row with no ``winner_team_id`` yet (should
    be rare -- every row jobs/fetch_fixtures.py writes from now on populates
    it). Returns ``None`` if genuinely undetermined (a real draw, impossible
    in the knockout stage, or missing data) -- the caller then falls back to
    sampling exactly like an unresolved match.
    """
    winner = fixture.get("winner_team_id")
    if winner is not None:
        return winner
    home, away = fixture.get("final_home_goals"), fixture.get("final_away_goals")
    if home is None or away is None:
        return None
    if home > away:
        return fixture["home_team_id"]
    if away > home:
        return fixture["away_team_id"]
    return None


def _sample_outcome(
    prob_home: float, prob_draw: float, prob_away: float, *, rng: random.Random
) -> str:
    """Sample 'home'/'draw'/'away' from a three-way probability, then resolve
    a 'draw' into a knockout winner via the documented relative-strength
    convention (see module docstring)."""
    roll = rng.random()
    if roll < prob_home:
        outcome = "home"
    elif roll < prob_home + prob_draw:
        outcome = "draw"
    else:
        outcome = "away"
    if outcome != "draw":
        return outcome
    denom = prob_home + prob_away
    p_home_extra_time = 0.5 if denom <= 0 else prob_home / denom
    return "home" if rng.random() < p_home_extra_time else "away"


def _match_probs(
    fixture: Optional[dict],
    team_a: int,
    team_b: int,
    *,
    ratings: dict,
    pred_probs: dict[int, dict],
) -> dict[str, float]:
    """Three-way probability for one match, ``team_a`` in the 'home' slot.

    A KNOWN, not-yet-finished fixture prefers its own stored third-party
    prediction; otherwise (including every SYNTHETIC match, which has no
    fixture row at all) falls back to Elo. Synthetic matches use NO home
    advantage -- we don't know who would host a fixture that doesn't exist
    yet, so treating the pairing as neutral avoids arbitrarily favouring
    whichever team happened to sort first.
    """
    if fixture is not None:
        stored = pred_probs.get(fixture["id"])
        if stored is not None:
            return stored
        return elo.match_probabilities(
            ratings.get(team_a, elo.DEFAULT_RATING), ratings.get(team_b, elo.DEFAULT_RATING)
        )
    return elo.match_probabilities(
        ratings.get(team_a, elo.DEFAULT_RATING),
        ratings.get(team_b, elo.DEFAULT_RATING),
        home_advantage=0.0,
    )


def _resolve_match(
    fixture: Optional[dict],
    team_a: int,
    team_b: int,
    *,
    ratings: dict,
    pred_probs: dict[int, dict],
    rng: random.Random,
) -> int:
    """Resolve one match (real or synthetic) to a single advancing team_id."""
    if fixture is not None and fixture["status"] == "finished":
        winner = _true_winner(fixture)
        if winner is not None:
            return winner
        log.warning(
            "simulate_chances: finished fixture %s has no derivable true "
            "winner (no winner_team_id and an equal final score); falling "
            "back to sampling for this trial.",
            fixture.get("id"),
        )
    probs = _match_probs(fixture, team_a, team_b, ratings=ratings, pred_probs=pred_probs)
    outcome = _sample_outcome(probs["home"], probs["draw"], probs["away"], rng=rng)
    return team_a if outcome == "home" else team_b


def _round_matches(
    round_name: str, known: list[dict], carry_in: list[int]
) -> list[tuple[Optional[dict], int, int]]:
    """Build the full match list for one round: every REAL fixture already
    known for this round, verbatim, PLUS a synthetic match for each pair of
    ``carry_in`` survivors not already accounted for by one of those real
    fixtures (paired adjacently, in ``carry_in``'s own order -- see the
    module docstring's "Bracket-derivation convention").
    """
    known_teams = {team for f in known for team in (f["home_team_id"], f["away_team_id"])}
    leftover = [team for team in carry_in if team not in known_teams]

    if len(leftover) % 2 != 0:
        log.warning(
            "simulate_chances: odd number (%d) of unpaired survivors entering "
            "%r; dropping the last one from this trial's synthetic pairing "
            "(a real fixture should appear once the data provider publishes "
            "it).",
            len(leftover), round_name,
        )
        leftover = leftover[:-1]

    matches: list[tuple[Optional[dict], int, int]] = [
        (f, f["home_team_id"], f["away_team_id"]) for f in known
    ]
    for i in range(0, len(leftover), 2):
        matches.append((None, leftover[i], leftover[i + 1]))
    return matches


def run_trial(
    round_order: list[str],
    fixtures_by_round: dict[str, list[dict]],
    *,
    ratings: dict,
    pred_probs: dict[int, dict],
    rng: random.Random,
) -> dict:
    """One Monte Carlo trial: resolve every round in ``round_order`` in
    sequence. Returns ``{'reached': {round_name: {team_id, ...}}, 'champion':
    team_id or None}`` -- ``reached[round_name]`` is every team that was a
    PARTICIPANT of that round (i.e. survived to enter it), win or lose.
    """
    carry_in: list[int] = []
    reached: dict[str, set] = {}
    for round_name in round_order:
        known = fixtures_by_round.get(round_name, [])
        matches = _round_matches(round_name, known, carry_in)
        reached[round_name] = {team for _, a, b in matches for team in (a, b)}
        carry_in = [
            _resolve_match(f, a, b, ratings=ratings, pred_probs=pred_probs, rng=rng)
            for f, a, b in matches
        ]
    champion = carry_in[0] if carry_in else None
    return {"reached": reached, "champion": champion}


def run(
    *,
    dry_run: bool = False,
    store: Optional[SupabaseStore] = None,
    sims: Optional[int] = None,
    seed: Optional[int] = None,
    now=None,
) -> dict:
    store = store if store is not None else SupabaseStore()
    now = now or util.now_utc()
    snapshot_date = now.date().isoformat()
    sims = sims if sims is not None else config.MONTE_CARLO_SIMS
    # A LOCAL rng instance -- never touches the interpreter's global random
    # state. seed=None (the live default) draws from system entropy exactly
    # like the bare `random` module would; tests pass a fixed seed for
    # deterministic output.
    rng = random.Random(seed)

    counts = {
        "knockout_fixtures_seen": 0,
        "teams_alive": 0,
        "sims": sims,
        "chances_candidates": 0,
        "chances_written": 0,
    }

    fixtures = store.fixtures_for_rounds(
        api_league_ids=config.TRACKED_LEAGUE_IDS,
        season=config.SEASON,
        rounds=config.KNOCKOUT_ROUND_ORDER,
    )
    counts["knockout_fixtures_seen"] = len(fixtures)
    if not fixtures:
        log.info(
            "simulate_chances: no knockout-stage fixtures yet (looked for "
            "round in %s); nothing to simulate.",
            config.KNOCKOUT_ROUND_ORDER,
        )
        return counts

    fixtures_by_round: dict[str, list[dict]] = {}
    for fixture in fixtures:
        fixtures_by_round.setdefault(fixture["round"], []).append(fixture)
    for round_fixtures in fixtures_by_round.values():
        round_fixtures.sort(key=lambda f: (f["kickoff_utc"], f["api_fixture_id"]))

    # Ground truth: every knockout participant MINUS anyone already
    # eliminated by an already-finished match -- NOT derived from the
    # simulation (elimination is a certainty once the match is over).
    all_participants: set[int] = set()
    eliminated: set[int] = set()
    for fixture in fixtures:
        all_participants.add(fixture["home_team_id"])
        all_participants.add(fixture["away_team_id"])
        if fixture["status"] == "finished":
            winner = _true_winner(fixture)
            if winner is not None:
                loser = (
                    fixture["away_team_id"]
                    if winner == fixture["home_team_id"]
                    else fixture["home_team_id"]
                )
                eliminated.add(loser)
    alive_teams = sorted(all_participants - eliminated)
    counts["teams_alive"] = len(alive_teams)
    if not alive_teams:
        log.info("simulate_chances: no surviving teams (tournament decided); nothing to write.")
        return counts

    ratings = _derived_ratings(store)
    unfinished_fixture_ids = [f["id"] for f in fixtures if f["status"] != "finished"]
    pred_probs = (
        store.third_party_prediction_probs(
            unfinished_fixture_ids, source=config.THIRD_PARTY_SOURCE
        )
        if unfinished_fixture_ids
        else {}
    )

    win_counts = {team_id: 0 for team_id in alive_teams}
    reach_final_counts = {team_id: 0 for team_id in alive_teams}
    reach_semi_counts = {team_id: 0 for team_id in alive_teams}

    for _ in range(sims):
        trial = run_trial(
            config.KNOCKOUT_ROUND_ORDER, fixtures_by_round,
            ratings=ratings, pred_probs=pred_probs, rng=rng,
        )
        champion = trial["champion"]
        if champion in win_counts:
            win_counts[champion] += 1
        for team_id in trial["reached"].get("Final", ()):
            if team_id in reach_final_counts:
                reach_final_counts[team_id] += 1
        for team_id in trial["reached"].get("Semi-finals", ()):
            if team_id in reach_semi_counts:
                reach_semi_counts[team_id] += 1

    rows = [
        {
            "snapshot_date": snapshot_date,
            "team_id": team_id,
            "p_win_tournament": win_counts[team_id] / sims,
            "p_reach_final": reach_final_counts[team_id] / sims,
            "p_reach_semi": reach_semi_counts[team_id] / sims,
            "sims": sims,
        }
        for team_id in alive_teams
    ]
    counts["chances_candidates"] = len(rows)

    if dry_run:
        for row in sorted(rows, key=lambda r: r["p_win_tournament"], reverse=True):
            log.info(
                "[dry-run] would write tournament_chances for team %s: "
                "win=%.4f final=%.4f semi=%.4f (sims=%d)",
                row["team_id"], row["p_win_tournament"], row["p_reach_final"],
                row["p_reach_semi"], sims,
            )
    else:
        counts["chances_written"] = store.upsert_tournament_chances(rows)

    return counts


if __name__ == "__main__":
    main(run, "Simulate World Cup chances")
