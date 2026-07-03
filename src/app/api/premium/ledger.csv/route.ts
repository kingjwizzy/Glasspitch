import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from '@/lib/auth/viewer';
import { getFullLedgerRows } from '@/lib/queries/ledger';
import { predictedPick, outcomeName } from '@/lib/format';
import { toCsv } from '@/lib/csv';

// GET /api/premium/ledger.csv — streams the FULL scored ledger as CSV
// (ARCHITECTURE.md §4 v2). The underlying rows are the same free-forever
// ledger data anyone can already read on /ledger; what's gated here is the
// bulk-export CONVENIENCE, enforced in application code via getViewer()
// (never an RLS gate — predictions/fixtures stay anon-readable). Not in the
// middleware matcher (only /api/stripe/* is), so this route performs its own
// auth+entitlement check inline, same pattern as /match/[id]/insights.
export const runtime = 'nodejs';

const COLUMNS = [
  'fixture_id',
  'kickoff_utc',
  'league',
  'home',
  'away',
  'prob_home',
  'prob_draw',
  'prob_away',
  'predicted_home_goals',
  'predicted_away_goals',
  'final_home_goals',
  'final_away_goals',
  'pick',
  'result',
  'hit',
  'brier_score',
  'log_loss',
];

export async function GET(request: NextRequest) {
  const { user, isPremium } = await getViewer();
  if (!user) {
    return NextResponse.redirect(
      new URL('/login?next=/api/premium/ledger.csv', request.url),
      303,
    );
  }
  if (!isPremium) {
    return NextResponse.redirect(new URL('/premium', request.url), 303);
  }

  const supabase = await createClient();
  const rows = await getFullLedgerRows(supabase);

  const csv = toCsv(
    COLUMNS,
    rows.map((r) => {
      const probs = { home: r.prob_home, draw: r.prob_draw, away: r.prob_away };
      const pick = predictedPick(probs);
      return [
        r.fixtureId,
        r.kickoffUtc,
        r.league,
        r.home,
        r.away,
        r.prob_home,
        r.prob_draw,
        r.prob_away,
        r.predicted_home_goals,
        r.predicted_away_goals,
        r.final_home_goals,
        r.final_away_goals,
        outcomeName(pick, r.home, r.away),
        r.result,
        r.hit,
        r.brier_score,
        r.log_loss,
      ];
    }),
  );

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="glasspitch-ledger.csv"',
      'Cache-Control': 'private, no-store',
    },
  });
}
