import 'server-only';

// Shared infrastructure for the dynamic Open Graph share kit (W6;
// ROADMAP.md §4 item 3). Everything here is read at render time from the
// LOCAL filesystem — vendored fonts + vendored flag SVGs — so the OG routes
// make zero network calls (CSP/compliance-safe, and the §5 golden rule is
// untouchable: never a football-API call from the web layer).
//
// The literal `join(process.cwd(), ...)` paths below are what Next's output
// file tracing keys on; next.config.ts additionally pins the fonts and the
// flag directory into the traced bundle for the OG routes (dynamic per-code
// flag reads can't be statically traced).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { flagCodeForTeam } from '@/lib/flags';

// DESIGN.md §2 tokens, restated as plain values for ImageResponse (satori
// renders outside the CSS-variable cascade).
export const OG_TOKENS = {
  bg: '#0e1311',
  surface: '#161d1a',
  surface2: '#1e2723',
  line: 'rgba(255,255,255,0.08)',
  fg: '#eaf0ec',
  fgDim: '#9da8a2',
  fgFaint: '#6b746f',
  green: '#35b27a',
  home: '#4c9aff',
  draw: '#8a938f',
  away: '#f2a33c',
  miss: '#f2555a',
} as const;

// The compliance footer every share card carries (ARCHITECTURE.md §13 — the
// disclaimer is baked in, share surfaces included).
export const OG_DISCLAIMER =
  'Analysis, not betting advice · 18+ · please gamble responsibly';

export interface OgFont {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 600;
  style: 'normal';
}

let fontsPromise: Promise<OgFont[]> | null = null;

/** The brand faces for ImageResponse (DESIGN.md §3): Archivo SemiBold for
 *  display text, IBM Plex Mono for every number. Vendored TTFs (satori can't
 *  consume next/font's woff2 output) read once and cached for the process. */
export function loadOgFonts(): Promise<OgFont[]> {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      readFile(join(process.cwd(), 'src/assets/og/Archivo-SemiBold.ttf')),
      readFile(join(process.cwd(), 'src/assets/og/IBMPlexMono-Regular.ttf')),
      readFile(join(process.cwd(), 'src/assets/og/IBMPlexMono-Medium.ttf')),
    ]).then(([archivo, mono, monoMedium]) => [
      { name: 'Archivo', data: archivo, weight: 600 as const, style: 'normal' as const },
      { name: 'IBM Plex Mono', data: mono, weight: 400 as const, style: 'normal' as const },
      {
        name: 'IBM Plex Mono',
        data: monoMedium,
        weight: 500 as const,
        style: 'normal' as const,
      },
    ]);
  }
  return fontsPromise;
}

const flagUriCache = new Map<string, string | null>();

/** The vendored circle-flag for a team name as a data URI (satori renders
 *  <img> from data URIs without any network fetch), or null when unmapped /
 *  unreadable — callers degrade to the plain-text initial disc, mirroring
 *  components/TeamFlag.tsx. Codes come only from our own static map, so the
 *  path is never attacker-influenced. */
export async function flagDataUri(team: string): Promise<string | null> {
  const code = flagCodeForTeam(team);
  if (!code) return null;
  const cached = flagUriCache.get(code);
  if (cached !== undefined) return cached;
  try {
    const svg = await readFile(join(process.cwd(), 'public/flags', `${code}.svg`));
    const uri = `data:image/svg+xml;base64,${svg.toString('base64')}`;
    flagUriCache.set(code, uri);
    return uri;
  } catch {
    flagUriCache.set(code, null);
    return null;
  }
}
