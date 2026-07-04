import { SITE_NAME } from '@/lib/constants';

// The Glass Pitch identity: the "Floodlit" mark (a floodlit glass tile with a
// green penalty arc + an amber "call" spot — pitch geometry only, no crest,
// ARCHITECTURE.md §13) beside the plain-text wordmark. The mark is purely
// decorative (aria-hidden); "Glass Pitch" stays real, selectable text so it
// carries the link's accessible name and the SEO wordmark. Server Component,
// zero client JS. The Satori icon/OG routes render the identical mark from the
// string twin in src/lib/logoMark.ts.
export default function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 32 32" aria-hidden="true" className="h-[26px] w-[26px] shrink-0">
        <defs>
          <clipPath id="gp-logo-c">
            <rect width="32" height="32" rx="7.5" />
          </clipPath>
          <radialGradient id="gp-logo-fl" cx="50%" cy="6%" r="72%">
            <stop offset="0" stopColor="#35B27A" stopOpacity=".34" />
            <stop offset=".55" stopColor="#35B27A" stopOpacity=".06" />
            <stop offset="1" stopColor="#35B27A" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g clipPath="url(#gp-logo-c)">
          <rect width="32" height="32" fill="#0E1311" />
          <rect width="32" height="32" fill="url(#gp-logo-fl)" />
          <line
            x1="6.5"
            y1="21"
            x2="25.5"
            y2="21"
            stroke="#35B27A"
            strokeWidth="1.4"
            strokeOpacity=".5"
            strokeLinecap="round"
          />
          <path d="M8 21A8 8 0 0 1 24 21" fill="none" stroke="#35B27A" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="16" cy="18.4" r="3.4" fill="#F2A33C" fillOpacity=".18" />
          <circle cx="16" cy="18.4" r="1.9" fill="#F2A33C" />
        </g>
        <rect x=".6" y=".6" width="30.8" height="30.8" rx="6.9" fill="none" stroke="#fff" strokeOpacity=".10" />
      </svg>
      <span className="font-display text-lg font-semibold tracking-tight text-fg">{SITE_NAME}</span>
    </span>
  );
}
