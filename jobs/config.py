"""Configuration for the Glass Pitch scheduled jobs (ARCHITECTURE.md §8).

The football data source is API-Football (API-Sports, direct). To switch to the
RapidAPI distribution later, change ``API_FOOTBALL_BASE_URL`` and
``API_FOOTBALL_AUTH_HEADER`` here (and add the RapidAPI host via
``API_FOOTBALL_EXTRA_HEADERS``) — a one-line change in config, nothing in the
jobs. Secrets are NEVER hardcoded: the API key is read from the environment
(jobs/.env).
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Load the .env sitting next to this file (jobs/.env) by EXPLICIT path, so the
# env-overridable settings below are honored no matter how a job is invoked
# (python -m, -c, pytest). A bare load_dotenv() resolves the file differently under
# -c (cwd) vs -m (caller dir); the explicit path is deterministic. ``config`` is
# imported before ``db.py`` (which also calls load_dotenv — idempotent). The .env
# file is never committed (§12).
load_dotenv(Path(__file__).with_name(".env"))

# --- Football data source: API-Football (API-Sports, direct) ----------------
API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io"

# API-Sports direct authenticates with this header. To use the RapidAPI
# distribution instead, set:
#   API_FOOTBALL_BASE_URL   = "https://api-football-v1.p.rapidapi.com/v3"
#   API_FOOTBALL_AUTH_HEADER = "x-rapidapi-key"
#   API_FOOTBALL_EXTRA_HEADERS = {"x-rapidapi-host": "api-football-v1.p.rapidapi.com"}
API_FOOTBALL_AUTH_HEADER = "x-apisports-key"
API_FOOTBALL_EXTRA_HEADERS: dict[str, str] = {}

# Per-request network timeout (seconds).
API_REQUEST_TIMEOUT_SECONDS = 20

# Staying under the free tier's 100 requests/day is a property of the DESIGN
# (each prediction is fetched exactly once and cached; one fixtures sweep per
# league — §8), not of this guard. This is a PER-RUN ceiling: a single job run
# refuses to exceed it (jobs are separate processes, so it is NOT a rolling 24h
# counter and does NOT account across runs). It stops one run from blowing the
# budget; the daily total is kept low by the fetch-once design.
MAX_REQUESTS_PER_RUN = 100


def api_football_key() -> str:
    """Read the API-Football key from the environment (never hardcoded)."""
    key = os.environ.get("API_FOOTBALL_KEY")
    if not key:
        raise RuntimeError("API_FOOTBALL_KEY is not set (see jobs/.env.example).")
    return key


# --- Tracked competitions ----------------------------------------------------
# API-Football numeric league IDs. League 1 = FIFA World Cup. The LIVE default is
# league 1; WC_LEAGUE_ID overrides it (e.g. for a dev seed). See docs/SEEDING.md.
TRACKED_LEAGUE_IDS: list[int] = [int(os.environ.get("WC_LEAGUE_ID") or "1")]

# The live production season — the SINGLE SOURCE OF TRUTH for "which season is the
# real tournament". It is the committed default for SEASON below, and the dev tools
# (seed_predictions_dev, reset_season) key their safety interlocks on it so a stray
# run can't touch the live ledger. FIFA World Cup 2026. (docs/SEEDING.md)
LIVE_SEASON: int = 2026

# API-Football uses the start year for the season. LIVE default = LIVE_SEASON (FIFA
# World Cup 2026); WC_SEASON overrides it (e.g. WC_SEASON=2022 for the Qatar dev seed).
SEASON: int = int(os.environ.get("WC_SEASON") or str(LIVE_SEASON))

# Number of recent matches to summarise for "form" on team/match pages (§4).
FORM_MATCH_COUNT: int = 5

# --- Model identifiers written into the predictions ledger (§7, §9) ----------
THIRD_PARTY_MODEL_VERSION = "api-football-v1"
THIRD_PARTY_SOURCE = "api-football"
ELO_MODEL_VERSION = "elo-v1"
ELO_SOURCE = "inhouse-elo"

# --- Scale / robustness knobs (v2 hardening) ----------------------------------
# fetch_predictions only fetches a third-party prediction for fixtures kicking
# off within this window. Without a bound, a full club season ingested by
# fetch_fixtures (hundreds of scheduled fixtures) would attempt one /predictions
# call per fixture on the very next run, blowing the request budget and storing
# months-stale predictions long before they're useful. Env-overridable for
# tuning/tests.
PREDICTION_FETCH_WINDOW_HOURS: float = float(
    os.environ.get("PREDICTION_FETCH_WINDOW_HOURS") or "72"
)

# A fixture that stays 'postponed' this long past its original kickoff, with no
# reschedule, is treated as definitively not-played: any published/locked
# predictions for it are closed out (status='void_cancelled') rather than left
# in permanent limbo (jobs/fetch_fixtures.py). Cancelled/abandoned fixtures
# (API status CANC/ABD) are closed out immediately regardless of this horizon.
POSTPONED_VOID_HORIZON_DAYS: int = int(
    os.environ.get("POSTPONED_VOID_HORIZON_DAYS") or "45"
)
