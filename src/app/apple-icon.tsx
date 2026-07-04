import { ImageResponse } from 'next/og';
import { floodlitMarkDataUri } from '@/lib/logoMark';

// Apple touch icon (DESIGN.md §8 PWA-lite) — the "Floodlit" brand mark, sized to
// Apple's conventional 180×180 apple-touch-icon. Uses the full-bleed `square`
// variant (no transparent corners) because iOS applies its own rounded mask. No
// tournament marks, no crests (ARCHITECTURE.md §13). Next wires this into the
// page <head> automatically; also referenced by public/manifest.webmanifest.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#0e1311' }}>
        <img width={180} height={180} src={floodlitMarkDataUri(180, 'square')} alt="" />
      </div>
    ),
    { ...size },
  );
}
