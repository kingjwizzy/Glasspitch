import type { FormResult } from '@/lib/queries/match';

// Recent form as W/D/L chips (DESIGN.md §4). Colour is never the only signal:
// every chip shows its letter and a full aria-label ("Won 3–1 at home to …"), so
// the strip parses in greyscale and to a screen reader (§2 hard rule). Chips run
// oldest → newest, so the rightmost is the most recent match.

// Brightened text tokens (green-bright / miss-bright) keep the small letter
// above the 4.5:1 AA floor on the tinted chip backgrounds (DESIGN.md §2, §7).
const OUTCOME: Record<FormResult['outcome'], { word: string; chip: string }> = {
  W: { word: 'Won', chip: 'bg-green/15 text-green-bright' },
  D: { word: 'Drew', chip: 'bg-surface-2 text-fg-dim border border-line' },
  L: { word: 'Lost', chip: 'bg-miss/15 text-miss-bright' },
};

function chipLabel(r: FormResult): string {
  const where = r.home ? 'at home to' : 'away to';
  return `${OUTCOME[r.outcome].word} ${r.gf}–${r.ga} ${where} ${r.opponent}`;
}

export default function FormChips({
  teamName,
  results,
}: {
  teamName: string;
  results: FormResult[];
}) {
  return (
    <div>
      <p className="truncate text-sm font-medium text-fg">{teamName}</p>
      {results.length > 0 ? (
        <ol
          className="mt-2 flex items-center gap-1.5"
          aria-label={`${teamName} recent form, oldest to newest`}
        >
          {results.map((r) => (
            <li key={r.fixtureId}>
              {/* role="img" so the rich aria-label is reliably announced as the
                  accessible name (a bare span's label can be dropped by AT),
                  matching ResultBadge / ProbabilityBar. The letter is the
                  colour-independent visual signal; mono is reserved for figures
                  (DESIGN.md §3), so the letter stays in the sans UI font. */}
              <span
                role="img"
                aria-label={chipLabel(r)}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold ${OUTCOME[r.outcome].chip}`}
              >
                {r.outcome}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-xs text-fg-dim">No earlier matches in our record.</p>
      )}
    </div>
  );
}
