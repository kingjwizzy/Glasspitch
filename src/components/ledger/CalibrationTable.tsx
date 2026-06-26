import { pct } from '@/lib/format';
import type { CalibrationBin } from '@/lib/queries/ledger';

// Reliability table (ARCHITECTURE.md §10, §17): does a "30%" call happen about
// 30% of the time? Every scored match contributes its three home/draw/away
// probabilities, bucketed into fixed deciles, with the mean we predicted set
// against how often it actually happened. A hand-built RSC table (zero client JS,
// per ARCHITECTURE.md §6) with a caption and scoped headers for screen readers.
// Colour is never the only signal — the comparison is read straight from the two
// number columns, and empty bands stay visibly empty rather than being hidden.

export default function CalibrationTable({ bins }: { bins: CalibrationBin[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">
          Calibration by predicted-probability band: how many probabilities fell
          in each band, the average we predicted, and how often the outcome
          actually happened.
        </caption>
        <thead>
          <tr className="border-b border-line text-left text-xs text-fg-dim">
            <th scope="col" className="px-4 py-3 font-medium">
              Confidence band
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Data points
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              We predicted
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              It happened
            </th>
          </tr>
        </thead>
        <tbody>
          {bins.map((b) => {
            const empty = b.n === 0;
            return (
              <tr
                key={b.label}
                // Empty bands are dimmed to text-fg-dim (AA on every surface) —
                // never text-fg-faint, which is sub-AA at this size. The band
                // label, the 0 and the em-dashes are meaningful content (no calls
                // in this band), so they must clear the 4.5:1 contrast floor (§7).
                className={`border-b border-line last:border-0 ${
                  empty ? 'text-fg-dim' : ''
                }`}
              >
                <th
                  scope="row"
                  className={`px-4 py-3 text-left font-mono font-medium ${
                    empty ? '' : 'text-fg'
                  }`}
                >
                  {b.label}
                </th>
                <td className="px-4 py-3 text-right font-mono">{b.n}</td>
                <td className="px-4 py-3 text-right font-mono text-fg-dim">
                  {b.predictedAvg === null ? '—' : pct(b.predictedAvg)}
                </td>
                <td
                  className={`px-4 py-3 text-right font-mono font-medium ${
                    empty ? '' : 'text-fg'
                  }`}
                >
                  {b.observedRate === null ? '—' : pct(b.observedRate)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
