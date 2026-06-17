"""Supabase service-role client for the Python jobs (ARCHITECTURE.md §6, §7).

The jobs are the ONLY writers to the database. They authenticate with the
service-role key, which bypasses Row Level Security. That key is server-side
ONLY and must never reach the web app or the repo (§12); it is read from the
environment.
"""

from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv
from supabase import Client, create_client

# Load jobs/.env when running locally. The .env file is never committed (§12).
load_dotenv()


@lru_cache(maxsize=1)
def get_client() -> Client:
    """Return a memoised Supabase client authenticated as the service role."""
    url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_role_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set "
            "(see jobs/.env.example). The service-role key is server-side only."
        )
    return create_client(url, service_role_key)
