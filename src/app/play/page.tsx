import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import PlayExplainer from '@/components/play/PlayExplainer';
import PickCard from '@/components/play/PickCard';
import SettledPickReveal from '@/components/play/SettledPickReveal';
import { ArrowRightIcon } from '@/components/icons';
import {
  buildMyRecordVsModel,
  getMyPicks,
  getMySettledPicks,
  getOpenPickFixtures,
  type MyPick,
} from '@/lib/queries/play';
import { dayLabel, formatKickoff, metric3, utcDateKey } from '@/lib/format';

// /play — the "Beat the Model" game (ARCHITECTURE.md §5 v3 game-picks
// amendment; DESIGN.md §6). An AUTHED, DYNAMIC segment: it reads the session
// cookie, so it is deliberately force-dynamic and never cached — the public
// ISR surface elsewhere is untouched. Interactive islands (PickCard) are
// allowed here and only here. Anonymous visitors get a static explainer with
// a single sign-in affordance instead.
export const dynamic = 'force-dynamic';

const TITLE = 'Play — beat the model';
const DESCRIPTION =
  'Call home/draw/away probabilities before kickoff, locked at kickoff and Brier-scored like our own ledger. Free and prize-free — run private pools with friends.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/play' },
  openGraph: { type: 'website', title: TITLE, description: DESCRIPTION, url: '/play' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

/** A saved pick's fractions → whole percentages that total exactly 100. */
function toPercentTrio(p: MyPick): [number, number, number] {
  const raw = [p.prob_home, p.prob_draw, p.prob_away].map((v) =>
    Math.max(0, Math.min(100, Math.round(v * 100))),
  ) as [number, number, number];
  const diff = 100 - (raw[0] + raw[1] + raw[2]);
  if (diff !== 0) {
    const iMax = raw.indexOf(Math.max(...raw)) as 0 | 1 | 2;
    raw[iMax] = Math.max(0, Math.min(100, raw[iMax] + diff));
  }
  return raw;
}

export default async function PlayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return <PlayExplainer />;

  const nowIso = new Date().toISOString();
  const [fixtures, picks, settled] = await Promise.all([
    getOpenPickFixtures(supabase, nowIso),
    getMyPicks(supabase, user.id),
    getMySettledPicks(supabase, user.id),
  ]);

  // Group open fixtures by UTC day, in kickoff order.
  const days = new Map<string, typeof fixtures>();
  for (const f of fixtures) {
    const key = utcDateKey(f.kickoff_utc);
    const list = days.get(key);
    if (list) list.push(f);
    else days.set(key, [f]);
  }

  // Private per-user summary (RAMBO wave 2 #5) — a pure aggregate over the
  // SAME `settled` read above, no extra DB call. Shown for any signed-in user
  // with scored picks, independent of their /leaderboard opt-in: opting in
  // only controls whether this record is ALSO published publicly.
  const myRecord = buildMyRecordVsModel(settled);

  return (
    <article className="mx-auto max-w-xl space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Beat the model
        </h1>
        <p className="text-sm leading-relaxed text-fg-dim">
          Call each fixture before kickoff. Picks lock at kickoff and get a
          Brier score after full time — the same maths that scores the model.
          Lower is sharper.
        </p>
        <Link
          href="/play/pools"
          className="inline-flex min-h-11 items-center gap-1 text-sm text-green transition-colors hover:text-green-bright"
        >
          Your pools
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </Link>
      </header>

      {myRecord.scored > 0 && (
        <section aria-labelledby="my-record-heading" className="glass px-4 py-4">
          <h2
            id="my-record-heading"
            className="font-display text-lg font-semibold tracking-tight text-fg"
          >
            Your record vs the model
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-fg-dim">Scored picks</dt>
              <dd className="mt-0.5 font-mono font-medium text-fg">{myRecord.scored}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-dim">Your mean Brier</dt>
              <dd className="mt-0.5 font-mono font-medium text-fg">
                {myRecord.meanBrier !== null ? metric3(myRecord.meanBrier) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-dim">Model, same picks</dt>
              <dd className="mt-0.5 font-mono text-fg-dim">
                {myRecord.modelMeanBrier !== null ? metric3(myRecord.modelMeanBrier) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-dim">Margin</dt>
              <dd
                className={`mt-0.5 font-mono font-medium ${
                  myRecord.margin !== null && myRecord.margin > 0
                    ? 'text-green'
                    : 'text-fg-dim'
                }`}
              >
                {myRecord.margin !== null
                  ? `${myRecord.margin > 0 ? '+' : ''}${metric3(myRecord.margin)}`
                  : '—'}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-fg-dim">
            Every scored pick counts above, misses included. Margin compares
            your mean Brier to the model&rsquo;s over the{' '}
            {myRecord.comparable} pick{myRecord.comparable === 1 ? '' : 's'}{' '}
            where it also made a scored call — positive means you&rsquo;re
            ahead of it so far.
          </p>
          <Link
            href="/leaderboard"
            className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm text-green transition-colors hover:text-green-bright"
          >
            See the public leaderboard
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </section>
      )}

      {fixtures.length === 0 ? (
        <div className="glass px-4 py-5">
          <p className="text-sm leading-relaxed text-fg-dim">
            No fixtures are open for picks right now — the next round appears
            here as soon as its fixtures are published. Nothing to chase in
            the meantime; your saved picks are already locked in.
          </p>
        </div>
      ) : (
        [...days.entries()].map(([key, dayFixtures]) => (
          <section key={key} aria-label={dayLabel(dayFixtures[0].kickoff_utc, nowIso)}>
            <h2 className="mb-3 font-display text-lg font-semibold tracking-tight text-fg">
              {dayLabel(dayFixtures[0].kickoff_utc, nowIso)}
            </h2>
            <ul className="space-y-4">
              {dayFixtures.map((f) => {
                const mine = picks.get(f.id) ?? null;
                return (
                  <PickCard
                    key={f.id}
                    fixtureId={f.id}
                    home={f.home}
                    away={f.away}
                    league={f.league}
                    kickoffLabel={formatKickoff(f.kickoff_utc)}
                    initialPick={mine ? toPercentTrio(mine) : null}
                    model={f.model}
                  />
                );
              })}
            </ul>
          </section>
        ))
      )}

      <section aria-labelledby="settled-heading">
        <h2
          id="settled-heading"
          className="mb-3 font-display text-lg font-semibold tracking-tight text-fg"
        >
          Your results
        </h2>
        {settled.length === 0 ? (
          <div className="glass px-4 py-5">
            <p className="text-sm leading-relaxed text-fg-dim">
              Your settled calls show up here once your matches finish — wins
              and losses alike.
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {settled.map((pick) => (
              <SettledPickReveal key={pick.id} pick={pick} />
            ))}
          </ul>
        )}
      </section>

      {/* fg-dim, not fg-faint (a11y audit fix): a policy statement a visitor
          needs to read before saving a pick, not an incidental hint —
          fg-faint fails WCAG AA below 18px. */}
      <p className="text-xs leading-relaxed text-fg-dim">
        Free and prize-free forever — no money, no prizes, no streaks. Picks
        can&rsquo;t be deleted once saved (misses stay on the record, exactly
        like ours), but you can adjust them any time before kickoff.
      </p>
    </article>
  );
}
