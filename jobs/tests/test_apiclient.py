"""Tests for the API-Football client: auth, retry/backoff, counting, budget."""

import pytest
import requests

from jobs.apiclient import ApiFootballClient, ApiFootballError, RequestBudgetExceeded


class FakeResponse:
    def __init__(self, status_code=200, json_data=None, text=""):
        self.status_code = status_code
        self._json = json_data if json_data is not None else {"response": [], "errors": []}
        self.text = text

    def json(self):
        return self._json


class FakeSession:
    """Returns/raises queued outcomes in order for each .get() call."""

    def __init__(self, outcomes):
        self._outcomes = list(outcomes)
        self.calls = []

    def get(self, url, headers=None, params=None, timeout=None):
        self.calls.append({"url": url, "headers": headers, "params": params, "timeout": timeout})
        outcome = self._outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def _client(session, **kwargs):
    return ApiFootballClient(
        api_key="test-key", session=session, sleep=lambda *_: None, **kwargs
    )


def test_get_success_and_request_count():
    session = FakeSession([FakeResponse(200, {"response": [{"x": 1}], "errors": []})])
    client = _client(session)
    payload = client.get("/fixtures", {"league": 1})
    assert payload["response"] == [{"x": 1}]
    assert client.request_count == 1
    assert session.calls[0]["params"] == {"league": 1}


def test_auth_header_is_sent():
    session = FakeSession([FakeResponse(200)])
    client = _client(session)
    client.get("/x")
    assert session.calls[0]["headers"]["x-apisports-key"] == "test-key"


def test_retry_on_transient_then_success():
    session = FakeSession([FakeResponse(503), FakeResponse(200, {"response": [1], "errors": []})])
    client = _client(session)
    payload = client.get("/x")
    assert payload["response"] == [1]
    assert client.request_count == 2  # one retry


def test_retry_exhausted_raises():
    session = FakeSession([FakeResponse(503), FakeResponse(503), FakeResponse(503)])
    client = _client(session)
    with pytest.raises(ApiFootballError):
        client.get("/x", max_retries=3)
    assert client.request_count == 3


def test_network_error_is_retried():
    session = FakeSession(
        [requests.ConnectionError("boom"), FakeResponse(200, {"response": [], "errors": []})]
    )
    client = _client(session)
    client.get("/x")
    assert client.request_count == 2


def test_budget_guard_blocks_excess_requests():
    session = FakeSession([FakeResponse(200), FakeResponse(200)])
    client = _client(session, max_requests=1)
    client.get("/a")
    with pytest.raises(RequestBudgetExceeded):
        client.get("/b")


def test_api_errors_field_raises():
    session = FakeSession([FakeResponse(200, {"response": [], "errors": {"token": "invalid"}})])
    client = _client(session)
    with pytest.raises(ApiFootballError):
        client.get("/x")


def test_non_200_non_transient_raises():
    session = FakeSession([FakeResponse(404, {"response": []}, text="not found")])
    client = _client(session)
    with pytest.raises(ApiFootballError):
        client.get("/x")


def test_extra_headers_are_merged():
    # The RapidAPI host header (config.API_FOOTBALL_EXTRA_HEADERS) is merged on
    # top of the auth header — the documented one-line distribution switch.
    session = FakeSession([FakeResponse(200)])
    client = _client(session, extra_headers={"x-rapidapi-host": "host.example"})
    client.get("/x")
    headers = session.calls[0]["headers"]
    assert headers["x-apisports-key"] == "test-key"
    assert headers["x-rapidapi-host"] == "host.example"
