import type { FixtureInsight, FixtureInsightKind } from '@/lib/types';
import { formatKickoff } from '@/lib/format';

// Renders premium `fixture_insights` rows (ARCHITECTURE.md §7 v2). The
// payload is jsonb with a shape the jobs pipeline defines and can evolve
// independently of this UI — rendered generically (key/value) rather than
// hard-coding field names this frontend pass has no contract for, so a
// future backend-jobs payload change doesn't silently stop rendering.

const KIND_LABEL: Record<FixtureInsightKind, string> = {
  prediction_detail: 'Prediction detail',
  post_match_stats: 'Post-match stats',
};

/** snake_case / camelCase key → sentence case label (DESIGN.md §3: sentence
 *  case everywhere, never Title Case). */
function humanizeKey(key: string): string {
  const spaced = key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function InsightCard({ insight }: { insight: FixtureInsight }) {
  const entries = Object.entries(insight.payload);
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-base font-semibold tracking-tight text-fg">
          {KIND_LABEL[insight.kind] ?? insight.kind}
        </h3>
        <span className="text-xs text-fg-dim">
          Fetched{' '}
          <time dateTime={insight.fetched_at} className="font-mono">
            {formatKickoff(insight.fetched_at)}
          </time>
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-fg-dim">No detail recorded for this yet.</p>
      ) : (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt className="text-xs text-fg-dim">{humanizeKey(key)}</dt>
              <dd className="mt-0.5 font-mono font-medium text-fg">{formatValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      <p className="mt-4 border-t border-line pt-3 text-xs text-fg-dim">
        Source: {insight.source}
      </p>
    </div>
  );
}

export default function InsightsPanel({ insights }: { insights: FixtureInsight[] }) {
  if (insights.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-5">
        <p className="text-sm leading-relaxed text-fg-dim">
          No deeper read has been published for this fixture yet — check back
          closer to kickoff or after full time.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {insights.map((insight) => (
        <InsightCard key={insight.kind} insight={insight} />
      ))}
    </div>
  );
}
