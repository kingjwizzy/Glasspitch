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
