"""Daily job: fetch upcoming/finished fixtures and upsert them (ARCHITECTURE.md §8).

STUB — the API-Football call and row mapping are left for the next session.

Intended behaviour:
  * For each league in ``config.TRACKED_LEAGUE_IDS``, GET
    ``{API_FOOTBALL_BASE_URL}/fixtures?league={id}&season={SEASON}``.
  * Map each fixture onto the ``fixtures`` table and UPSERT keyed on
    ``api_fixture_id`` so re-running is safe (idempotent writes — §5, §8).
  * One sweep per tracked league per day keeps us under the 100 req/day budget.
"""

from __future__ import annotations

from config import SEASON, TRACKED_LEAGUE_IDS  # noqa: F401  (used once implemented)
from db import get_client  # noqa: F401  (used once implemented)


def run() -> None:
    # TODO(ARCHITECTURE.md §8): implement the API-Football /fixtures fetch and the
    # idempotent upsert keyed on api_fixture_id, using get_client() to write.
    raise NotImplementedError(
        "fetch_fixtures: implement API-Football /fixtures upsert (§8). Next session."
    )


if __name__ == "__main__":
    run()
