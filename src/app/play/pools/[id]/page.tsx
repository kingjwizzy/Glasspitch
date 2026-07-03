import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import CopyInviteLink from '@/components/play/CopyInviteLink';
import {
  getPoolDetail,
  type PoolDetail,
  type PoolFixtureView,
  type PoolPickView,
} from '@/lib/queries/play';
import {
  formatDateShort,
  formatKickoff,
  metric3,
  pctFigure,
  scoreLine,
  utcDateKey,
} from '@/lib/format';
import { SITE_URL } from '@/lib/constants';

// /play/pools/[id] — one pool's leaderboard (ARCHITECTURE.md §5 v3 game-picks
// amendment). Authed + dynamic; everything the viewer sees here is exactly
// what THEIR OWN RLS-scoped read returns: other members' picks only surface
// once a fixture has locked (the database enforces that — this page just
// says so plainly and renders whatever comes back). Private: noindexed.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pool leaderboard',
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PoolPageProps {
  params: Promise<{ id: string }>;
}

interface LeaderboardRow {
  userId: string;
  name: string;
  scored: number;
  meanBrier: number | null;
  /** The model's mean Brier over the SAME fixtures this member was scored on
   *  (apples to apples), or null when no overlap exists yet. */
  modelMeanBrier: number | null;
}

function buildLeaderboard(pool: PoolDetail): LeaderboardRow[] {
  const byMember = new Map<string, PoolPickView[]>();
  for (const pick of pool.picks) {
    if (pick.brier_score === null) continue;
    const list = byMember.get(pick.user_id);
    if (list) list.push(pick);
    else byMember.set(pick.user_id, [pick]);
  }

  const rows = pool.members.map((m) => {
    const scoredPicks = byMember.get(m.user_id) ?? [];
    const meanBrier =
      scoredPicks.length > 0
        ? scoredPicks.reduce((s, p) => s + (p.brier_score as number), 0) /
          scoredPicks.length
        : null;
    // Model comparison over the same fixtures only (apples to apples).
    const pairs = scoredPicks
      .map((p) => pool.fixtures.get(p.fixture_id)?.model?.brier_score)
      .filter((b): b is number => b !== null && b !== undefined);
    const modelMeanBrier =
      pairs.length > 0 ? pairs.reduce((s, b) => s + b, 0) / pairs.length : null;
    return {
      userId: m.user_id,
      name: m.display_name,
      scored: scoredPicks.length,
      meanBrier,
      modelMeanBrier,
    };
  });

  rows.sort((x, y) => {
    if (x.meanBrier === null && y.meanBrier === null)
      return x.name.localeCompare(y.name);
    if (x.meanBrier === null) return 1;
    if (y.meanBrier === null) return -1;
    return x.meanBrier - y.meanBrier || x.name.localeCompare(y.name);
  });
  return rows;
}

/** Scored picks grouped by the fixture's UTC match day, newest day first. */
function buildRounds(pool: PoolDetail): Array<{
  dayKey: string;
  label: string;
  rows: Array<{ name: string; scored: number; meanBrier: number }>;
}> {
  const nameByUser = new Map(pool.members.map((m) => [m.user_id, m.display_name]));
  const byDay = new Map<string, Map<string, number[]>>();

  for (const pick of pool.picks) {
    if (pick.brier_score === null) continue;
    const fixture = pool.fixtures.get(pick.fixture_id);
    if (!fixture) continue;
    const dayKey = utcDateKey(fixture.kickoff_utc);
    const day = byDay.get(dayKey) ?? new Map<string, number[]>();
    const scores = day.get(pick.user_id) ?? [];
    scores.push(pick.brier_score);
    day.set(pick.user_id, scores);
    byDay.set(dayKey, day);
  }

  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6)
    .map(([dayKey, day]) => ({
      dayKey,
      label: formatDateShort(`${dayKey}T00:00:00Z`),
      rows: [...day.entries()]
        .map(([userId, scores]) => ({
          name: nameByUser.get(userId) ?? 'Former member',
          scored: scores.length,
          meanBrier: scores.reduce((s, v) => s + v, 0) / scores.length,
        }))
        .sort((x, y) => x.meanBrier - y.meanBrier || x.name.localeCompare(y.name)),
    }));
}

/** Locked fixtures (kickoff passed) that have at least one visible pick,
 *  newest first. */
function buildLockedFixtures(pool: PoolDetail, nowIso: string): PoolFixtureView[] {
  const withPicks = new Set(pool.picks.map((p) => p.fixture_id));
  return [...pool.fixtures.values()]
    .filter((f) => f.kickoff_utc <= nowIso && withPicks.has(f.id))
    .sort((a, b) => b.kickoff_utc.localeCompare(a.kickoff_utc))
    .slice(0, 8);
}

function MonoTrio({ h, d, a }: { h: number; d: number; a: number }) {
  return (
    <span className="font-mono text-xs text-fg-dim">
      H {pctFigure(h)} · D {pctFigure(d)} · A {pctFigure(a)}
    </span>
  );
}

export default async function PoolPage({ params }: PoolPageProps) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/play/pools/${id}`)}`);

  const pool = await getPoolDetail(supabase, id);
  if (!pool) notFound();

  const nowIso = new Date().toISOString();
  const leaderboard = buildLeaderboard(pool);
  const rounds = buildRounds(pool);
  const lockedFixtures = buildLockedFixtures(pool, nowIso);
  const nameByUser = new Map(pool.members.map((m) => [m.user_id, m.display_name]));
  const inviteUrl = `${SITE_URL}/play/join/${pool.invite_code}`;
  const anyScored = leaderboard.some((r) => r.scored > 0);

  return (
    <article className="mx-auto max-w-xl space-y-8">
      <header className="space-y-2">
        <Link
          href="/play/pools"
          className="inline-flex min-h-11 items-center text-sm font-medium text-fg-dim transition-colors hover:text-fg"
        >
          ← Your pools
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          {pool.name}
        </h1>
        <p className="text-sm text-fg-dim">
          {pool.members.length} member{pool.members.length === 1 ? '' : 's'} ·
          prize-free, scored on Brier — lower&nbsp;=&nbsp;sharper.
        </p>
      </header>

      <section aria-labelledby="invite-heading" className="glass px-4 py-4">
        <h2
          id="invite-heading"
          className="font-display text-base font-semibold tracking-tight text-fg"
        >
          Invite a friend
        </h2>
        <p className="mt-1 text-xs text-fg-dim">
          Anyone with this link can join the pool.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap rounded-lg border border-line bg-surface px-3 py-2.5 font-mono text-xs text-fg">
            {inviteUrl}
          </code>
          <CopyInviteLink url={inviteUrl} />
        </div>
      </section>

      <section aria-labelledby="leaderboard-heading">
        <h2
          id="leaderboard-heading"
          className="mb-1 font-display text-lg font-semibold tracking-tight text-fg"
        >
          Leaderboard
        </h2>
        <p className="mb-3 max-w-[44ch] text-xs leading-relaxed text-fg-dim">
          Brier measures the gap between the probabilities you gave and what
          happened: 0 is a perfect call, 2 is confidently wrong. The mean over
          all scored picks decides the table — lower is sharper.
        </p>
        {!anyScored ? (
          <div className="glass px-4 py-5">
            <p className="text-sm leading-relaxed text-fg-dim">
              No scored picks yet — the table fills in after the first locked
              fixture finishes and the scoring job runs.
            </p>
          </div>
        ) : (
          <div className="glass overflow-x-auto px-4 py-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-fg-dim">
                  <th scope="col" className="py-2.5 pr-2 font-normal" aria-label="Rank" />
                  <th scope="col" className="py-2.5 pr-3 font-normal">
                    Member
                  </th>
                  <th scope="col" className="py-2.5 pr-3 text-right font-normal">
                    Scored
                  </th>
                  <th scope="col" className="py-2.5 pr-3 text-right font-normal">
                    Brier
                  </th>
                  <th scope="col" className="py-2.5 text-right font-normal">
                    Model, same picks
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {leaderboard.map((row, i) => {
                  const beatModel =
                    row.meanBrier !== null &&
                    row.modelMeanBrier !== null &&
                    row.meanBrier < row.modelMeanBrier;
                  return (
                    <tr key={row.userId}>
                      <td
                        aria-hidden="true"
                        className="py-3 pr-2 font-mono text-xs text-fg-faint"
                      >
                        {row.meanBrier === null ? '—' : i + 1}
                      </td>
                      <td className="max-w-36 truncate py-3 pr-3 text-fg">
                        {row.name}
                        {row.userId === user.id && (
                          <span className="ml-1 text-xs text-fg-dim">(you)</span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-right font-mono text-fg-dim">
                        {row.scored}
                      </td>
                      <td className="py-3 pr-3 text-right font-mono font-medium text-fg">
                        {row.meanBrier === null ? '—' : metric3(row.meanBrier)}
                      </td>
                      <td className="py-3 text-right font-mono text-fg-dim">
                        {row.modelMeanBrier === null ? '—' : metric3(row.modelMeanBrier)}
                        {beatModel && (
                          <span className="ml-1.5 text-xs font-sans text-green">
                            beaten
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {rounds.length > 0 && (
        <section aria-labelledby="rounds-heading">
          <h2
            id="rounds-heading"
            className="mb-3 font-display text-lg font-semibold tracking-tight text-fg"
          >
            By match day
          </h2>
          <div className="space-y-4">
            {rounds.map((round) => (
              <div key={round.dayKey} className="glass px-4 py-3">
                <h3 className="text-sm font-medium text-fg">{round.label}</h3>
                <ul className="mt-2 divide-y divide-line">
                  {round.rows.map((r) => (
                    <li
                      key={`${round.dayKey}-${r.name}`}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="min-w-0 truncate text-sm text-fg-dim">
                        {r.name}
                      </span>
                      <span className="shrink-0 font-mono text-sm text-fg">
                        {metric3(r.meanBrier)}
                        <span className="ml-1.5 text-xs text-fg-dim">
                          over {r.scored}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="picks-heading">
        <h2
          id="picks-heading"
          className="mb-1 font-display text-lg font-semibold tracking-tight text-fg"
        >
          Picks, fixture by fixture
        </h2>
        <p className="mb-3 max-w-[44ch] text-xs leading-relaxed text-fg-dim">
          Picks appear here only once a fixture locks at kickoff — before
          that, everyone&rsquo;s stay hidden from everyone (the database
          enforces this, not just the page).
        </p>
        {lockedFixtures.length === 0 ? (
          <div className="glass px-4 py-5">
            <p className="text-sm leading-relaxed text-fg-dim">
              Nothing has locked yet — check back after the next kickoff.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {lockedFixtures.map((f) => {
              const fixturePicks = pool.picks
                .filter((p) => p.fixture_id === f.id)
                .sort((a, b) =>
                  (a.brier_score ?? 9) - (b.brier_score ?? 9) ||
                  (nameByUser.get(a.user_id) ?? '').localeCompare(
                    nameByUser.get(b.user_id) ?? '',
                  ),
                );
              const finished =
                f.status === 'finished' &&
                f.final_home_goals !== null &&
                f.final_away_goals !== null;
              return (
                <div key={f.id} className="glass px-4 py-3">
                  <h3 className="text-sm font-medium text-fg">
                    {f.home} v {f.away}
                    {finished && (
                      <span className="ml-2 font-mono">
                        {scoreLine(f.final_home_goals!, f.final_away_goals!)}
                      </span>
                    )}
                  </h3>
                  <p className="mt-0.5 text-xs text-fg-dim">
                    {finished ? 'Full time' : `Locked — ${formatKickoff(f.kickoff_utc)}`}
                  </p>
                  <ul className="mt-2 divide-y divide-line">
                    {f.model && (
                      <li className="flex items-center justify-between gap-3 py-2">
                        <span className="min-w-0 truncate text-sm text-fg">
                          The model
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          <MonoTrio
                            h={f.model.prob_home}
                            d={f.model.prob_draw}
                            a={f.model.prob_away}
                          />
                          <span className="w-14 text-right font-mono text-sm text-fg">
                            {f.model.brier_score === null
                              ? '—'
                              : metric3(f.model.brier_score)}
                          </span>
                        </span>
                      </li>
                    )}
                    {fixturePicks.map((p) => (
                      <li
                        key={`${f.id}-${p.user_id}`}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <span className="min-w-0 truncate text-sm text-fg-dim">
                          {nameByUser.get(p.user_id) ?? 'Former member'}
                          {p.user_id === user.id && (
                            <span className="ml-1 text-xs">(you)</span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          <MonoTrio h={p.prob_home} d={p.prob_draw} a={p.prob_away} />
                          <span className="w-14 text-right font-mono text-sm text-fg">
                            {p.brier_score === null ? '—' : metric3(p.brier_score)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </article>
  );
}
