import type { Metadata } from 'next';
import Link from 'next/link';
import { ANALYSIS_NOT_ADVICE, SITE_NAME, THIRD_PARTY_LABEL } from '@/lib/constants';

// /methodology — the trust/SEO deep page (ARCHITECTURE.md §7, §9, §10, §13),
// linked from /about and /ledger. Static (no DB read — every figure here is a
// formula/process description, not a live number), so it is the simplest kind
// of ISR: a plain static page. Written in the DESIGN.md §9 voice — a sharp,
// honest analyst — with the §9 disclaimer language verbatim.
const TITLE = 'Methodology — how the numbers work';
const DESCRIPTION =
  'Where our probabilities come from, what "locked at kickoff" means at the database level, exactly how we compute Brier score, log loss and calibration, and how to audit any single call end to end.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/methodology' },
  // Self-referential og:url + restated siteName (openGraph fully replaces the
  // layout's object — ARCHITECTURE.md §11).
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    url: '/methodology',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function MethodologyPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Methodology
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-fg-dim">
          How the probabilities are sourced, what &ldquo;locked&rdquo; actually
          means at the database level, exactly how we score a call, and how to
          check any single prediction yourself — timestamps, ledger row and
          result.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          Where the numbers come from
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          {THIRD_PARTY_LABEL} Every probability and predicted score shown on a
          match page is sourced from an established third-party football
          model — never our own guess, and always labelled as such.
          Alongside it, we quietly log a simple in-house Elo rating on every
          fixture, but we never show it and never let it influence the
          displayed call. Over time the ledger lets us compare the two
          honestly; we&rsquo;d only ever promote the in-house model if it
          earns its place on the scored record.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          Locked at kickoff
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          Every prediction is timestamped when it&rsquo;s published, and again
          when it locks — at the fixture&rsquo;s kickoff. Locking isn&rsquo;t
          a policy we promise to follow; it&rsquo;s enforced by the database
          itself. A trigger on the predictions table rejects any update to the
          probabilities, the predicted score, the model version or the source
          once the row&rsquo;s <code className="font-mono text-fg">locked_at</code> has
          passed. Only the scoring fields (final score, result, Brier score,
          log loss, scored-at) may still be written, and only after full time.
          If a prediction is ever published after its own kickoff, it&rsquo;s
          marked void and excluded from the scored record — integrity over
          coverage.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          How we score a call
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          Once a match finishes, every locked prediction is scored with two
          proper scoring rules — mathematical penalties for how well the
          whole probability distribution matched what actually happened, not
          just whether we picked the winner.
        </p>

        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-sm font-medium text-fg">Brier score</p>
          <p className="mt-1 font-mono text-xs text-fg-dim">
            BS = (p_home − y_home)² + (p_draw − y_draw)² + (p_away − y_away)²
          </p>
          <p className="mt-2 text-sm leading-relaxed text-fg-dim">
            where y is 1 for the outcome that happened and 0 for the other
            two. 0 is a perfect call, 2 is a confidently wrong one. We report
            the mean across every scored prediction.
          </p>
        </div>

        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-sm font-medium text-fg">Log loss</p>
          <p className="mt-1 font-mono text-xs text-fg-dim">LL = −ln(p_correct)</p>
          <p className="mt-2 text-sm leading-relaxed text-fg-dim">
            where p_correct is the probability we assigned to the outcome
            that actually happened, clipped to [1e-12, 1 − 1e-12] so it can
            never blow up. This punishes confident wrong calls much harder
            than Brier does — saying 95% and being wrong costs a lot more
            than saying 40% and being wrong.
          </p>
        </div>

        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-sm font-medium text-fg">Calibration</p>
          <p className="mt-2 text-sm leading-relaxed text-fg-dim">
            We bucket every probability we&rsquo;ve ever assigned into ten
            bands (0–10%, 10–20%, … 90–100%) and compare the average
            probability we predicted in each band to how often that outcome
            actually happened. Well-calibrated means the two columns roughly
            agree — our &ldquo;70%&rdquo; calls should come in around 70% of
            the time, not 40% or 95%. See the live table on the{' '}
            <Link href="/ledger" className="text-green underline transition-colors hover:text-green-bright">
              ledger
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          Why misses stay visible
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          Most tipster sites quietly delete or reframe their losses. We
          can&rsquo;t — the immutability trigger above means a scored
          prediction&rsquo;s original probabilities can never be edited, and
          we never remove a scored row from the ledger. Every miss counts
          fully in the mean Brier score and log loss, forever. That&rsquo;s
          the whole point: a track record you can verify is worth more than
          one you have to take on trust.
        </p>
      </section>

      <section id="hash-chain" className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          Sealed with a hash chain
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          The immutability trigger stops a scored row from being edited at
          the database level — but that only matters if you can check it
          from the outside, not just take our word for it. So every night, a
          job reads every scored prediction, oldest to newest, and folds it
          into a SHA-256 hash chain: each row&rsquo;s hash is computed from
          its own data plus the hash of the row before it, all the way back
          to a fixed starting point. Change, reorder or delete a single past
          result — even one probability, even one digit — and every hash from
          that point forward comes out different. The chain&rsquo;s current
          tip is published on{' '}
          <code className="font-mono text-fg">public.ledger_checkpoints</code>
          , a plain, anon-readable table alongside the ledger itself, so
          anyone can re-derive the same chain from our public data and
          confirm it matches — no trust required, just arithmetic.
          Tamper-evident, not just promised. See it applied on the{' '}
          <Link href="/ledger" className="text-green underline transition-colors hover:text-green-bright">
            ledger
          </Link>
          .
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          Audit any call yourself
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          Every match page shows the full paper trail for its call: when it
          was published, when it locked (always kickoff), and — once the
          match finishes — when it was scored. Pick any fixture from the{' '}
          <Link href="/matches" className="text-green underline transition-colors hover:text-green-bright">
            matches list
          </Link>
          , check those timestamps against its kickoff time, then find that
          same prediction&rsquo;s row, Brier score and log loss on the{' '}
          <Link href="/ledger" className="text-green underline transition-colors hover:text-green-bright">
            full ledger
          </Link>
          . Nothing about a scored call lives anywhere else, and nothing is
          summarised away.
        </p>
      </section>

      <div className="rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
        <p>{ANALYSIS_NOT_ADVICE}</p>
      </div>
    </article>
  );
}
