import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME } from '@/lib/constants';

const ABOUT_TITLE = 'About — analysis, not advice';
const ABOUT_DESCRIPTION =
  'What Glass Pitch is, how the probabilities are produced, and why we publish a permanent, losses-visible track record instead of asserting one.';

export const metadata: Metadata = {
  title: ABOUT_TITLE,
  description: ABOUT_DESCRIPTION,
  alternates: { canonical: '/about' },
  // Self-referential og:url + restated siteName (openGraph fully replaces the
  // layout's object — ARCHITECTURE.md §11).
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: ABOUT_TITLE,
    description: ABOUT_DESCRIPTION,
    url: '/about',
  },
  twitter: { card: 'summary_large_image', title: ABOUT_TITLE, description: ABOUT_DESCRIPTION },
};

export default function AboutPage() {
  return (
    <article className="space-y-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
        About Glass Pitch
      </h1>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          What this is
        </h2>
        <p className="text-fg-dim">
          Glass Pitch is a free, mobile-first football <strong>analysis</strong>{' '}
          site. For each match we show home/draw/away probabilities, a predicted
          score, recent form, and a short plain-language read of the matchup.
          This is analysis and probability — not a guarantee, and not regulated
          betting advice.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          Methodology
        </h2>
        <p className="text-fg-dim">
          v1 probabilities come from an established third-party model, clearly
          labelled as such on every match page. Alongside it we quietly log a
          simple in-house Elo rating so we can compare the two over time and only
          promote our own model if it earns its place on the scored record.
          Predictions are scored with proper scoring rules — the multiclass Brier
          score and log loss — plus a calibration check.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          Analysis, not advice
        </h2>
        <p className="text-fg-dim">
          Most tipster sites hide their losses and make claims you cannot verify.
          We do the opposite: every prediction is locked at kickoff and recorded
          in a permanent public{' '}
          <Link href="/ledger" className="text-green underline transition-colors hover:text-green-bright">
            ledger
          </Link>
          , wins and losses alike. We never present a prediction as a guaranteed
          tip, never imply it solves money problems, and never claim an edge over
          bookmakers.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          Staying responsible
        </h2>
        <p className="text-fg-dim">
          Football should stay fun. If betting stops being fun, please see our{' '}
          <Link
            href="/responsible-gambling"
            className="text-green underline transition-colors hover:text-green-bright"
          >
            responsible gambling
          </Link>{' '}
          page. 18+.
        </p>
      </section>
    </article>
  );
}
