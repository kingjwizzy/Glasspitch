// Single source of truth for the "Floodlit" brand mark as an SVG STRING, for
// the Satori-rendered routes (favicon icon.tsx, apple-icon.tsx, opengraph
// images). The header uses the JSX twin in src/components/Logo.tsx.
//
// Pitch geometry only — a green penalty arc + an amber "call" spot on a
// floodlit glass tile; NO crest, photo, badge, or tournament mark
// (ARCHITECTURE.md §13). Every colour is a DESIGN.md token.

type Variant = 'tile' | 'square';

// `tile`  — rounded "glass" tile with a hairline edge (favicon, PWA icon).
// `square`— full-bleed dark square, no transparent corners (Apple touch icon,
//           which iOS masks itself; also the OG chip).
export function floodlitMarkSvg(size: number, variant: Variant = 'tile'): string {
  const clip =
    variant === 'tile'
      ? '<clipPath id="m-c"><rect width="32" height="32" rx="7.5"/></clipPath>'
      : '<clipPath id="m-c"><rect width="32" height="32"/></clipPath>';
  const glassEdge =
    variant === 'tile'
      ? '<rect x=".6" y=".6" width="30.8" height="30.8" rx="6.9" fill="none" stroke="#fff" stroke-opacity=".10"/>'
      : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">` +
    `<defs>${clip}` +
    `<radialGradient id="m-fl" cx="50%" cy="6%" r="72%">` +
    `<stop offset="0" stop-color="#35B27A" stop-opacity=".34"/>` +
    `<stop offset=".55" stop-color="#35B27A" stop-opacity=".06"/>` +
    `<stop offset="1" stop-color="#35B27A" stop-opacity="0"/></radialGradient></defs>` +
    `<g clip-path="url(#m-c)">` +
    `<rect width="32" height="32" fill="#0E1311"/>` +
    `<rect width="32" height="32" fill="url(#m-fl)"/>` +
    `<line x1="6.5" y1="21" x2="25.5" y2="21" stroke="#35B27A" stroke-width="1.4" stroke-opacity=".5" stroke-linecap="round"/>` +
    `<path d="M8 21A8 8 0 0 1 24 21" fill="none" stroke="#35B27A" stroke-width="2.4" stroke-linecap="round"/>` +
    `<circle cx="16" cy="18.4" r="3.4" fill="#F2A33C" fill-opacity=".18"/>` +
    `<circle cx="16" cy="18.4" r="1.9" fill="#F2A33C"/></g>` +
    glassEdge +
    `</svg>`
  );
}

// Ready-to-embed data URI (utf8-encoded — no Buffer/btoa, so it works in any
// Next runtime). Pass to a Satori `<img src>` inside an ImageResponse.
export function floodlitMarkDataUri(size: number, variant: Variant = 'tile'): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(floodlitMarkSvg(size, variant))}`;
}
