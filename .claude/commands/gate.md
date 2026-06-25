---
description: Gate the current diff via the checks-reviewer subagent (CI gates + /code-review + /security-review + invariant audit)
---
Use the **checks-reviewer** subagent to gate the current working changes. It must:

1. Scope the change with `git diff` / `git status`.
2. Run the full CI suite exactly as `.github/workflows/ci.yml` does:
   `npm run typecheck`, `npm run lint`, `npm run build`, `python -m pytest -q`, `npm run test:e2e`.
3. Invoke `/code-review` and `/security-review` on the diff.
4. Audit the repo invariants: the golden rule (site only reads the DB; no per-visitor API
   calls; no `supabaseAdmin`/secret key client-side), RLS read-only, and ledger immutability.
5. Return a **Critical / Warning / Suggestion** findings list with `file:line` and a clear
   **PASS / FAIL** verdict. It must not modify any code.

$ARGUMENTS
