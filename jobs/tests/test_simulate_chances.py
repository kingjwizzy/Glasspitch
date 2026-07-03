"""Tests for simulate_chances (W7, migration 0007): the DB-only Monte Carlo
World Cup Chances simulation -- seeded determinism, degenerate certainties
(a team with p=1.0 for every match wins every sim; an already-decided
shootout is a certainty, not a coin flip), probability-mass conservation
across teams, the documented extra-time/penalties draw-resolution convention,
and the kickoff-order bracket-derivation convention for rounds the data
provider hasn't published yet.

Same conventions as the other job tests: injectable in-memory FakeStore
(conftest.py), no network, no DB. `now` is pinned to FakeStore.DEFAULT_NOW.
The hand-built brackets below start at 'Quarter-finals' -- config.
KNOCKOUT_ROUND_ORDER's earlier rounds ('Round of 32'/'Round of 16') simply
have no fixtures, which run_trial must treat as empty rounds, exactly like a
real tournament whose earlier rounds use a different competition format.
"""

import random

import pytest

from jobs import config, elo, util
from jobs.simulate_chances import (
    _match_probs,
    _round_matches,
    _sample_outcome,
    _true_winner,
    run,
    run_trial,
)
from jobs.tests.conftest import FakeStore

NOW = util.parse_iso(FakeStore.DEFAULT_NOW)  # 2026-06-11T12:00:00+00:00
TODAY = "2026-06-11"


class ScriptedRng:
    """A stand-in rng whose .random() returns a fixed script of rolls -- lets
    a test pin the exact documented sampling arithmetic, not a distribution."""

    def __init__(self, rolls):
        self._rolls = list(rolls)

    def random(self):
        return self._rolls.pop(0)


def _bracket_fixture(
    *,
    id,
    round_name,
    home,
    away,
    kickoff,
    status="scheduled",
    final_home=None,
    final_away=None,
    winner_team_id=None,
):
    """One knockout fixture dict in the exact shape
    jobs.db.SupabaseStore.fixtures_for_rounds returns."""
    return {
        "id": id,
        "api_fixture_id": 9000 + id,
        "home_team_id": home,
        "away_team_id": away,
        "kickoff_utc": kickoff,
        "status": status,
        "final_home_goals": final_home,
        "final_away_goals": final_away,
        "winner_team_id": winner_team_id,
        "round": round_name,
    }


def _home_certain_prediction(fixture_id):
    """A stored api-football prediction giving the HOME side p=1.0 -- the
    degenerate certainty the Monte Carlo must respect in every trial."""
    return {
        "id": f"pred-{fixture_id}",
        "fixture_id": fixture_id,
        "source": "api-football",
        "status": "published",
        "prob_home": 1.0,
        "prob_draw": 0.0,
        "prob_away": 0.0,
    }


def _quarter_finals(status="scheduled"):
    """Hand-built 8-team bracket entry round: four real Quarter-finals,
    kickoff-ordered QF1..QF4 so the carry-in survivor order is known."""
    return [
        _bracket_fixture(
            id=401, round_name="Quarter-finals", home=1, away=2,
            kickoff="2026-06-12T10:00:00+00:00", status=status,
        ),
        _bracket_fixture(
            id=402, round_name="Quarter-finals", home=3, away=4,
            kickoff="2026-06-12T13:00:00+00:00", status=status,
        ),
        _bracket_fixture(
            id=403, round_name="Quarter-finals", home=5, away=6,
            kickoff="2026-06-12T16:00:00+00:00", status=status,
        ),
        _bracket_fixture(
            id=404, round_name="Quarter-finals", home=7, away=8,
            kickoff="2026-06-12T19:00:00+00:00", status=status,
        ),
    ]


def _full_deterministic_bracket():
    """The full 8-team bracket, every round published as REAL fixtures, plus
    degenerate home-certain predictions for all seven matches -- team 1 wins
    every match of every trial by construction: QFs -> 1,3,5,7; semis
    (1v3, 5v7) -> 1,5; final (1v5) -> 1."""
    fixtures = _quarter_finals() + [
        _bracket_fixture(
            id=411, round_name="Semi-finals", home=1, away=3,
            kickoff="2026-06-13T15:00:00+00:00",
        ),
        _bracket_fixture(
            id=412, round_name="Semi-finals", home=5, away=7,
            kickoff="2026-06-13T19:00:00+00:00",
        ),
        _bracket_fixture(
            id=421, round_name="Final", home=1, away=5,
            kickoff="2026-06-14T18:00:00+00:00",
        ),
    ]
    predictions = [_home_certain_prediction(f["id"]) for f in fixtures]
    return fixtures, predictions


def _rows_by_team(store):
    return {row["team_id"]: row for row in store.tournament_chances}


# --- run(): no knockout fixtures yet -> clean no-op ---------------------------


def test_no_knockout_fixtures_is_a_noop(make_store):
    store = make_store()
    counts = run(dry_run=False, store=store, sims=10, seed=1, now=NOW)
    assert counts == {
        "knockout_fixtures_seen": 0,
        "teams_alive": 0,
        "sims": 10,
        "chances_candidates": 0,
        "chances_written": 0,
    }
    assert store.tournament_chances == []


# --- degenerate certainty: p=1.0 for every match wins every sim ---------------


def test_team_with_certain_probability_for_every_match_wins_every_sim(make_store):
    fixtures, predictions = _full_deterministic_bracket()
    store = make_store(upcoming=fixtures, predictions=predictions)

    counts = run(dry_run=False, store=store, sims=40, seed=123, now=NOW)

    assert counts == {
        "knockout_fixtures_seen": 7,
        "teams_alive": 8,
        "sims": 40,
        "chances_candidates": 8,
        "chances_written": 8,
    }
    rows = _rows_by_team(store)
    assert set(rows) == {1, 2, 3, 4, 5, 6, 7, 8}
    for row in rows.values():
        assert row["snapshot_date"] == TODAY
        assert row["sims"] == 40

    # Champion in EVERY trial -- a certainty stays a certainty.
    assert rows[1]["p_win_tournament"] == 1.0
    assert all(rows[t]["p_win_tournament"] == 0.0 for t in (2, 3, 4, 5, 6, 7, 8))
    # Final participants every trial: exactly the two published finalists.
    assert rows[1]["p_reach_final"] == 1.0 and rows[5]["p_reach_final"] == 1.0
    assert all(rows[t]["p_reach_final"] == 0.0 for t in (2, 3, 4, 6, 7, 8))
    # Semi participants every trial: exactly the four QF winners.
    assert all(rows[t]["p_reach_semi"] == 1.0 for t in (1, 3, 5, 7))
    assert all(rows[t]["p_reach_semi"] == 0.0 for t in (2, 4, 6, 8))


# --- probability mass is conserved across teams --------------------------------


def test_probabilities_sum_to_one_across_teams_and_are_monotonic(make_store):
    # Only the QFs are published (semis/final synthetic, priced by Elo) --
    # the messier, live-realistic shape.
    store = make_store(upcoming=_quarter_finals())

    run(dry_run=False, store=store, sims=200, seed=7, now=NOW)

    rows = list(store.tournament_chances)
    assert len(rows) == 8
    # Every trial crowns exactly one champion, fields exactly one Final
    # (2 participants) and one Semi-finals round (4 participants).
    assert sum(r["p_win_tournament"] for r in rows) == pytest.approx(1.0)
    assert sum(r["p_reach_final"] for r in rows) == pytest.approx(2.0)
    assert sum(r["p_reach_semi"] for r in rows) == pytest.approx(4.0)
    for row in rows:
        # Winning requires reaching the Final requires reaching the semis.
        assert 0.0 <= row["p_win_tournament"] <= row["p_reach_final"]
        assert row["p_reach_final"] <= row["p_reach_semi"] <= 1.0


# --- seeded determinism ---------------------------------------------------------


def test_same_seed_reproduces_identical_rows_and_ignores_global_random_state(
    make_store,
):
    store_a = make_store(upcoming=_quarter_finals())
    run(dry_run=False, store=store_a, sims=100, seed=42, now=NOW)

    # Perturb the interpreter's GLOBAL random state between runs: the job's
    # local random.Random(seed) must be unaffected.
    random.seed(999)
    random.random()

    store_b = make_store(upcoming=_quarter_finals())
    run(dry_run=False, store=store_b, sims=100, seed=42, now=NOW)

    assert store_a.tournament_chances == store_b.tournament_chances

    store_c = make_store(upcoming=_quarter_finals())
    run(dry_run=False, store=store_c, sims=100, seed=43, now=NOW)
    assert store_c.tournament_chances != store_a.tournament_chances


# --- an already-decided shootout is a certainty, and its loser is eliminated ---


def test_finished_shootout_uses_winner_team_id_and_eliminates_the_loser(make_store):
    # QF1 already played: 1-1 after 90 minutes, decided on penalties --
    # winner_team_id says team 2 advanced (the final score alone would call
    # this an undecidable draw). QF2..QF4 are still scheduled, each with a
    # home-certain stored prediction (3, 5, 7 advance deterministically).
    played = _bracket_fixture(
        id=401, round_name="Quarter-finals", home=1, away=2,
        kickoff="2026-06-10T18:00:00+00:00", status="finished",
        final_home=1, final_away=1, winner_team_id=2,
    )
    scheduled = _quarter_finals()[1:]
    predictions = [_home_certain_prediction(f["id"]) for f in scheduled]
    store = make_store(upcoming=scheduled, finished=[played], predictions=predictions)

    counts = run(dry_run=False, store=store, sims=60, seed=11, now=NOW)

    # Team 1 lost the shootout: eliminated by ground truth, no row at all.
    assert counts["teams_alive"] == 7
    rows = _rows_by_team(store)
    assert set(rows) == {2, 3, 4, 5, 6, 7, 8}

    # The shootout WINNER advances in every trial -- never a 50/50 re-flip --
    # so all four QF survivors (2, 3, 5, 7) contest the semis every time.
    assert all(rows[t]["p_reach_semi"] == 1.0 for t in (2, 3, 5, 7))
    # Deterministic QF losers stay alive (their matches aren't finished) but
    # never progress in any trial.
    assert all(
        rows[t]["p_reach_semi"] == 0.0
        and rows[t]["p_reach_final"] == 0.0
        and rows[t]["p_win_tournament"] == 0.0
        for t in (4, 6, 8)
    )
    assert sum(r["p_win_tournament"] for r in rows.values()) == pytest.approx(1.0)


def test_true_winner_prefers_winner_team_id_then_falls_back_to_score():
    base = {"home_team_id": 1, "away_team_id": 2}
    # winner_team_id wins even when the 90-minute score disagrees (shootout).
    assert _true_winner({**base, "winner_team_id": 2,
                         "final_home_goals": 1, "final_away_goals": 1}) == 2
    # Legacy row (pre-0007 backfill): fall back to comparing the final score.
    assert _true_winner({**base, "winner_team_id": None,
                         "final_home_goals": 2, "final_away_goals": 1}) == 1
    assert _true_winner({**base, "winner_team_id": None,
                         "final_home_goals": 0, "final_away_goals": 3}) == 2
    # Genuinely undetermined: a drawn score with no winner flag, or no score.
    assert _true_winner({**base, "winner_team_id": None,
                         "final_home_goals": 1, "final_away_goals": 1}) is None
    assert _true_winner({**base, "winner_team_id": None,
                         "final_home_goals": None, "final_away_goals": None}) is None


# --- extra-time/penalties convention: the documented weighted coin -------------


def test_sampled_draw_resolves_by_relative_ninety_minute_strength():
    # probs (0.5, 0.3, 0.2): a first roll in [0.5, 0.8) samples 'draw', then
    # the documented convention gives P(home advances) = 0.5/0.7 = 0.714285...
    assert _sample_outcome(0.5, 0.3, 0.2, rng=ScriptedRng([0.60, 0.70])) == "home"
    assert _sample_outcome(0.5, 0.3, 0.2, rng=ScriptedRng([0.60, 0.72])) == "away"
    # Non-draw samples never draw a second roll.
    assert _sample_outcome(0.5, 0.3, 0.2, rng=ScriptedRng([0.40])) == "home"
    assert _sample_outcome(0.5, 0.3, 0.2, rng=ScriptedRng([0.85])) == "away"


def test_sampled_draw_with_zero_strength_on_both_sides_is_a_fair_coin():
    # Degenerate p_draw=1.0: the relative-strength denominator is 0, so the
    # documented fallback is an exact 0.5 coin.
    assert _sample_outcome(0.0, 1.0, 0.0, rng=ScriptedRng([0.2, 0.49])) == "home"
    assert _sample_outcome(0.0, 1.0, 0.0, rng=ScriptedRng([0.2, 0.51])) == "away"


def test_draw_resolution_frequency_matches_the_documented_formula():
    # probs (0.4, 0.4, 0.2): P(home advances) = 0.4 + 0.4 * (0.4/0.6) = 2/3.
    # Fixed seed -- deterministic, not a flaky statistical assertion.
    rng = random.Random(5)
    n = 4000
    home = sum(
        1 for _ in range(n) if _sample_outcome(0.4, 0.4, 0.2, rng=rng) == "home"
    )
    assert home / n == pytest.approx(2 / 3, abs=0.03)


# --- match pricing: stored prediction > Elo; synthetic matches are neutral -----


def test_match_probs_prefers_stored_prediction_then_elo_then_neutral_elo():
    fixture = {"id": 401, "status": "scheduled"}
    stored = {"home": 0.7, "draw": 0.2, "away": 0.1}

    # A known fixture with a stored api-football prediction uses it verbatim.
    assert _match_probs(fixture, 1, 2, ratings={}, pred_probs={401: stored}) == stored

    # A known fixture with no stored prediction prices from Elo, WITH home
    # advantage (equal ratings -> the home side is genuinely favoured).
    priced = _match_probs(fixture, 1, 2, ratings={}, pred_probs={})
    assert priced == elo.match_probabilities(elo.DEFAULT_RATING, elo.DEFAULT_RATING)
    assert priced["home"] > priced["away"]

    # A SYNTHETIC match (no fixture row exists) is neutral: no home advantage,
    # so two equal ratings split the non-draw mass exactly evenly.
    synthetic = _match_probs(None, 1, 2, ratings={}, pred_probs={})
    assert synthetic == elo.match_probabilities(
        elo.DEFAULT_RATING, elo.DEFAULT_RATING, home_advantage=0.0
    )
    assert synthetic["home"] == synthetic["away"]


# --- bracket derivation: real fixtures verbatim, leftovers paired adjacently ---


def test_round_matches_pairs_unpublished_survivors_adjacently_in_carry_order():
    matches = _round_matches("Semi-finals", known=[], carry_in=[1, 3, 5, 7])
    assert matches == [(None, 1, 3), (None, 5, 7)]


def test_round_matches_uses_real_fixture_verbatim_and_pairs_the_leftovers():
    real = _bracket_fixture(
        id=411, round_name="Semi-finals", home=3, away=5,
        kickoff="2026-06-13T15:00:00+00:00",
    )
    # The provider published 3-v-5 (NOT kickoff-adjacent): the real pairing
    # wins verbatim, and only the leftover survivors (1, 7) are synthesized.
    matches = _round_matches("Semi-finals", known=[real], carry_in=[1, 3, 5, 7])
    assert matches == [(real, 3, 5), (None, 1, 7)]


def test_round_matches_drops_the_last_odd_survivor_with_a_warning(caplog):
    with caplog.at_level("WARNING"):
        matches = _round_matches("Semi-finals", known=[], carry_in=[1, 3, 5])
    assert matches == [(None, 1, 3)]
    assert "odd number" in caplog.text


def test_run_trial_advances_the_hand_built_bracket_through_empty_early_rounds():
    fixtures, predictions = _full_deterministic_bracket()
    fixtures_by_round = {}
    for fixture in fixtures:
        fixtures_by_round.setdefault(fixture["round"], []).append(fixture)
    pred_probs = {
        p["fixture_id"]: {"home": p["prob_home"], "draw": p["prob_draw"],
                          "away": p["prob_away"]}
        for p in predictions
    }

    trial = run_trial(
        config.KNOCKOUT_ROUND_ORDER, fixtures_by_round,
        ratings={}, pred_probs=pred_probs, rng=random.Random(0),
    )

    # The two rounds this bracket never had are empty, not an error.
    assert trial["reached"]["Round of 32"] == set()
    assert trial["reached"]["Round of 16"] == set()
    assert trial["reached"]["Quarter-finals"] == {1, 2, 3, 4, 5, 6, 7, 8}
    assert trial["reached"]["Semi-finals"] == {1, 3, 5, 7}
    assert trial["reached"]["Final"] == {1, 5}
    assert trial["champion"] == 1


# --- idempotency + dry-run -------------------------------------------------------


def test_same_day_rerun_overwrites_rows_instead_of_duplicating(make_store):
    store = make_store(upcoming=_quarter_finals())

    run(dry_run=False, store=store, sims=50, seed=1, now=NOW)
    first_rows = [dict(r) for r in store.tournament_chances]
    run(dry_run=False, store=store, sims=50, seed=2, now=NOW)

    # Still exactly one row per (snapshot_date, team_id) -- the re-run
    # overwrote in place with freshly simulated values.
    assert len(store.tournament_chances) == 8
    assert len(store.chances_writes) == 2
    keys = [(r["snapshot_date"], r["team_id"]) for r in store.tournament_chances]
    assert len(set(keys)) == 8
    assert [dict(r) for r in store.tournament_chances] == store.chances_writes[1]
    assert first_rows != store.tournament_chances  # seed 2 genuinely re-simulated


def test_dry_run_simulates_but_never_writes(make_store):
    fixtures, predictions = _full_deterministic_bracket()
    store = make_store(upcoming=fixtures, predictions=predictions)

    counts = run(dry_run=True, store=store, sims=10, seed=3, now=NOW)

    assert counts["chances_candidates"] == 8
    assert counts["chances_written"] == 0
    assert store.tournament_chances == []
    assert store.chances_writes == []


def test_already_decided_tournament_writes_certainty_for_the_champion(make_store):
    decided_final = _bracket_fixture(
        id=421, round_name="Final", home=1, away=5,
        kickoff="2026-06-10T18:00:00+00:00", status="finished",
        final_home=1, final_away=1, winner_team_id=1,
    )
    store = make_store(finished=[decided_final])

    counts = run(dry_run=False, store=store, sims=20, seed=4, now=NOW)

    assert counts["teams_alive"] == 1
    rows = _rows_by_team(store)
    assert set(rows) == {1}
    assert rows[1]["p_win_tournament"] == 1.0
    assert rows[1]["p_reach_final"] == 1.0
