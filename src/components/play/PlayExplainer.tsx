import Link from 'next/link';
import { ArrowRightIcon, CheckIcon, LockClosedIcon } from '@/components/icons';
import EmptyStateSpot from '@/components/art/EmptyStateSpot';

// What an anonymous visitor sees at /play: a plain, honest explainer with ONE
// sign-in affordance (DESIGN.md §6 — engagement through substance, no urgency,
// no dark patterns, prize-free forever). Static content, zero client JS.
export default function PlayExplainer() {
  return (
    <article className="mx-auto max-w-xl space-y-8">
      <header className="floodlight space-y-3 pt-2">
        <div className="rise-in flex items-start justify-between gap-4">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg lg:text-3xl">
            Beat the model
          </h1>
          {/* Pick-and-lock spot illustration (W6 visual pack) — decorative. */}
          <EmptyStateSpot variant="play" className="h-14 w-auto shrink-0" />
        </div>
        <p className="rise-in rise-in-1 text-base leading-relaxed text-fg-dim">
          We publish a locked, scored record of every call we make — wins and
          losses alike. Now you can keep one too. Call each match before
          kickoff, and see whether you read the game better than the model.
        </p>
      </header>

      <section aria-labelledby="how-heading" className="space-y-3">
        <h2 id="how-heading" className="font-display text-lg font-semibold tracking-tight text-fg">
          How it works
        </h2>
        <ol className="space-y-3">
          <li className="glass flex items-start gap-3 px-4 py-3.5">
            <span aria-hidden="true" className="mt-0.5 w-5 shrink-0 font-mono text-sm text-fg-faint">1</span>
            <p className="text-sm leading-relaxed text-fg-dim">
              <span className="font-medium text-fg">Call the probabilities.</span>{' '}
              Not just who wins — how sure you are. Quick-pick an outcome or
              fine-tune your own home/draw/away percentages.
            </p>
          </li>
          <li className="glass flex items-start gap-3 px-4 py-3.5">
            <span aria-hidden="true" className="mt-0.5 w-5 shrink-0 font-mono text-sm text-fg-faint">2</span>
            <p className="text-sm leading-relaxed text-fg-dim">
              <span className="font-medium text-fg">Locked at kickoff.</span>{' '}
              <LockClosedIcon className="mr-0.5 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
              Same discipline as our own ledger: edit freely until kickoff,
              then your pick is final — and misses stay on the record.
            </p>
          </li>
          <li className="glass flex items-start gap-3 px-4 py-3.5">
            <span aria-hidden="true" className="mt-0.5 w-5 shrink-0 font-mono text-sm text-fg-faint">3</span>
            <p className="text-sm leading-relaxed text-fg-dim">
              <span className="font-medium text-fg">Scored like ours.</span>{' '}
              <CheckIcon className="mr-0.5 inline h-3.5 w-3.5 align-[-2px] text-green" aria-hidden="true" />
              After full time every pick gets a Brier score — the same maths
              that scores the model. Lower means sharper. Beat its number and
              you beat the model, fair and square.
            </p>
          </li>
        </ol>
      </section>

      <section aria-labelledby="pools-heading" className="space-y-2">
        <h2 id="pools-heading" className="font-display text-lg font-semibold tracking-tight text-fg">
          Pools with friends
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          Start a private pool, share one invite link, and run a leaderboard
          across the round. Everyone&rsquo;s picks stay hidden until a fixture
          locks, so nobody can copy anybody.
        </p>
      </section>

      <section className="glass-raised px-5 py-5">
        <p className="text-sm leading-relaxed text-fg-dim">
          Free, and prize-free forever — no money, no streaks, no pressure.
          Just an honest scorecard, which is the whole point of this site.
        </p>
        <Link
          href="/login?next=/play"
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-green px-4 text-sm font-medium text-bg transition-colors hover:bg-green-bright"
        >
          Sign in to play
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
        <p className="mt-2 text-xs text-fg-faint">
          A free account — email and an 18+ confirmation, nothing else.
        </p>
      </section>
    </article>
  );
}
