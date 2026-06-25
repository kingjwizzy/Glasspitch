"""Glass Pitch scheduled jobs package (ARCHITECTURE.md §5, §6, §8).

These jobs are the ONLY callers of the football API and the ONLY writers to the
database. The web app only ever reads from Postgres. Run a job as a module from
the repo root, e.g. ``python -m jobs.fetch_fixtures --dry-run``.
"""
