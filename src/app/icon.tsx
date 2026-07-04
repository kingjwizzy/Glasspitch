import { ImageResponse } from 'next/og';
import { floodlitMarkDataUri } from '@/lib/logoMark';

// The site's PWA/browser icon (DESIGN.md §8 PWA-lite) — the "Floodlit" brand
// mark (green penalty arc + amber "call" spot on a floodlit glass tile),
// rendered from the shared string in src/lib/logoMark.ts. No tournament marks,
// no crests (ARCHITECTURE.md §13). Referenced by public/manifest.webmanifest as
// the 512×512 install icon; Next also wires this into the page <head> as a
// favicon automatically (file convention).
export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex' }}>
        <img width={512} height={512} src={floodlitMarkDataUri(512, 'tile')} alt="" />
      </div>
    ),
    { ...size },
  );
}
