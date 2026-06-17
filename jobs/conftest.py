"""Pytest bootstrap for the jobs package.

Adds this directory to ``sys.path`` so tests under ``jobs/tests`` can import the
flat modules (``scoring``, ``elo``, ...) directly, regardless of where pytest is
invoked from.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
