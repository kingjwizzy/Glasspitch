import { ImageResponse } from 'next/og';
import { getMatchData } from '@/lib/queries/match';
import { favoured, formatDateShort } from '@/lib/format';
import { SITE_NAME } from '@/lib/constants';

// Per-match social share image (ARCHITECTURE.md §11) — team names, kickoff
// date and the H/D/A probability split, built ONLY from Supabase reads (§5
// golden rule — never the football API) and plain text (no crests/marks,
// §13). Rendered server-side with no network calls (CSP/compliance-safe).
// Same revalidate cadence as the page itself.

export const alt = 'Match probabilities — Glass Pitch';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 600;

const BG = '#0e1311';
const FG = '#eaf0ec';
const FG_DIM = '#9da8a2';
const GREEN = '#35b27a';
const MISS = '#f2555a';
const COLORS = { home: '#4c9aff', draw: '#8a938f', away: '#f2a33c' } as const;

function parseId(raw: string): number {
  if (!/^\d{1,15}$/.test(raw)) return NaN;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : NaN;
}

export default async function MatchOpengraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getMatchData(parseId(id));

  if (!data) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: BG,
            color: FG,
            fontSize: 48,
            fontWeight: 700,
            fontFamily: 'sans-serif',
          }}
        >
          {SITE_NAME}
        </div>
      ),
      { ...size },
    );
  }

  const prediction = data.prediction;
  const total = prediction
    ? prediction.prob_home + prediction.prob_draw + prediction.prob_away || 1
    : 1;
  const bars = prediction
    ? [
        { key: 'H', pct: prediction.prob_home / total, color: COLORS.home },
        { key: 'D', pct: prediction.prob_draw / total, color: COLORS.draw },
        { key: 'A', pct: prediction.prob_away / total, color: COLORS.away },
      ]
    : null;

  const isScored =
    prediction?.status === 'scored' &&
    prediction.result !== null &&
    data.final_home_goals !== null &&
    data.final_away_goals !== null;
  const pickKey = prediction
    ? favoured({
        home: prediction.prob_home,
        draw: prediction.prob_draw,
        away: prediction.prob_away,
      }).key
    : null;
  const hit = isScored && pickKey === prediction!.result;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '70px',
          background: BG,
          color: FG,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', fontSize: 26, color: FG_DIM }}>
          {SITE_NAME} · {formatDateShort(data.kickoff_utc)}
          {data.league ? ` · ${data.league}` : ''}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 28 }}>
          <div style={{ fontSize: 54, fontWeight: 700 }}>{data.home}</div>
          <div style={{ fontSize: 32, color: FG_DIM }}>v</div>
          <div style={{ fontSize: 54, fontWeight: 700 }}>{data.away}</div>
        </div>

        {bars && (
          <div
            style={{
              display: 'flex',
              width: '100%',
              height: 72,
              borderRadius: 14,
              overflow: 'hidden',
              marginTop: 56,
            }}
          >
            {bars.map((b) => (
              <div
                key={b.key}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: `${Math.max(b.pct * 100, 0)}%`,
                  height: '100%',
                  background: b.color,
                  color: BG,
                  fontSize: 24,
                  fontWeight: 700,
                }}
              >
                {Math.round(b.pct * 100)}%
              </div>
            ))}
          </div>
        )}

        {!bars && (
          <div style={{ display: 'flex', marginTop: 56, fontSize: 28, color: FG_DIM }}>
            Probabilities not yet published
          </div>
        )}

        {isScored && (
          <div
            style={{
              display: 'flex',
              marginTop: 36,
              fontSize: 30,
              fontWeight: 700,
              color: hit ? GREEN : MISS,
            }}
          >
            {hit ? 'Correct call' : 'Missed call'} — final{' '}
            {data.final_home_goals}–{data.final_away_goals}
          </div>
        )}
      </div>
    ),
    { ...size },
  );
}
