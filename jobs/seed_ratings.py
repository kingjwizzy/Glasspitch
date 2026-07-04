"""Static, hand-maintained pre-tournament Elo priors for the in-house Elo
baseline (jobs/elo.py) — fixes a diagnosed World Cup Chances bug
(jobs/simulate_chances.py, ARCHITECTURE.md v3).

## Root cause this exists to fix

``elo.ratings_from_results`` cold-starts EVERY team at the same
``elo.DEFAULT_RATING`` (1500) and replays only FINISHED fixtures. By the
Round-of-32/16 stage of a World Cup, every team has played just 3 group
matches — nowhere near enough signal for the replay alone to tell an elite
side (Argentina, Spain, France, England, Brazil, ...) apart from a mid-table
host or debutant. Combined with a fixed ``HOME_ADVANTAGE`` bonus, this let the
host nation's Elo-derived "chances" outrank objectively stronger teams
(confirmed live 2026-07-04: host Mexico #2, England #12 in
``tournament_chances``). Seeding each team with a real-world pre-tournament
strength estimate — instead of a shared, information-free default — is the
fix: the replay of ACTUAL results still adjusts these seeds over the course of
the tournament, but no longer starts from a blank slate that makes 1-2 games
of noise decisive.

## What this is (and isn't)

* A STATIC, in-repo table. NOT fetched from any API — this module makes no
  network call, consistent with jobs/simulate_chances.py staying DB-only.
* Keyed by API-Football's own ``api_team_id`` — a stable identifier that does
  not change across seasons/competitions (unlike an internal ``teams.id``,
  which is assigned by this app's own upsert, or a raw team NAME, which is
  prone to spelling/normalisation drift between competitions/providers).
  ``jobs/db.py``'s ``finished_fixtures_for_replay`` embeds each side's
  ``api_team_id`` via the same disambiguated-FK join
  ``fixtures_needing_stats`` already uses, so no extra query is needed to use
  this table.
* Approximate. Values are hand-derived from public pre-tournament strength
  indicators (World Football Elo ratings / FIFA world rankings, refined
  manually) as of 2026-07 — a reasonable prior, not a claim of precision. The
  RELATIVE gaps between tiers (elite ~2000-2085, hosts/mid ~1780-1810,
  everyone else ~1750) matter far more than any single absolute number, since
  what actually drives the simulation is the difference between two ratings.
* Scoped to teams currently in a TRACKED competition (FIFA World Cup 2026,
  ``config.TRACKED_LEAGUE_IDS``/``config.SEASON``) — i.e. every ``api_team_id``
  below was cross-checked directly against this project's own ``teams`` table
  (``select id, api_team_id, name from teams`` — WC-2026's 48 entrants), so
  there is no risk of misassigning a rating to the wrong ``api_team_id``.
  A few teams named in the owner's original approximate list — Italy, Denmark,
  Nigeria — did NOT qualify for WC 2026 and so have no confirmed
  ``api_team_id`` in this table; they are deliberately OMITTED rather than
  guessed. Add them (verified against the ``teams`` table, or API-Football's
  own ``/teams`` reference endpoint) if a future tracked competition includes
  them.
* Only ever used to seed the in-house Elo (``model_version='elo-v1'``,
  never the publicly displayed prediction, ARCHITECTURE.md §9) and, via that
  Elo, ``jobs/simulate_chances.py``'s Monte Carlo pricing. It has no effect on
  the ledger, on ``fetch_predictions.py``'s stored third-party prediction, or
  on anything user-facing beyond the "World Cup Chances" simulation output.
"""

from __future__ import annotations

from typing import Optional

from jobs import elo

# "Average World Cup finals qualifier" prior for any TRACKED team not given an
# explicit rating below. Deliberately HIGHER than elo.DEFAULT_RATING (1500):
# a team that qualified for a 48-team World Cup finals is not "unknown", it is
# a genuine top-~50 national side — 1500 would understate it. This constant is
# intentionally distinct from ``elo.DEFAULT_RATING``, which remains the true
# "we have no idea who this is" cold start used when ``api_team_id`` itself is
# missing (see ``seed_rating_for_api_team_id`` below).
DEFAULT_SEED_RATING: float = 1750.0

# api_team_id -> pre-tournament Elo prior. api_team_id values confirmed live
# against this project's own `teams` table for the WC-2026 season (see module
# docstring). Comments give the team name purely for human readability; the
# INTEGER KEY is what's authoritative.
SEED_ELO_BY_API_TEAM_ID: dict[int, float] = {
    26: 2085.0,    # Argentina
    9: 2075.0,     # Spain
    2: 2060.0,     # France
    6: 2030.0,     # Brazil
    10: 2010.0,    # England
    1118: 2005.0,  # Netherlands
    27: 2000.0,    # Portugal
    25: 1965.0,    # Germany
    1: 1955.0,     # Belgium
    3: 1950.0,     # Croatia
    7: 1930.0,     # Uruguay
    8: 1900.0,     # Colombia
    1090: 1880.0,  # Norway
    31: 1870.0,    # Morocco
    15: 1860.0,    # Switzerland
    775: 1850.0,   # Austria
    12: 1850.0,    # Japan
    13: 1830.0,    # Senegal
    2382: 1825.0,  # Ecuador
    5: 1815.0,     # Sweden
    16: 1810.0,    # Mexico (host — a real prior, not an unearned home boost)
    2384: 1805.0,  # USA
    17: 1790.0,    # South Korea
    32: 1780.0,    # Egypt
    5529: 1780.0,  # Canada
    2380: 1770.0,  # Paraguay
    20: 1750.0,    # Australia
}


def seed_rating_for_api_team_id(api_team_id: Optional[int]) -> float:
    """Pre-tournament Elo prior for one team, keyed by its API-Football
    ``api_team_id``.

    * ``api_team_id`` in :data:`SEED_ELO_BY_API_TEAM_ID` -> that hand-rated
      value.
    * A real, known ``api_team_id`` NOT in the table -> :data:`DEFAULT_SEED_RATING`
      (a tracked World Cup entrant we simply haven't hand-rated yet — still a
      real qualifier, not a blank slate).
    * ``api_team_id is None`` (unknown/missing — e.g. a team row with no
      embedded ``api_team_id``, which should not happen for a real fixture but
      is handled defensively) -> :data:`jobs.elo.DEFAULT_RATING`, the
      genuine "we don't know who this is" cold start, unchanged from before
      this module existed.
    """
    if api_team_id is None:
        return elo.DEFAULT_RATING
    return SEED_ELO_BY_API_TEAM_ID.get(api_team_id, DEFAULT_SEED_RATING)
