"""Tests for jobs/narrative.py: the free "what's driving this call" narrative
(improvement #6). No network, no DB -- build_free_narrative is a pure,
deterministic template function; these tests exercise it directly with the
same H/D/A + comparison/h2h_summary shapes jobs/fetch_predictions.py and
jobs/backfill_narratives.py actually pass it.
"""

from __future__ import annotations

import re

import pytest

from jobs.narrative import _pct, build_free_narrative

# Vocabulary that must NEVER appear in a narrative (ARCHITECTURE.md §9/§13:
# analysis framing only, never odds/betting-market language, never implies an
# edge over bookmakers).
_FORBIDDEN_WORDS = (
    "bet",
    "odds",
    "bookmaker",
    "bookie",
    "stake",
    "wager",
    "advice",
    "gamble",
    "punt",
)


def _sentences(text: str) -> list[str]:
    """Split a narrative into its sentences (each template sentence ends with
    a single '.', joined by exactly one space -- see the module docstring)."""
    return [s for s in text.split(". ") if s]


def _assert_no_betting_language(text: str) -> None:
    lowered = text.lower()
    for word in _FORBIDDEN_WORDS:
        # Whole-word match ("bet" must not false-positive on "between").
        assert not re.search(rf"\b{word}\b", lowered), (
            f"{word!r} must never appear in a free narrative: {text!r}"
        )


# --- determinism + shape --------------------------------------------------


def test_deterministic_same_inputs_same_output():
    kwargs = dict(
        home_name="Brazil",
        away_name="Spain",
        prob_home=0.55,
        prob_draw=0.26,
        prob_away=0.19,
        comparison={"form": {"home": "60%", "away": "45%"}},
        h2h_summary={"sample_size": 3},
    )
    first = build_free_narrative(**kwargs)
    second = build_free_narrative(**kwargs)
    assert first == second


def test_always_at_least_one_sentence_and_never_more_than_two():
    with_context = build_free_narrative(
        home_name="Brazil",
        away_name="Spain",
        prob_home=0.55,
        prob_draw=0.26,
        prob_away=0.19,
        comparison={"form": {"home": "60%", "away": "45%"}},
    )
    without_context = build_free_narrative(
        home_name="Brazil",
        away_name="Spain",
        prob_home=0.55,
        prob_draw=0.26,
        prob_away=0.19,
    )
    assert 1 <= len(_sentences(with_context)) <= 2
    assert len(_sentences(without_context)) == 1
    assert with_context.endswith(".")
    assert without_context.endswith(".")


def test_never_reads_predictions_advice_field_and_never_uses_betting_language():
    # build_free_narrative's signature has no "advice" parameter at all --
    # there is nothing to filter because it is never given that input (see
    # the module docstring) -- this asserts the OUTPUT side of that contract:
    # whatever combination of inputs is passed, no betting-market vocabulary
    # ever appears in the rendered text.
    scenarios = [
        dict(home_name="Home", away_name="Away", prob_home=0.6, prob_draw=0.25, prob_away=0.15),
        dict(
            home_name="Home",
            away_name="Away",
            prob_home=0.34,
            prob_draw=0.33,
            prob_away=0.33,
            comparison={"form": {"home": "50%", "away": "50%"}},
        ),
        dict(
            home_name="Home",
            away_name="Away",
            prob_home=0.2,
            prob_draw=0.3,
            prob_away=0.5,
            h2h_summary={"sample_size": 5},
        ),
    ]
    for kwargs in scenarios:
        _assert_no_betting_language(build_free_narrative(**kwargs))


# --- the top-line H/D/A ("favourite") sentence -----------------------------


def test_favours_the_home_side_when_home_is_the_clear_leader():
    text = build_free_narrative(
        home_name="Spain",
        away_name="Costa Rica",
        prob_home=0.62,
        prob_draw=0.23,
        prob_away=0.15,
    )
    assert text == (
        "The model favours Spain (62%) over Costa Rica (15%), with a 23% chance of a draw."
    )


def test_favours_the_away_side_when_away_is_the_clear_leader():
    text = build_free_narrative(
        home_name="Costa Rica",
        away_name="Spain",
        prob_home=0.15,
        prob_draw=0.23,
        prob_away=0.62,
    )
    assert text == (
        "The model favours Spain (62%) over Costa Rica (15%), with a 23% chance of a draw."
    )


def test_reads_as_an_even_contest_when_the_home_away_gap_is_small():
    # home=42%, away=40% (gap 2 <= 8), draw=18% < max(42, 40) -- "even
    # contest" framing rather than naming a confident favourite.
    text = build_free_narrative(
        home_name="Brazil",
        away_name="Argentina",
        prob_home=0.42,
        prob_draw=0.18,
        prob_away=0.40,
    )
    assert text == (
        "The model rates this an even contest: Brazil 42% vs Argentina 40% (draw 18%)."
    )


def test_a_small_home_away_gap_with_the_draw_as_largest_share_still_names_a_favourite():
    # gap is small (2 <= 8) but the draw (40%) is the LARGEST share, so the
    # "even contest" branch's second condition (draw_pct < max(home, away))
    # is false -- falls through to the plain favourite sentence instead.
    text = build_free_narrative(
        home_name="Home",
        away_name="Away",
        prob_home=0.31,
        prob_draw=0.40,
        prob_away=0.29,
    )
    assert text.startswith("The model favours Home (31%) over Away (29%)")


# --- the optional second ("context") sentence ------------------------------


def test_form_comparison_leaning_toward_the_home_side():
    text = build_free_narrative(
        home_name="Brazil",
        away_name="Switzerland",
        prob_home=0.55,
        prob_draw=0.26,
        prob_away=0.19,
        comparison={"form": {"home": "60%", "away": "45%"}},
    )
    sentences = _sentences(text)
    assert len(sentences) == 2
    assert sentences[1] == (
        "Recent form leans toward Brazil on the model's form comparison (60% vs 45%)."
    )


def test_form_comparison_leaning_toward_the_away_side():
    text = build_free_narrative(
        home_name="Brazil",
        away_name="Switzerland",
        prob_home=0.55,
        prob_draw=0.26,
        prob_away=0.19,
        comparison={"form": {"home": "40%", "away": "58%"}},
    )
    assert _sentences(text)[1] == (
        "Recent form leans toward Switzerland on the model's form comparison (40% vs 58%)."
    )


def test_form_comparison_closely_matched_within_the_gap_threshold():
    # gap of 5 points is below the 10-point "closely matched" threshold.
    text = build_free_narrative(
        home_name="Home",
        away_name="Away",
        prob_home=0.4,
        prob_draw=0.3,
        prob_away=0.3,
        comparison={"form": {"home": "50%", "away": "45%"}},
    )
    assert _sentences(text)[1] == (
        "Recent form is closely matched between the two sides (50% vs 45%)."
    )


def test_falls_back_to_h2h_sample_size_when_no_form_comparison_is_available():
    text = build_free_narrative(
        home_name="Home",
        away_name="Away",
        prob_home=0.4,
        prob_draw=0.3,
        prob_away=0.3,
        comparison=None,
        h2h_summary={"sample_size": 4},
    )
    assert _sentences(text)[1] == (
        "The two sides have met 4 time(s) recently in the data on record."
    )


def test_form_comparison_is_preferred_over_h2h_when_both_are_present():
    text = build_free_narrative(
        home_name="Home",
        away_name="Away",
        prob_home=0.4,
        prob_draw=0.3,
        prob_away=0.3,
        comparison={"form": {"home": "70%", "away": "40%"}},
        h2h_summary={"sample_size": 9},
    )
    assert "form comparison" in _sentences(text)[1]
    assert "time(s)" not in text


@pytest.mark.parametrize(
    "comparison,h2h_summary",
    [
        (None, None),
        ({}, None),
        ({"form": {}}, None),
        ({"form": {"home": None, "away": "50%"}}, None),
        ({"form": {"home": "garbage", "away": "50%"}}, {"sample_size": 0}),
        (None, {}),
    ],
)
def test_degrades_to_a_single_sentence_when_no_usable_context_signal_exists(
    comparison, h2h_summary
):
    text = build_free_narrative(
        home_name="Home",
        away_name="Away",
        prob_home=0.4,
        prob_draw=0.3,
        prob_away=0.3,
        comparison=comparison,
        h2h_summary=h2h_summary,
    )
    assert len(_sentences(text)) == 1


# --- _pct: tolerant percentage parsing --------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("68.72%", 69),
        ("45%", 45),
        (45, 45),
        (0.45, 45),
        ("0.45", 45),
        (100, 100),
        (None, None),
        ("garbage", None),
        ("", None),
    ],
)
def test_pct_parses_the_shapes_api_footballs_comparison_block_actually_uses(raw, expected):
    assert _pct(raw) == expected
