// Small round national-flag mark next to a team name (W4 build item 15).
//
// Flag SVGs vendored from HatScripts/circle-flags (MIT licensed —
// https://github.com/HatScripts/circle-flags; full license text in
// public/flags/LICENSE.txt). National flags are public-domain national
// symbols — NOT covered by the ARCHITECTURE.md §13 crest/photo/tournament-mark
// ban, which stands for club-era IP.
//
// Strictly decorative: alt="" + aria-hidden, because the plain-text team name
// remains the primary identifier everywhere (a11y, and the club-era future
// where flags don't exist). An unmapped team name renders NOTHING — never a
// broken image (flagCodeForTeam returns null and we bail).

import { flagCodeForTeam } from '@/lib/flags';

export interface TeamFlagProps {
  /** Team name exactly as stored in the DB. */
  name: string;
  /** `row` ≈ 18px (fixture rows / lists); `hero` ≈ 28px (match headers). */
  size?: 'row' | 'hero';
  className?: string;
}

const SIZE_PX: Record<NonNullable<TeamFlagProps['size']>, number> = {
  row: 18,
  hero: 28,
};

export default function TeamFlag({ name, size = 'row', className }: TeamFlagProps) {
  const code = flagCodeForTeam(name);
  if (!code) return null;
  const px = SIZE_PX[size];
  return (
    // Plain <img>, not next/image: these are tiny local SVGs (≈1–4KB) where the
    // optimizer adds nothing (and would need dangerouslyAllowSVG); width/height
    // are fixed so there is zero CLS.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/flags/${code}.svg`}
      alt=""
      aria-hidden="true"
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      className={`inline-block shrink-0 rounded-full ${className ?? ''}`}
    />
  );
}
