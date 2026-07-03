import { ImageResponse } from 'next/og';
import { getChancesData } from '@/lib/queries/chances';
import { pct } from '@/lib/format';
import { SITE_NAME } from '@/lib/constants';
import { flagDataUri, loadOgFonts, OG_DISCLAIMER, OG_TOKENS as T } from '@/lib/og';

// /chances share card (W6 share kit): the top-6 nations as circles sized by
// title chance — the page's flagship visual, compressed for the timeline.
// Supabase reads + local filesystem only (vendored fonts, sanctioned flag
// SVGs as data URIs) — zero network calls; plain-text names, no marks, and
// the compliance disclaimer baked into the footer (ARCHITECTURE.md §5, §13).
// Same revalidate cadence as the page.

export const alt = 'World Cup chances — Glass Pitch';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 3600;

const MONO = 'IBM Plex Mono';
const MAX_D = 210;
const MIN_D = 76;
/** Usable rack width: 1200 minus the 64px page padding each side, with a
 *  little slack for the column gaps. */
const RACK_WIDTH = 1040;
const RACK_GAP = 30;

/** Area-proportional diameters (∝ √p, favourite = MAX_D), then a uniform
 *  shrink whenever the six columns would overflow the rack — the favourite
 *  can never be clipped at the card edge, whatever the field's shape. */
function diameters(ps: number[]): number[] {
  const maxP = ps[0] ?? 0;
  let ds = ps.map((p) =>
    Math.max(MIN_D, Math.min(MAX_D, Math.round(MAX_D * Math.sqrt(maxP > 0 ? p / maxP : 0)))),
  );
  const total = ds.reduce((s, d) => s + d, 0) + RACK_GAP * Math.max(0, ds.length - 1);
  if (total > RACK_WIDTH) {
    const scale = (RACK_WIDTH - RACK_GAP * Math.max(0, ds.length - 1)) / (total - RACK_GAP * Math.max(0, ds.length - 1));
    ds = ds.map((d) => Math.max(56, Math.floor(d * scale)));
  }
  return ds;
}

export default async function ChancesOpengraphImage() {
  const [{ teams, sims }, fonts] = await Promise.all([getChancesData(), loadOgFonts()]);
  const top = teams.slice(0, 6);
  const flags = await Promise.all(top.map((t) => flagDataUri(t.team)));

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
          <div style={{ display: 'flex', fontSize: 58 }}>World Cup chances</div>
          <div style={{ display: 'flex', fontSize: 28, color: T.fgDim }}>
            Every nation, simulated daily — first run tonight
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
            glasspitch.com/chances
          </div>
        </div>
      ),
      { ...size, fonts },
    );
  }

  const ds = diameters(top.map((t) => t.pWin));

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
          {SITE_NAME} · World Cup chances
        </div>
        <div style={{ display: 'flex', marginTop: 10, fontSize: 46, fontWeight: 600 }}>
          Who wins it all — sized by probability
        </div>

        {/* the top-6 circle rack, favourite first */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            gap: RACK_GAP,
            marginTop: 40,
            height: 300,
          }}
        >
          {top.map((t, i) => {
            const d = ds[i];
            const uri = flags[i];
            return (
              <div
                key={t.teamId}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                  // Long nation names wrap under their circle instead of
                  // widening the column and pushing the rack past the edges.
                  maxWidth: Math.max(d, 132),
                }}
              >
                {uri ? (
                  <img
                    src={uri}
                    width={d}
                    height={d}
                    style={{ borderRadius: '50%' }}
                    alt=""
                  />
                ) : (
                  <div
                    style={{
                      width: d,
                      height: d,
                      borderRadius: '50%',
                      background: T.surface2,
                      border: `2px solid ${T.line}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: T.fgDim,
                      fontSize: Math.max(20, d * 0.26),
                    }}
                  >
                    {t.team.slice(0, 3).toUpperCase()}
                  </div>
                )}
                <div
                  style={{
                    display: 'flex',
                    fontSize: 22,
                    color: T.fg,
                    textAlign: 'center',
                  }}
                >
                  {t.team}
                </div>
                <div
                  style={{
                    display: 'flex',
                    fontFamily: MONO,
                    fontWeight: 500,
                    fontSize: 26,
                    color: T.fg,
                  }}
                >
                  {pct(t.pWin)}
                </div>
              </div>
            );
          })}
        </div>

        {sims !== null && (
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
            simulated {sims.toLocaleString('en-GB')} times · updated daily
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
          <div style={{ display: 'flex', color: T.green }}>glasspitch.com/chances</div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
