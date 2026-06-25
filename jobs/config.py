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
# API-Football numeric league IDs. League 1 = FIFA World Cup.
TRACKED_LEAGUE_IDS: list[int] = [1]

# API-Football uses the start year for the season. FIFA World Cup 2026.
SEASON: int = 2026

# Number of recent matches to summarise for "form" on team/match pages (§4).
FORM_MATCH_COUNT: int = 5

# --- Model identifiers written into the predictions ledger (§7, §9) ----------
THIRD_PARTY_MODEL_VERSION = "api-football-v1"
THIRD_PARTY_SOURCE = "api-football"
ELO_MODEL_VERSION = "elo-v1"
ELO_SOURCE = "inhouse-elo"
