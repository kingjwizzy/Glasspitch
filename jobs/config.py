"""Configuration for the Glass Pitch scheduled jobs (ARCHITECTURE.md §8).

Tracked leagues and the season are PLACEHOLDERS — set them for the launch window
(World Cup knockouts first, then club football). API-Football numeric league IDs
go here. Secrets are NEVER hardcoded: the API key is read from the environment.
"""

from __future__ import annotations

import os

# --- API-Football -----------------------------------------------------------
API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io"


def api_football_key() -> str:
    """Read the API-Football key from the environment (never hardcoded)."""
    key = os.environ.get("API_FOOTBALL_KEY")
    if not key:
        raise RuntimeError("API_FOOTBALL_KEY is not set (see jobs/.env.example).")
    return key


# --- Tracked competitions (PLACEHOLDERS — set before the first run) ----------
# API-Football numeric league IDs. Empty by default so nothing runs by accident.
# TODO: e.g. World Cup, Premier League (39), Champions League (2).
TRACKED_LEAGUE_IDS: list[int] = []

# Season the tracked leagues belong to (API-Football uses the start year).
# TODO: confirm per competition before launch.
SEASON: int = 2026

# Number of recent matches to summarise for "form" on team/match pages (§4).
FORM_MATCH_COUNT: int = 5

# --- Model identifiers written into the predictions ledger (§7, §9) ----------
THIRD_PARTY_MODEL_VERSION = "api-football-v1"
THIRD_PARTY_SOURCE = "api-football"
ELO_MODEL_VERSION = "elo-v1"
ELO_SOURCE = "inhouse-elo"
