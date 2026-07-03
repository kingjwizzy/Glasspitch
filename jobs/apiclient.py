"""API-Football HTTP client (ARCHITECTURE.md §8).

The jobs are the ONLY callers of the football API (§5 golden rule). This client
centralises auth, timeouts, retry-with-backoff on transient errors, and a
per-run request counter / budget guard so the pipeline stays under the free-tier
100 requests/day.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, Mapping, Optional

import requests

from jobs import config

log = logging.getLogger(__name__)

# HTTP statuses worth retrying with backoff.
_TRANSIENT_STATUS = frozenset({429, 500, 502, 503, 504})


class ApiFootballError(RuntimeError):
    """Raised for non-recoverable API-Football errors."""


class RequestBudgetExceeded(ApiFootballError):
    """Raised when a run would exceed its per-run request budget (rate guard)."""


class ApiFootballClient:
    """Minimal API-Football client. All knobs are injectable for testing."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: Optional[str] = None,
        auth_header: Optional[str] = None,
        extra_headers: Optional[Mapping[str, str]] = None,
        timeout: Optional[float] = None,
        max_requests: Optional[int] = None,
        session: Optional[Any] = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._api_key = api_key if api_key is not None else config.api_football_key()
        self._base_url = (base_url or config.API_FOOTBALL_BASE_URL).rstrip("/")
        self._auth_header = auth_header or config.API_FOOTBALL_AUTH_HEADER
        self._extra_headers = dict(
            extra_headers if extra_headers is not None else config.API_FOOTBALL_EXTRA_HEADERS
        )
        self._timeout = timeout if timeout is not None else config.API_REQUEST_TIMEOUT_SECONDS
        self._max_requests = (
            max_requests if max_requests is not None else config.MAX_REQUESTS_PER_RUN
        )
        self._session = session if session is not None else requests.Session()
        self._sleep = sleep
        self._request_count = 0

    @property
    def request_count(self) -> int:
        """Number of HTTP requests made this run (counts retries)."""
        return self._request_count

    def _headers(self) -> dict[str, str]:
        headers = {self._auth_header: self._api_key, "Accept": "application/json"}
        headers.update(self._extra_headers)
        return headers

    def get(
        self,
        path: str,
        params: Optional[Mapping[str, Any]] = None,
        *,
        max_retries: int = 3,
        backoff_base: float = 1.0,
    ) -> dict[str, Any]:
        """GET ``path`` and return the parsed JSON payload.

        Retries transient errors with exponential backoff. Each network attempt
        counts against the per-run request budget.
        """
        url = f"{self._base_url}{path}"
        for attempt in range(1, max_retries + 1):
            if self._request_count >= self._max_requests:
                raise RequestBudgetExceeded(
                    f"Per-run request budget of {self._max_requests} reached; "
                    f"refusing to call {path} (ARCHITECTURE.md §8)."
                )
            self._request_count += 1
            try:
                resp = self._session.get(
                    url, headers=self._headers(), params=params, timeout=self._timeout
                )
            except requests.RequestException as exc:
                if attempt >= max_retries:
                    raise ApiFootballError(
                        f"GET {path} failed after {attempt} attempt(s): {exc}"
                    ) from exc
                log.warning(
                    "Network error on %s (attempt %d/%d): %s",
                    path, attempt, max_retries, exc,
                )
                self._sleep(backoff_base * (2 ** (attempt - 1)))
                continue

            if resp.status_code in _TRANSIENT_STATUS:
                if attempt >= max_retries:
                    raise ApiFootballError(
                        f"GET {path} returned HTTP {resp.status_code} after "
                        f"{attempt} attempt(s)."
                    )
                log.warning(
                    "Transient HTTP %s on %s (attempt %d/%d); backing off",
                    resp.status_code, path, attempt, max_retries,
                )
                self._sleep(backoff_base * (2 ** (attempt - 1)))
                continue

            if resp.status_code != 200:
                raise ApiFootballError(
                    f"GET {path} returned HTTP {resp.status_code}: {resp.text[:200]}"
                )

            payload = resp.json()
            self._raise_for_api_errors(payload, path)
            return payload

        # Unreachable: the loop either returns or raises.
        raise ApiFootballError(f"GET {path} exhausted retries.")

    @staticmethod
    def _raise_for_api_errors(payload: Any, path: str) -> None:
        # API-Football uses an empty list/dict for "errors" when the call is OK.
        errors = payload.get("errors") if isinstance(payload, dict) else None
        if errors:
            raise ApiFootballError(f"API-Football returned errors for {path}: {errors}")

    # --- typed endpoint helpers ---
    def get_fixtures(self, league: int, season: int, *, page: int = 1) -> dict[str, Any]:
        """GET /fixtures for one league/season/page.

        API-Football pages large responses (``payload['paging']``); callers
        must loop while ``paging.current < paging.total``, incrementing
        ``page`` (jobs/fetch_fixtures.py). Each page is a separate request and
        counts against the per-run budget like any other call.

        The first page is requested WITHOUT a ``page`` param: /fixtures
        rejects an explicit ``page`` field outright ("The Page field do not
        exist" — verified live 2026-07-03, WC 2026 cutover) even though its
        responses carry a ``paging`` block. Only follow-up pages (which no
        /fixtures response has produced in practice — paging is always 1/1)
        send it, so a hypothetical multi-page response still gets attempted
        rather than silently truncated, and the per-league error isolation in
        fetch_fixtures contains the fallout if the API rejects that too.
        """
        params: dict[str, Any] = {"league": league, "season": season}
        if page > 1:
            params["page"] = page
        return self.get("/fixtures", params)

    def get_predictions(self, fixture: int) -> dict[str, Any]:
        return self.get("/predictions", {"fixture": fixture})

    def get_fixture_statistics(self, fixture: int) -> dict[str, Any]:
        """GET /fixtures/statistics for one fixture (jobs/fetch_insights.py,
        ARCHITECTURE.md v2 §4/§7/§8) -- per-team shot/possession/card/xG
        counters, fetched exactly once per fixture like /predictions."""
        return self.get("/fixtures/statistics", {"fixture": fixture})

    def get_topscorers(self, league: int, season: int) -> dict[str, Any]:
        """GET /players/topscorers for one league/season (jobs/fetch_topscorers.py)
        -- one request per tracked league per run; the response is already
        ordered by goals desc (rank = list order)."""
        return self.get("/players/topscorers", {"league": league, "season": season})
