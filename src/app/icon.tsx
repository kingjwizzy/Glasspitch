import { ImageResponse } from 'next/og';

// The site's PWA/browser icon (DESIGN.md §8 PWA-lite) — a plain 'GP' monogram
// on the pitch-charcoal token, generated at request time from DESIGN.md
// tokens. No tournament marks, no crests (ARCHITECTURE.md §13). Referenced by
// public/manifest.webmanifest as the 512×512 install icon; Next also wires
// this into the page <head> as a favicon automatically (file convention).
export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0e1311',
          color: '#eaf0ec',
          fontFamily: 'sans-serif',
          fontWeight: 700,
          fontSize: 260,
          letterSpacing: -10,
        }}
      >
        GP
      </div>
    ),
    { ...size },
  );
}
