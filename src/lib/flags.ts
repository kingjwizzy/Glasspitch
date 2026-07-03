// Team name → circle-flag code mapping (W4 owner request, build item 15).
//
// National flags are public-domain national symbols — legally distinct from the
// club-era crest/photo/tournament-mark ban (ARCHITECTURE.md §13), which stands.
// The SVGs live in /public/flags, vendored from HatScripts/circle-flags (MIT —
// see public/flags/LICENSE.txt). Codes are ISO 3166-1 alpha-2, except England
// and Scotland which are not ISO 3166-1 nations and use the set's ISO 3166-2:GB
// subdivision codes (gb-eng / gb-sct).
//
// Keys are the EXACT team names as stored in our DB (`teams.name`, verified
// against the live table on 2026-07-03 — the 48 WC2026 nations). An unmapped
// name (a renamed nation, or any club-era team in the future) degrades to NO
// flag — never a broken image — and the plain-text team name remains the
// primary identifier everywhere.

const TEAM_FLAG_CODES: Record<string, string> = {
  Algeria: 'dz',
  Argentina: 'ar',
  Australia: 'au',
  Austria: 'at',
  Belgium: 'be',
  'Bosnia & Herzegovina': 'ba',
  Brazil: 'br',
  Canada: 'ca',
  'Cape Verde Islands': 'cv',
  Colombia: 'co',
  'Congo DR': 'cd',
  Croatia: 'hr',
  Curaçao: 'cw',
  Czechia: 'cz',
  Ecuador: 'ec',
  Egypt: 'eg',
  England: 'gb-eng',
  France: 'fr',
  Germany: 'de',
  Ghana: 'gh',
  Haiti: 'ht',
  Iran: 'ir',
  Iraq: 'iq',
  'Ivory Coast': 'ci',
  Japan: 'jp',
  Jordan: 'jo',
  Mexico: 'mx',
  Morocco: 'ma',
  Netherlands: 'nl',
  'New Zealand': 'nz',
  Norway: 'no',
  Panama: 'pa',
  Paraguay: 'py',
  Portugal: 'pt',
  Qatar: 'qa',
  'Saudi Arabia': 'sa',
  Scotland: 'gb-sct',
  Senegal: 'sn',
  'South Africa': 'za',
  'South Korea': 'kr',
  Spain: 'es',
  Sweden: 'se',
  Switzerland: 'ch',
  Tunisia: 'tn',
  Türkiye: 'tr',
  Uruguay: 'uy',
  USA: 'us',
  Uzbekistan: 'uz',
};

/** Flag code for a DB team name, or null when unmapped (→ render no flag). */
export function flagCodeForTeam(name: string): string | null {
  return TEAM_FLAG_CODES[name] ?? null;
}
