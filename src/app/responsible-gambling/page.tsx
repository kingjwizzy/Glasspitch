import type { Metadata } from 'next';
import { RESPONSIBLE_GAMBLING, SITE_NAME } from '@/lib/constants';

const RG_TITLE = 'Responsible gambling & support';
const RG_DESCRIPTION =
  '18+. Glass Pitch is analysis, not betting advice. If gambling stops being fun, find support and self-exclusion resources here.';

export const metadata: Metadata = {
  title: RG_TITLE,
  description: RG_DESCRIPTION,
  alternates: { canonical: '/responsible-gambling' },
  // Self-referential og:url + restated siteName (openGraph fully replaces the
  // layout's object — ARCHITECTURE.md §11).
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: RG_TITLE,
    description: RG_DESCRIPTION,
    url: '/responsible-gambling',
  },
  twitter: { card: 'summary', title: RG_TITLE, description: RG_DESCRIPTION },
};

export default function ResponsibleGamblingPage() {
  return (
    <article className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Responsible gambling</h1>

      <p className="text-black/70 dark:text-white/70">
        <strong>{RESPONSIBLE_GAMBLING}</strong> Glass Pitch publishes football
        analysis and probabilities for context and entertainment. Nothing here is
        betting advice, a tip we guarantee, or an inducement to gamble.
        Probabilities describe uncertainty; they do not predict the future.
      </p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">If you need support</h2>
        {/* TODO [VERIFY YOURSELF — ARCHITECTURE.md §9, §16]: confirm the CURRENT
            official UK responsible-gambling resources at build time before
            launch. The support landscape is changing under the new statutory
            levy, so these names/links must be re-verified rather than assumed.
            Candidates to confirm and link:
              - National Gambling Helpline (operated by GamCare) — phone + chat
              - GamCare — gamcare.org.uk
              - GAMSTOP — gamstop.co.uk (free self-exclusion, UK-licensed sites)
              - GambleAware / BeGambleAware — begambleaware.org
            Replace this block with verified, linked resources before going live. */}
        <ul className="list-disc space-y-1 pl-5 text-black/70 dark:text-white/70">
          <li>
            National Gambling Helpline (GamCare) — details to be confirmed at
            launch.
          </li>
          <li>
            GAMSTOP — free self-exclusion from UK-licensed gambling sites — to be
            confirmed.
          </li>
          <li>GambleAware — information and support — to be confirmed.</li>
        </ul>
        <p className="text-xs text-black/60 dark:text-white/60">
          Links are intentionally left to be verified against current official
          guidance before launch.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Staying in control</h2>
        <ul className="list-disc space-y-1 pl-5 text-black/70 dark:text-white/70">
          <li>
            Treat any betting as paid entertainment, never as a way to make or
            recover money.
          </li>
          <li>Set time and money limits before you start, and keep them.</li>
          <li>
            Never chase losses. The probabilities here do not change that risk.
          </li>
        </ul>
      </section>
    </article>
  );
}
