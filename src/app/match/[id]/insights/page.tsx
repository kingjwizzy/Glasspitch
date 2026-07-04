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

// The 4 things Premium actually adds (mirrors /premium's INCLUDED list —
// kept local/literal here rather than shared, per the ownership split: this
// file doesn't import from /premium and vice versa).
const VALUE_ITEMS = [
  'Prediction detail',
  'Post-match xG & stats',
  'Ledger CSV export',
  'Ledger filters',
] as const;

const MOCK_ROWS = [
  'Expected goals',
  'Shots on target',
  'Big chances',
  'Possession',
  'xG against',
  'Corners',
] as const;

/** A purely decorative, static mockup of what an unlocked insights card looks
 *  like — NOT real fixture_insights data (never fetched for a non-entitled
 *  viewer, RLS aside). Blurred + `aria-hidden` so it reads unambiguously as a
 *  locked preview, not content, to sighted and screen-reader users alike. */
function InsightsMock() {
  return (
    <div aria-hidden="true" className="select-none blur-[5px]">
      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="h-4 w-36 rounded bg-surface-2" />
          <div className="h-3 w-16 rounded bg-surface-2" />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          {MOCK_ROWS.map((label) => (
            <div key={label}>
              <dt className="text-xs text-fg-dim">{label}</dt>
              <dd className="mt-0.5 font-mono font-medium text-fg">—.—</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** The paywall itself, shared by the logged-out and logged-in-non-premium
 *  branches: what premium adds, the price (both branches, per audit #4 —
 *  previously missing when logged out), and a single filled primary CTA.
 *  `showSignIn` is true only when logged out (someone who already subscribes
 *  but isn't recognised on this device/browser). */
function PremiumTeaser({ fixtureId, showSignIn }: { fixtureId: number; showSignIn: boolean }) {
  return (
    <section aria-labelledby="teaser-heading" className="space-y-4">
      <h2 id="teaser-heading" className="font-display text-lg font-semibold tracking-tight text-fg">
        See the deeper read
      </h2>

      <div className="relative overflow-hidden rounded-2xl border border-line">
        <InsightsMock />
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-surface/50 via-surface/85 to-surface p-6">
          <p className="max-w-xs text-center text-sm font-medium leading-relaxed text-fg-dim">
            A locked preview — subscribe to unlock the real detail for every
            fixture.
          </p>
        </div>
      </div>

      <ul className="grid gap-2 text-sm text-fg-dim sm:grid-cols-2">
        {VALUE_ITEMS.map((item) => (
          <li key={item} className="flex items-center gap-2">
            <span aria-hidden="true" className="text-green">
              ✓
            </span>
            {item}
          </li>
        ))}
      </ul>

      <p className="text-sm font-medium text-fg">£6/month or £39/year</p>

      <p className="text-xs leading-relaxed text-fg-dim">
        The full ledger and every match&rsquo;s probabilities stay free,
        forever, either way.
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          href="/premium"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-green px-4 text-sm font-semibold text-bg transition-colors hover:bg-green-bright"
        >
          Go Premium
          <span aria-hidden="true">→</span>
        </Link>
        {showSignIn ? (
          <Link
            href={`/login?next=/match/${fixtureId}/insights`}
            className="inline-flex min-h-11 items-center text-sm font-medium text-fg-dim underline transition-colors hover:text-fg"
          >
            Already subscribe? Sign in
          </Link>
        ) : null}
      </div>
    </section>
  );
}

export default async function MatchInsightsPage({ params }: InsightsPageProps) {
  const { id } = await params;
  const fixtureId = parseId(id);
  const match = await getMatchData(fixtureId);
  if (!match) notFound();

  const { user, isPremium } = await getViewer();
  const backLink = `/match/${fixtureId}`;

  return (
    <article className="min-h-[70vh] space-y-6">
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
        <PremiumTeaser fixtureId={fixtureId} showSignIn />
      ) : !isPremium ? (
        <PremiumTeaser fixtureId={fixtureId} showSignIn={false} />
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
