"""Small shared helpers for the Glass Pitch jobs."""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone


def now_utc() -> datetime:
    """Timezone-aware 'now' in UTC. All times are stored in UTC (§7)."""
    return datetime.now(timezone.utc)


def parse_iso(value: str | datetime) -> datetime:
    """Parse an ISO-8601 timestamp (or pass through a datetime) to an aware UTC
    datetime. Naive inputs are assumed to be UTC."""
    if isinstance(value, datetime):
        dt = value
    else:
        text = value.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def to_utc_iso(value: str | datetime) -> str:
    """Normalise an API datetime to a UTC ISO-8601 string for storage (§7)."""
    return parse_iso(value).isoformat()


def slugify(name: str) -> str:
    """URL-safe slug from a plain team/league name (ASCII, lowercase, hyphens).

    Plain text only — no crests/marks (ARCHITECTURE.md §13).
    """
    ascii_name = (
        unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    )
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")
    return slug or "unknown"
