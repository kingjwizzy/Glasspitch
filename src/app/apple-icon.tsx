import { ImageResponse } from 'next/og';

// Apple touch icon (DESIGN.md §8 PWA-lite) — same 'GP' monogram as icon.tsx,
// sized to Apple's conventional 180×180 apple-touch-icon. No tournament
// marks, no crests (ARCHITECTURE.md §13). Next wires this into the page
// <head> automatically (file convention); also referenced directly by
// public/manifest.webmanifest.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
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
          fontSize: 92,
          letterSpacing: -3,
        }}
      >
        GP
      </div>
    ),
    { ...size },
  );
}
