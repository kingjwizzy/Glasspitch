import 'server-only';

// Shared read-layer helpers for the server-only Supabase consumers
// (ARCHITECTURE.md §5, §8). The website only ever READS, with the publishable
// key under read-only RLS, and never calls the football API on the request path.

/**
 * §9: the only model ever displayed to a visitor. The in-house `inhouse-elo`
 * model is logged in the ledger but NEVER shown.
 */
export const DISPLAY_SOURCE = 'api-football';

/**
 * PostgREST returns to-one embeds as objects at runtime, but the generated types
 * sometimes widen them to arrays — normalise either shape to a single value.
 */
export function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/**
 * Resolve before `ms`, otherwise yield `fallback` — never let a slow or
 * unreachable DB hang a build or a render (§5: the site serves from cache and
 * data is best-effort; a failed/empty read degrades a block, it never throws).
 * Used for NON-critical reads (form strips, secondary fixture lists) that
 * should degrade gracefully rather than fail the whole page.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/**
 * Resolve before `ms`, otherwise THROW — for the primary read of a page (the
 * ledger, the homepage) where a DB failure must surface as a genuine error so
 * ISR serves the last good cached page and retries on the next revalidation,
 * rather than caching a false "no record" empty state (mirrors the
 * missing-vs-error sentinel pattern in match.ts/team.ts/league.ts). A real
 * rejection from `p` propagates as-is; only a timeout is converted to a fresh
 * Error here.
 */
export function withTimeoutOrThrow<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`read timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * The server-only dev/preview escape hatches (`PREVIEW_HOMEPAGE`,
 * `PREVIEW_LEDGER`, `PREVIEW_MATCH`, `PREVIEW_TEAM`, `PREVIEW_LEAGUE` — see the
 * sibling `*.preview.ts` modules) fabricate representative in-memory data with
 * no DB, for local dev and screenshotting. They must never activate on a real
 * deployment: a single stray `PREVIEW_*` var in a misconfigured environment
 * would otherwise serve invented predictions/records to a real visitor, which
 * for a radical-transparency product is a direct hit on the trust story.
 * Requiring this SECOND, explicit `ALLOW_PREVIEW=1` flag means that mistake
 * alone can never flip the hatch. Deliberately NOT gated on `NODE_ENV` — this
 * repo's own e2e suite runs a production build (`next build && next start`,
 * NODE_ENV=production) and legitimately sets both a `PREVIEW_*` var and
 * `ALLOW_PREVIEW=1` together (see playwright.config.ts's `webServer.env`).
 */
export function previewAllowed(): boolean {
  return process.env.ALLOW_PREVIEW === '1';
}

/**
 * Page through a bounded PostgREST select via `.range()` until a short page is
 * returned (every row fetched) or `maxPages` is hit — a hard safety cap so a
 * runaway/misbehaving table can never hang a sitemap or `generateStaticParams`
 * build. Supabase/PostgREST silently caps an unbounded select at the project's
 * Max Rows setting (default 1000); at club-football scale (thousands of teams/
 * fixtures across leagues and seasons) an unbounded select would silently
 * truncate rather than error (§8, §11).
 */
export async function paginate<T>(
  fetchPage: (from: number, to: number) => Promise<T[] | null>,
  pageSize = 1000,
  maxPages = 20,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const rows = await fetchPage(from, to);
    if (!rows || rows.length === 0) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
