"""Free "what's driving this call" narrative (ARCHITECTURE.md improvement #6).

A short (<=2 sentence), deterministic, plain-language summary of the model's
call -- built ONLY from data this project already fetches/stores: the H/D/A
probabilities plus the SAME curated ``comparison``/``h2h_summary`` signals
stored in ``fixture_insights(kind='prediction_detail')`` (ARCHITECTURE.md v2
§4/§7, jobs/fetch_predictions.py's ``build_prediction_detail_payload``). Never
a second API call, never invented text: every sentence is a template filled
from a numeric/textual signal already on hand, so the same inputs always
produce the same output (deterministic, unit-testable -- no LLM / free-text
generation).

Tone rules (ARCHITECTURE.md §9/§13 -- the same guardrails as the rest of the
product): analysis framing only, never a guarantee, never odds/betting-market
language, never implies an edge over bookmakers. This module never reads
``predictions.advice`` (or any other excluded betting-market field -- see
jobs/fetch_predictions.py's curation comment for the full list) -- there is
nothing to filter out here because it is never given that input in the first
place.

Used by:
  - jobs/fetch_predictions.py -- going forward, for every NEWLY-inserted
    api-football prediction, from the SAME /predictions response (never a
    second fetch).
  - jobs/backfill_narratives.py -- the one-off catch-up for existing rows,
    purely from already-stored data (fixtures/teams + fixture_insights),
    zero API calls.
"""

from __future__ import annotations

from typing import Optional

# A form-comparison gap (percentage points) below this is treated as "closely
# matched" rather than favouring either side -- avoids a misleadingly
# confident-sounding sentence over a near-coin-flip signal.
_FORM_GAP_THRESHOLD = 10
# Likewise for the top-line H/D/A read: a home/away split within this many
# points (with the draw not the largest share) reads as "an even contest"
# rather than naming a favourite.
_FAVOURITE_GAP_THRESHOLD = 8


def _pct(value: object) -> Optional[int]:
    """Parse a percentage-ish value ('68.72%', 45, 0.45) to a rounded
    whole-number percentage, or None if it can't be parsed.

    Tolerant of the exact string shapes API-Football's ``comparison`` block
    uses (e.g. ``'68.72%'``) without depending on
    jobs/fetch_predictions.py's stricter ``parse_percent`` (which raises on
    anything unparsable) -- this helper is best-effort: a malformed/missing
    comparison field must degrade the narrative, never break it.
    """
    if value is None:
        return None
    try:
        text = str(value).strip()
        if text.endswith("%"):
            return round(float(text[:-1]))
        num = float(text)
        # A bare fraction (0..1) vs a bare whole percentage (e.g. '68') --
        # comparison values are always percentage-STRINGS in practice, but
        # tolerate a bare number defensively.
        return round(num * 100) if 0.0 <= num <= 1.0 else round(num)
    except (TypeError, ValueError):
        return None


def _favourite_sentence(
    home_name: str,
    away_name: str,
    prob_home: float,
    prob_draw: float,
    prob_away: float,
) -> str:
    home_pct = round(prob_home * 100)
    draw_pct = round(prob_draw * 100)
    away_pct = round(prob_away * 100)

    if abs(home_pct - away_pct) <= _FAVOURITE_GAP_THRESHOLD and draw_pct < max(
        home_pct, away_pct
    ):
        return (
            f"The model rates this an even contest: {home_name} {home_pct}% vs "
            f"{away_name} {away_pct}% (draw {draw_pct}%)."
        )

    if home_pct >= away_pct:
        leader, leader_pct, other, other_pct = home_name, home_pct, away_name, away_pct
    else:
        leader, leader_pct, other, other_pct = away_name, away_pct, home_name, home_pct
    return (
        f"The model favours {leader} ({leader_pct}%) over {other} ({other_pct}%), "
        f"with a {draw_pct}% chance of a draw."
    )


def _context_sentence(
    home_name: str,
    away_name: str,
    comparison: Optional[dict],
    h2h_summary: Optional[dict],
) -> Optional[str]:
    """One extra sentence of context, preferring the form comparison (most
    directly explains "why") and falling back to a head-to-head sample-size
    note. Returns None if neither signal is available (an empty/absent
    fixture_insights payload -- older fixtures often lack one).
    """
    form = (comparison or {}).get("form") or {}
    form_home = _pct(form.get("home"))
    form_away = _pct(form.get("away"))
    if form_home is not None and form_away is not None:
        if abs(form_home - form_away) >= _FORM_GAP_THRESHOLD:
            stronger = home_name if form_home > form_away else away_name
            return (
                f"Recent form leans toward {stronger} on the model's form "
                f"comparison ({form_home}% vs {form_away}%)."
            )
        return (
            "Recent form is closely matched between the two sides "
            f"({form_home}% vs {form_away}%)."
        )

    sample_size = (h2h_summary or {}).get("sample_size")
    if sample_size:
        return (
            f"The two sides have met {sample_size} time(s) recently in the "
            "data on record."
        )
    return None


def build_free_narrative(
    *,
    home_name: str,
    away_name: str,
    prob_home: float,
    prob_draw: float,
    prob_away: float,
    comparison: Optional[dict] = None,
    h2h_summary: Optional[dict] = None,
) -> str:
    """Build the <=2-sentence free narrative.

    Always returns at least one sentence (the favourite/probability read,
    which needs no optional context); adds a second sentence only when a
    form or head-to-head signal is actually available. Analysis framing
    only -- see the module docstring.
    """
    sentences = [
        _favourite_sentence(home_name, away_name, prob_home, prob_draw, prob_away)
    ]
    context = _context_sentence(home_name, away_name, comparison, h2h_summary)
    if context:
        sentences.append(context)
    return " ".join(sentences)
