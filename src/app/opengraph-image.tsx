import { ImageResponse } from 'next/og';
import { SITE_NAME } from '@/lib/constants';
import { floodlitMarkDataUri } from '@/lib/logoMark';

// Default site-wide social share image (ARCHITECTURE.md §11) — generated at
// request time from DESIGN.md tokens, plain text only (no crests/marks, §13),
// no network calls (compliance- and CSP-safe). Individual routes override this
// via their own `opengraph-image.tsx` (see match/[id]).

export const alt = `${SITE_NAME} — transparent football analysis`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: '#0e1311',
          color: '#eaf0ec',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <img width={52} height={52} src={floodlitMarkDataUri(52, 'tile')} alt="" />
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>{SITE_NAME}</div>
        </div>
        <div
          style={{
            marginTop: 36,
            fontSize: 58,
            fontWeight: 700,
            lineHeight: 1.15,
            maxWidth: 920,
          }}
        >
          Transparent football analysis
        </div>
        <div style={{ marginTop: 28, fontSize: 28, color: '#9da8a2', maxWidth: 880 }}>
          Home / draw / away probabilities, locked at kickoff and scored in a
          permanent public ledger — wins and losses alike.
        </div>
        <div style={{ display: 'flex', gap: 24, marginTop: 44 }}>
          {[
            { label: 'H', color: '#4c9aff' },
            { label: 'D', color: '#8a938f' },
            { label: 'A', color: '#f2a33c' },
          ].map((chip) => (
            <div
              key={chip.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 44,
                height: 44,
                borderRadius: 10,
                background: chip.color,
                color: '#0e1311',
                fontSize: 22,
                fontWeight: 700,
              }}
            >
              {chip.label}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
