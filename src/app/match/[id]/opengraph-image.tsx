import { ImageResponse } from 'next/og';
import { getMatchData } from '@/lib/queries/match';
import { getRecordFigures } from '@/lib/queries/recordSummary';
import {
  favoured,
  formatKickoff,
  metric3,
  outcomeName,
  pct,
  pctFigure,
  probOf,
  scoreLine,
} from '@/lib/format';
import { SITE_NAME } from '@/lib/constants';
import { flagDataUri, loadOgFonts, OG_DISCLAIMER, OG_TOKENS as T } from '@/lib/og';

// Per-match share card (W6 share kit; ARCHITECTURE.md §11) — and, once the
// match is scored, the RECEIPT card: call vs outcome, ✓/✗ stamp, Brier and
// the running record. Built ONLY from Supabase reads (§5 golden rule) and
// the local filesystem (vendored brand fonts + sanctioned national-flag SVGs
// inlined as data URIs — zero network calls at render time). Plain-text team
// names remain the identifiers; no crests/marks, no betting vocabulary, and
// the compliance disclaimer is baked into the card footer (§13). Same
// revalidate cadence as the page itself.

export const alt = 'Match probabilities — Glass Pitch';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 600;

function parseId(raw: string): number {
  if (!/^\d{1,15}$/.test(raw)) return NaN;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : NaN;
}

const MONO = 'IBM Plex Mono';

/** Round flag mark, or a plain initial disc when unmapped — mirrors
 *  components/TeamFlag.tsx's degradation contract. */
function Flag({ uri, team, px }: { uri: string | null; team: string; px: number }) {
  if (!uri) {
    return (
      <div
        style={{
          width: px,
          height: px,
          borderRadius: '50%',
          background: T.surface2,
          border: `2px solid ${T.line}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: T.fgDim,
          fontSize: px * 0.32,
        }}
      >
        {team.slice(0, 3).toUpperCase()}
      </div>
    );
  }
  return <img src={uri} width={px} height={px} style={{ borderRadius: '50%' }} alt="" />;
}

/** ✓ / ✗ stamp drawn as SVG paths (no glyph-coverage risk in the vendored
 *  faces) inside a token-coloured ring — never colour alone (§2). */
function Stamp({ hit }: { hit: boolean }) {
  const color = hit ? T.green : T.miss;
  return (
    <div
      style={{
        width: 76,
        height: 76,
        borderRadius: '50%',
        border: `5px solid ${color}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        {hit ? (
          <path
            d="M8 21l9 9L33 11"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M11 11l18 18M29 11L11 29"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
          />
        )}
      </svg>
    </div>
  );
}

export default async function MatchOpengraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getMatchData(parseId(id));
  const fonts = await loadOgFonts();

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
            background: T.bg,
            color: T.fg,
            fontSize: 54,
            fontFamily: 'Archivo',
          }}
        >
          {SITE_NAME}
        </div>
      ),
      { ...size, fonts },
    );
  }

  const [homeFlag, awayFlag] = await Promise.all([
    flagDataUri(data.home),
    flagDataUri(data.away),
  ]);

  const prediction = data.prediction;
  const probs = prediction
    ? { home: prediction.prob_home, draw: prediction.prob_draw, away: prediction.prob_away }
    : null;
  const total = probs ? probs.home + probs.draw + probs.away || 1 : 1;
  const bars = probs
    ? [
        { key: 'H', p: probs.home / total, color: T.home },
        { key: 'D', p: probs.draw / total, color: T.draw },
        { key: 'A', p: probs.away / total, color: T.away },
      ]
    : null;

  const isScored =
    prediction?.status === 'scored' &&
    prediction.result !== null &&
    data.final_home_goals !== null &&
    data.final_away_goals !== null;
  const pick = probs ? favoured(probs).key : null;
  const hit = isScored && pick !== null && pick === prediction!.result;
  const record = isScored ? await getRecordFigures() : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '56px 64px 44px',
          background: T.bg,
          color: T.fg,
          fontFamily: 'Archivo',
        }}
      >
        {/* provenance header */}
        <div
          style={{
            display: 'flex',
            fontFamily: MONO,
            fontSize: 22,
            color: T.fgDim,
          }}
        >
          {SITE_NAME} · {formatKickoff(data.kickoff_utc)}
          {data.league ? ` · ${data.league}` : ''}
        </div>

        {/* teams (+ final score once scored) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            marginTop: 40,
          }}
        >
          <Flag uri={homeFlag} team={data.home} px={64} />
          <div style={{ display: 'flex', fontSize: 52, fontWeight: 600 }}>{data.home}</div>
          {isScored ? (
            <div
              style={{
                display: 'flex',
                fontFamily: MONO,
                fontWeight: 500,
                fontSize: 56,
                margin: '0 8px',
              }}
            >
              {scoreLine(data.final_home_goals!, data.final_away_goals!)}
            </div>
          ) : (
            <div style={{ display: 'flex', fontSize: 30, color: T.fgDim }}>v</div>
          )}
          <Flag uri={awayFlag} team={data.away} px={64} />
          <div style={{ display: 'flex', fontSize: 52, fontWeight: 600 }}>{data.away}</div>
        </div>

        {/* the locked call: segmented H/D/A bar + mono legend */}
        {bars && (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 44 }}>
            <div
              style={{
                display: 'flex',
                width: '100%',
                height: 58,
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              {bars.map((b) => (
                <div
                  key={b.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: `${Math.max(b.p * 100, 1.5)}%`,
                    height: '100%',
                    background: b.color,
                    color: T.bg,
                    fontFamily: MONO,
                    fontWeight: 500,
                    fontSize: 24,
                  }}
                >
                  {b.p >= 0.13 ? `${b.key} ${pctFigure(b.p)}%` : ''}
                </div>
              ))}
            </div>
            {/* every figure printed — colour is never the only signal */}
            <div
              style={{
                display: 'flex',
                marginTop: 14,
                fontFamily: MONO,
                fontSize: 24,
                color: T.fgDim,
              }}
            >
              {`home ${pctFigure(bars[0].p)} · draw ${pctFigure(bars[1].p)} · away ${pctFigure(bars[2].p)}`}
            </div>
          </div>
        )}

        {!bars && (
          <div style={{ display: 'flex', marginTop: 48, fontSize: 28, color: T.fgDim }}>
            {data.predictionVoided
              ? 'Call voided for integrity — excluded from the scored record'
              : 'Probabilities not yet published'}
          </div>
        )}

        {/* receipt row (scored) or the lock line (upcoming) */}
        {isScored && probs && pick ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 28,
              marginTop: 40,
            }}
          >
            <Stamp hit={hit} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', fontSize: 32, color: T.fg }}>
                {hit ? 'Correct call' : 'Missed call'} — we said{' '}
                {outcomeName(pick, data.home, data.away)} at {pct(probOf(probs, pick))}
              </div>
              <div
                style={{
                  display: 'flex',
                  fontFamily: MONO,
                  fontSize: 23,
                  color: T.fgDim,
                }}
              >
                {prediction!.brier_score !== null
                  ? `Brier ${metric3(prediction!.brier_score)}`
                  : ''}
                {prediction!.brier_score !== null && record ? ' · ' : ''}
                {record
                  ? `record ${record.hits} of ${record.count} calls landed — misses included`
                  : ''}
              </div>
            </div>
          </div>
        ) : (
          bars && (
            <div style={{ display: 'flex', marginTop: 40, fontSize: 27, color: T.fgDim }}>
              Locked at kickoff — then scored on the public ledger, hit or miss.
            </div>
          )
        )}

        {/* compliance footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 'auto',
            paddingTop: 28,
            borderTop: `1px solid ${T.line}`,
            fontSize: 20,
            color: T.fgDim,
          }}
        >
          <div style={{ display: 'flex' }}>{OG_DISCLAIMER}</div>
          <div style={{ display: 'flex', color: T.green }}>glasspitch.com</div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
