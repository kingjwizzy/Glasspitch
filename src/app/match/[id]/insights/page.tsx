import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMatchData } from '@/lib/queries/match';
import { getFixtureInsights } from '@/lib/queries/insights';
import { getViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import InsightsPanel from '@/components/match/InsightsPanel';
import { parseId } from '../page';
import { ANALYSIS_NOT_ADVICE } from '@/lib/constants';

// /match/[id]/insights — the premium "deeper read" (ARCHITECTURE.md §4, §7 v2
// amendment). Deliberately a SEPARATE route from the cached, viewer-agnostic
// /match/[id] page (not embedded in it) so a per-user, cookie-bound read never
// forces the public match page dynamic. Not in the middleware matcher (only
// /login, /auth/*, /account/*, /premium/*, /api/stripe/* are) — this route
// does its own auth+entitlement check inline instead. Noindexed and never
// linked from the public nav/sitemap until premium goes live (§13).
export const dynamic = 'force-dynamic';

interface InsightsPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: InsightsPageProps): Promise<Metadata> {
  const { id } = await params;
  const match = await getMatchData(parseId(id));
  return {
    title: match ? `Deeper read — ${match.home} v ${match.away}` : 'Deeper read',
    robots: { index: false, follow: false },
  };
}

export default async function MatchInsightsPage({ params }: InsightsPageProps) {
  const { id } = await params;
  const fixtureId = parseId(id);
  const match = await getMatchData(fixtureId);
  if (!match) notFound();

  const { user, isPremium } = await getViewer();
  const backLink = `/match/${fixtureId}`;

  return (
    <article className="space-y-6">
      <header className="space-y-1">
        <Link
          href={backLink}
          className="inline-flex min-h-11 items-center text-sm font-medium text-fg-dim transition-colors hover:text-fg"
        >
          ← {match.home} v {match.away}
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Deeper read
        </h1>
      </header>

      {!user ? (
        <div className="rounded-2xl border border-line bg-surface p-5">
          <p className="text-sm leading-relaxed text-fg-dim">
            Prediction detail and post-match stats for this fixture are part of
            Glass Pitch Premium. The full ledger and every match&rsquo;s
            probabilities stay free without an account —{' '}
            <Link
              href={`/login?next=/match/${fixtureId}/insights`}
              className="text-green underline transition-colors hover:text-green-bright"
            >
              sign in
            </Link>{' '}
            if you already subscribe, or{' '}
            <Link href="/premium" className="text-green underline transition-colors hover:text-green-bright">
              see what Premium includes
            </Link>
            .
          </p>
        </div>
      ) : !isPremium ? (
        <div className="rounded-2xl border border-line bg-surface p-5">
          <p className="text-sm leading-relaxed text-fg-dim">
            Prediction detail and post-match stats for this fixture are part of
            Glass Pitch Premium — £4/month or £29/year. The full ledger and
            every match&rsquo;s probabilities stay free forever either way.{' '}
            <Link href="/premium" className="text-green underline transition-colors hover:text-green-bright">
              See what&rsquo;s included
            </Link>
            .
          </p>
        </div>
      ) : (
        <InsightsContent fixtureId={fixtureId} />
      )}

      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
        {ANALYSIS_NOT_ADVICE}
      </p>
    </article>
  );
}

/** Split out so the premium DB read only ever runs for a confirmed premium
 *  viewer, through their own per-request client (RLS proves entitlement). */
async function InsightsContent({ fixtureId }: { fixtureId: number }) {
  const supabase = await createClient();
  const insights = await getFixtureInsights(supabase, fixtureId);
  return <InsightsPanel insights={insights} />;
}
