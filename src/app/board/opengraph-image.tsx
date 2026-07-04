import { ImageResponse } from 'next/og';
import { boardByTeam, getBoardData } from '@/lib/queries/board';
import { formatDateShort, pct } from '@/lib/format';
import { SITE_NAME } from '@/lib/constants';
import { flagDataUri, loadOgFonts, OG_DISCLAIMER, OG_TOKENS as T } from '@/lib/og';

// /board share card (RAMBO wave 2 #2), mirroring the match/chances OG routes:
// Supabase reads + the local filesystem only (vendored fonts + sanctioned
// flag SVGs) — zero network calls at render time (§5 golden rule;
// src/lib/og.ts). Mirrors the page's OWN content (its top teams by win
// probability, the same `boardByTeam` the table itself uses) rather than the
// scored ledger — the board is a distinct, Elo-based context surface, not
// the track record (that's what /ledger's own OG image and this page's
// ShareRow both point at instead).

export const alt = 'Gameweek board — Glass Pitch';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 3600;

const MONO = 'IBM Plex Mono';
const TOP_N = 5;

function MoveText({ delta }: { delta: number | null }) {
  if (delta === null || Math.abs(delta) < 0.0005) {
    return <span style={{ display: 'flex', fontFamily: MONO, fontSize: 24, color: T.fgDim }}>—</span>;
  }
  const pp = Math.abs(delta * 100).toFixed(1);
  const up = delta > 0;
  return (
    <span
      style={{
        display: 'flex',
        fontFamily: MONO,
        fontSize: 24,
        color: up ? T.green : T.miss,
      }}
    >
      {up ? '▲' : '▼'} {pp}
    </span>
  );
}

export default async function BoardOpengraphImage() {
  const [{ snapshotDate, rows }, fonts] = await Promise.all([getBoardData(), loadOgFonts()]);
  const top = boardByTeam(rows).slice(0, TOP_N);

  if (top.length === 0) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 22,
            background: T.bg,
            color: T.fg,
            fontFamily: 'Archivo',
          }}
        >
          <div style={{ display: 'flex', fontSize: 58 }}>Gameweek board</div>
          <div style={{ display: 'flex', fontSize: 28, color: T.fgDim }}>
            Every team&rsquo;s next-match win probability — first snapshot
            appears after tonight&rsquo;s run
          </div>
          <div
            style={{
              display: 'flex',
              fontFamily: MONO,
              fontSize: 22,
              color: T.green,
              marginTop: 12,
            }}
          >
            glasspitch.com/board
          </div>
        </div>
      ),
      { ...size, fonts },
    );
  }

  const flags = await Promise.all(top.map((t) => flagDataUri(t.team)));

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '52px 64px 44px',
          background: T.bg,
          color: T.fg,
          fontFamily: 'Archivo',
        }}
      >
        <div style={{ display: 'flex', fontFamily: MONO, fontSize: 22, color: T.fgDim }}>
          {SITE_NAME} · Gameweek board
        </div>
        <div style={{ display: 'flex', marginTop: 10, fontSize: 44, fontWeight: 600 }}>
          Next-match win probabilities
        </div>

        {/* top-5 teams by win probability, ready-sorted */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: 32,
            borderRadius: 16,
            border: `1px solid ${T.line}`,
            background: T.surface,
            overflow: 'hidden',
          }}
        >
          {top.map((t, i) => {
            const uri = flags[i];
            return (
              <div
                key={t.teamId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 18,
                  padding: '18px 26px',
                  borderTop: i === 0 ? 'none' : `1px solid ${T.line}`,
                }}
              >
                {uri ? (
                  <img src={uri} width={40} height={40} style={{ borderRadius: '50%' }} alt="" />
                ) : (
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      background: T.surface2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: T.fgDim,
                      fontSize: 14,
                    }}
                  >
                    {t.team.slice(0, 3).toUpperCase()}
                  </div>
                )}
                <div style={{ display: 'flex', flex: 1, fontSize: 28 }}>{t.team}</div>
                <div style={{ display: 'flex', fontSize: 20, color: T.fgDim, width: 170 }}>
                  {t.isHome ? 'v' : 'at'} {t.opponent}
                </div>
                <div
                  style={{
                    display: 'flex',
                    fontFamily: MONO,
                    fontSize: 30,
                    fontWeight: 500,
                    width: 90,
                    justifyContent: 'flex-end',
                  }}
                >
                  {pct(t.probWin)}
                </div>
                <div style={{ display: 'flex', width: 100, justifyContent: 'flex-end' }}>
                  <MoveText delta={t.deltaProbWin} />
                </div>
              </div>
            );
          })}
        </div>

        {snapshotDate && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginTop: 18,
              fontFamily: MONO,
              fontSize: 21,
              color: T.fgDim,
            }}
          >
            snapshot {formatDateShort(`${snapshotDate}T00:00:00Z`)} · refreshed nightly
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 'auto',
            paddingTop: 26,
            borderTop: `1px solid ${T.line}`,
            fontSize: 20,
            color: T.fgDim,
          }}
        >
          <div style={{ display: 'flex' }}>{OG_DISCLAIMER}</div>
          <div style={{ display: 'flex', color: T.green }}>glasspitch.com/board</div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
