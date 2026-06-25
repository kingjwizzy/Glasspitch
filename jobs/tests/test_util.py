"""Tests for the shared helpers."""

from datetime import datetime, timezone

from jobs.util import now_utc, parse_iso, slugify, to_utc_iso


def test_slugify_basic():
    assert slugify("FIFA World Cup") == "fifa-world-cup"
    assert slugify("Brazil") == "brazil"


def test_slugify_strips_accents_and_punctuation():
    assert slugify("Côte d'Ivoire") == "cote-d-ivoire"
    assert slugify("  Korea Republic  ") == "korea-republic"


def test_slugify_empty_fallback():
    assert slugify("!!!") == "unknown"
    assert slugify("") == "unknown"


def test_to_utc_iso_converts_offset():
    # 16:00 at +02:00 is 14:00 UTC.
    assert to_utc_iso("2026-06-11T16:00:00+02:00") == "2026-06-11T14:00:00+00:00"


def test_to_utc_iso_handles_zulu():
    assert to_utc_iso("2026-06-11T16:00:00Z") == "2026-06-11T16:00:00+00:00"


def test_parse_iso_naive_assumed_utc():
    parsed = parse_iso("2026-06-11T16:00:00")
    assert parsed == datetime(2026, 6, 11, 16, 0, tzinfo=timezone.utc)


def test_now_utc_is_timezone_aware():
    assert now_utc().tzinfo is not None
