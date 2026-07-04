import { ImageResponse } from 'next/og';
import { getLedgerData } from '@/lib/queries/ledger';
import { pct } from '@/lib/format';
import { SITE_NAME } from '@/lib/constants';
import { loadOgFonts, OG_DISCLAIMER, OG_TOKENS as T } from '@/lib/og';

// /ledger share card (RAMBO wave 2 #2), mirroring the match/chances OG routes:
// Supabase read + the local vendored fonts only — zero network calls at
// render time (§5 golden rule; src/lib/og.ts). Unlike those two, this route
// needs no per-team flag lookups (the ledger's subject is the aggregate
// record, not any one team), so only the fonts are pinned in
// next.config.ts's outputFileTracingIncludes for this route.
//
// Shows the SAME headline numbers as the page itself (getLedgerData()) — the
// running mean Brier/log loss and the hit count — so the shared image can
// never disagree with the page a visitor lands on.

export const alt = 'The ledger — Glass Pitch';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 600;

const MONO = 'IBM Plex Mono';

function fmt(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

export default async function LedgerOpengraphImage() {
  const [{ summary }, fonts] = await Promise.all([getLedgerData(), loadOgFonts()]);

  if (summary.count === 0) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 22,
            background: T.bg,
            color: T.fg,
            fontFamily: 'Archivo',
          }}
        >
          <div style={{ display: 'flex', fontSize: 58 }}>The ledger</div>
          <div style={{ display: 'flex', fontSize: 28, color: T.fgDim }}>
            Every prediction, locked at kickoff and scored either way — record
            opens soon
          </div>
          <div
            style={{
              display: 'flex',
              fontFamily: MONO,
              fontSize: 22,
              color: T.green,
              marginTop: 12,
            }}
          >
            glasspitch.com/ledger
          </div>
        </div>
      ),
      { ...size, fonts },
    );
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '56px 64px 44px',
          background: T.bg,
          color: T.fg,
          fontFamily: 'Archivo',
        }}
      >
        <div style={{ display: 'flex', fontFamily: MONO, fontSize: 22, color: T.fgDim }}>
          {SITE_NAME} · The ledger
        </div>

        {/* headline: the running record, hits included */}
        <div style={{ display: 'flex', marginTop: 36, fontSize: 60, fontWeight: 600 }}>
          {summary.hits} of {summary.count} calls landed
        </div>
        <div style={{ display: 'flex', marginTop: 14, fontSize: 30, color: T.fgDim }}>
          Every prediction locked at kickoff, scored either way — misses
          included{summary.hitRate !== null ? ` (${pct(summary.hitRate)})` : ''}.
        </div>

        {/* mean scores row — the proper accountability metrics, not just hit rate */}
        <div style={{ display: 'flex', gap: 24, marginTop: 48 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: '20px 28px',
              borderRadius: 16,
              background: T.surface,
              border: `1px solid ${T.line}`,
            }}
          >
            <div style={{ display: 'flex', fontFamily: MONO, fontSize: 40, fontWeight: 500 }}>
              {fmt(summary.meanBrier)}
            </div>
            <div style={{ display: 'flex', fontSize: 20, color: T.fgDim }}>
              Mean Brier score — 0 best, 2 worst
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: '20px 28px',
              borderRadius: 16,
              background: T.surface,
              border: `1px solid ${T.line}`,
            }}
          >
            <div style={{ display: 'flex', fontFamily: MONO, fontSize: 40, fontWeight: 500 }}>
              {fmt(summary.meanLogLoss)}
            </div>
            <div style={{ display: 'flex', fontSize: 20, color: T.fgDim }}>
              Mean log loss — punishes confident misses
            </div>
          </div>
        </div>

        {/* compliance footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 'auto',
            paddingTop: 28,
            borderTop: `1px solid ${T.line}`,
            fontSize: 20,
            color: T.fgDim,
          }}
        >
          <div style={{ display: 'flex' }}>{OG_DISCLAIMER}</div>
          <div style={{ display: 'flex', color: T.green }}>glasspitch.com/ledger</div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
