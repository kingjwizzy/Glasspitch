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
  twitter: { card: 'summary_large_image', title: RG_TITLE, description: RG_DESCRIPTION },
};

const SUPPORT_LINKS = [
  {
    name: 'National Gambling Helpline',
    href: 'tel:08088020133',
    display: '0808 8020 133',
    description:
      'Free, confidential support and information, 24 hours a day, every day — run by GamCare.',
  },
  {
    name: 'GamCare',
    href: 'https://www.gamcare.org.uk',
    display: 'gamcare.org.uk',
    description:
      'Information, advice and support for anyone affected by gambling harm, including free tools and treatment.',
  },
  {
    name: 'GAMSTOP',
    href: 'https://www.gamstop.co.uk',
    display: 'gamstop.co.uk',
    description: 'Free self-exclusion from all UK-licensed online gambling sites and apps.',
  },
  {
    name: 'GambleAware',
    href: 'https://www.gambleaware.org',
    display: 'gambleaware.org',
    description: 'Independent charity funding research, education and treatment for gambling harm.',
  },
] as const;

export default function ResponsibleGamblingPage() {
  return (
    <article className="space-y-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
        Responsible gambling
      </h1>

      <p className="text-fg-dim">
        <strong className="text-fg">{RESPONSIBLE_GAMBLING}</strong> Glass Pitch
        publishes football analysis and probabilities for context and
        entertainment. Nothing here is betting advice, a tip we guarantee, or an
        inducement to gamble. Probabilities describe uncertainty; they do not
        predict the future.
      </p>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          If you need support
        </h2>
        <ul className="space-y-3">
          {SUPPORT_LINKS.map((link) => (
            <li
              key={link.name}
              className="rounded-xl border border-line bg-surface p-4"
            >
              <a
                href={link.href}
                target={link.href.startsWith('http') ? '_blank' : undefined}
                rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                className="inline-flex min-h-11 items-center text-sm font-medium text-green transition-colors hover:text-green-bright"
              >
                {link.name} — {link.display}
              </a>
              <p className="mt-1 text-xs leading-relaxed text-fg-dim">
                {link.description}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          Staying in control
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-fg-dim">
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
