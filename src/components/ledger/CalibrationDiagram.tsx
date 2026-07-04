import { pct } from '@/lib/format';
import type { CalibrationBin } from '@/lib/queries/ledger';

// Reliability diagram — "checking our work" (RAMBO wave 2 #3). Hand-built
// inline SVG, plain RSC, ZERO client JS (ARCHITECTURE.md §6): one dot per
// predicted-probability band with at least one scored call, plotted against
// the actual hit rate, alongside the 45° "perfect calibration" line. Dot
// AREA (not radius) is proportional to the band's sample size n — the same
// honest-sizing convention as ChancesCloud's win-probability circles
// (diameter ∝ √value, clamped to a legible range).
//
// This is a PICTURE of CalibrationTable, nothing more: same bins, same
// numbers, no separate computation path to drift from what the table (the
// full text alternative) says. Shows ONLY the displayed third-party model's
// calibration — buildCalibration() only ever runs on `source = 'api-football'`
// rows, so the in-house Elo model can never appear here (DESIGN.md §9,
// ARCHITECTURE.md §9/§10 — never surfaced anywhere on the site).
//
// Colour is never the only signal (DESIGN.md §2): every dot's position is
// readable off two labelled, ticked, numeric axes, and the exact figures for
// every band — including empty ones the diagram can't show a dot for — sit
// in the table directly beside/below it.

const SIZE = 300;
// left+right (64) equals top+bottom (64) so the plot area is a perfect
// square and the reference line reads as a true 45° diagonal, not a visual
// approximation.
const MARGIN = { top: 18, right: 18, bottom: 46, left: 46 };
const PLOT = SIZE - MARGIN.left - MARGIN.right; // = SIZE - MARGIN.top - MARGIN.bottom
const TICKS = [0, 25, 50, 75, 100];
const MIN_R = 4;
const MAX_R = 14;

/** 0–100 domain value → SVG x (predicted probability, left → right). */
function px(v: number): number {
  return MARGIN.left + (v / 100) * PLOT;
}
/** 0–100 domain value → SVG y (actual hit rate, bottom → top — SVG y grows
 *  downward, so this is inverted). */
function py(v: number): number {
  return MARGIN.top + PLOT - (v / 100) * PLOT;
}

/** Radius so dot AREA (πr²) scales with n relative to the busiest band,
 *  clamped so the smallest populated band stays visible and the largest
 *  never dominates the plot. */
function dotRadius(n: number, maxN: number): number {
  if (maxN <= 0) return MIN_R;
  return Math.max(MIN_R, Math.min(MAX_R, MAX_R * Math.sqrt(n / maxN)));
}

export default function CalibrationDiagram({ bins }: { bins: CalibrationBin[] }) {
  const points = bins.filter(
    (b): b is CalibrationBin & { predictedAvg: number; observedRate: number } =>
      b.n > 0 && b.predictedAvg !== null && b.observedRate !== null,
  );
  if (points.length === 0) return null;

  const maxN = Math.max(...points.map((b) => b.n));
  // Diagonal reference line runs corner-to-corner of the square plot area.
  const diagStart = { x: px(0), y: py(0) };
  const diagEnd = { x: px(100), y: py(100) };
  // Label sits a little off the line at ~60% along it, rotated to match.
  const labelPoint = { x: px(60), y: py(68) };

  return (
    <figure className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-labelledby="calibration-diagram-title calibration-diagram-desc"
        className="mx-auto block h-auto w-full max-w-[280px]"
      >
        <title id="calibration-diagram-title">
          Reliability diagram: predicted probability versus actual hit rate
        </title>
        <desc id="calibration-diagram-desc">
          One dot per predicted-probability band with at least one scored
          call, plotting the average probability we assigned on the
          horizontal axis against how often the outcome actually happened on
          the vertical axis. Dot size shows how many predictions fall in
          that band. A dashed diagonal line marks perfect calibration — a
          dot sitting on it means that probability landed exactly as often
          as predicted. The exact figures for every band, including empty
          ones, are in the table below this diagram.
        </desc>

        {/* Axes */}
        <line
          x1={MARGIN.left}
          y1={MARGIN.top}
          x2={MARGIN.left}
          y2={SIZE - MARGIN.bottom}
          stroke="currentColor"
          strokeWidth={1}
          className="text-line"
        />
        <line
          x1={MARGIN.left}
          y1={SIZE - MARGIN.bottom}
          x2={SIZE - MARGIN.right}
          y2={SIZE - MARGIN.bottom}
          stroke="currentColor"
          strokeWidth={1}
          className="text-line"
        />

        {/* Tick marks + labels (mono, matching every other figure on the
            page — DESIGN.md §3). */}
        {TICKS.map((t) => (
          <text
            key={`x-${t}`}
            x={px(t)}
            y={SIZE - MARGIN.bottom + 15}
            textAnchor="middle"
            fill="currentColor"
            className="font-mono text-[9px] text-fg-dim"
          >
            {t}
          </text>
        ))}
        {TICKS.map((t) => (
          <text
            key={`y-${t}`}
            x={MARGIN.left - 8}
            y={py(t) + 3}
            textAnchor="end"
            fill="currentColor"
            className="font-mono text-[9px] text-fg-dim"
          >
            {t}
          </text>
        ))}

        {/* Axis titles */}
        <text
          x={MARGIN.left + PLOT / 2}
          y={SIZE - 6}
          textAnchor="middle"
          fill="currentColor"
          className="text-[10px] text-fg-dim"
        >
          Predicted probability (%)
        </text>
        <text
          x={13}
          y={MARGIN.top + PLOT / 2}
          textAnchor="middle"
          fill="currentColor"
          className="text-[10px] text-fg-dim"
          transform={`rotate(-90 13 ${MARGIN.top + PLOT / 2})`}
        >
          Actual hit rate (%)
        </text>

        {/* 45° reference line — perfect calibration. Dashed + labelled so it
            never reads as a data series of its own. */}
        <line
          x1={diagStart.x}
          y1={diagStart.y}
          x2={diagEnd.x}
          y2={diagEnd.y}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          className="text-fg-dim"
        />
        <text
          x={labelPoint.x}
          y={labelPoint.y}
          textAnchor="middle"
          fill="currentColor"
          className="text-[9px] text-fg-dim"
          transform={`rotate(-45 ${labelPoint.x} ${labelPoint.y})`}
        >
          Perfect calibration
        </text>

        {/* Data points — one per populated band. A pale halo (surface-
            coloured) behind each dot keeps overlapping bands legible
            against the gridlines rather than muddying into one blob. */}
        {points.map((b) => {
          const cx = px(b.predictedAvg * 100);
          const cy = py(b.observedRate * 100);
          const r = dotRadius(b.n, maxN);
          const dotTitle = `${b.label} band, ${b.n} data point${b.n === 1 ? '' : 's'}: we predicted ${pct(
            b.predictedAvg,
          )} on average, and it happened ${pct(b.observedRate)} of the time.`;
          return (
            <g key={b.label}>
              <circle cx={cx} cy={cy} r={r + 2} fill="currentColor" className="text-surface" />
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill="currentColor"
                fillOpacity={0.82}
                className="text-green"
              >
                <title>{dotTitle}</title>
              </circle>
            </g>
          );
        })}
      </svg>

      <figcaption className="mt-3 text-xs leading-relaxed text-fg-dim">
        Each dot is one predicted-probability band with at least one scored
        call; size shows how many predictions sit in that band. A dot on the
        dashed line means that probability landed exactly as often as we
        said. Full numbers for every band, including empty ones, are in the
        table.
      </figcaption>
    </figure>
  );
}
