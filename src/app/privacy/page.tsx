import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME } from '@/lib/constants';

const PRIVACY_TITLE = 'Privacy notice';
const PRIVACY_DESCRIPTION =
  'What Glass Pitch collects, why, how long we keep it, and how to ask us to delete it.';

export const metadata: Metadata = {
  title: PRIVACY_TITLE,
  description: PRIVACY_DESCRIPTION,
  alternates: { canonical: '/privacy' },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: PRIVACY_TITLE,
    description: PRIVACY_DESCRIPTION,
    url: '/privacy',
  },
  twitter: { card: 'summary_large_image', title: PRIVACY_TITLE, description: PRIVACY_DESCRIPTION },
};

export default function PrivacyPage() {
  return (
    <article className="space-y-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
        Privacy notice
      </h1>

      <p className="text-sm leading-relaxed text-fg-dim">
        Browsing {SITE_NAME} — every match, team, league and ledger page — needs
        no account and involves no personal data at all. The football data
        (fixtures, predictions, results) comes from licensed providers, not
        from you. This notice covers the small amount of personal data we hold
        for anyone who creates a Glass Pitch Premium account.
      </p>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          What we collect
        </h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-fg-dim">
          <li>Your email address, to send a magic sign-in link and, if you opt in, occasional updates.</li>
          <li>The 18+ confirmation you give when signing in.</li>
          <li>Authentication cookies that keep you signed in (via Supabase Auth).</li>
          <li>
            Billing metadata (your subscription status, plan and renewal date)
            that our payment processor, Stripe, sends us after checkout. We
            never see or store your card number — Stripe handles payment
            details directly.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          Why (lawful basis)
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          We process your email and sign-in to perform our contract with
          you (providing the account and subscription you asked for). We
          process billing metadata to perform that same contract and to meet
          our legal obligations (accounting and tax records). If you opt in to
          marketing updates, that&rsquo;s on the basis of your consent, which
          you can withdraw at any time.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          How long we keep it
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          For as long as your account exists, plus what UK tax law requires us
          to retain for billing records afterwards. Delete your account at any
          time from{' '}
          <Link href="/account" className="text-green underline hover:text-green-bright">
            your account page
          </Link>{' '}
          and we delete your account and subscription record immediately,
          subject to that legal retention requirement for billing records.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          Who we share it with
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          Supabase (our database and authentication provider) and Stripe (our
          payment processor) — both process data on our behalf, under their
          own security and privacy commitments. We do not sell your data, and
          we do not run ads or share your data with advertisers.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          Your rights
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          Under UK GDPR you can ask to access, correct, or delete your
          personal data, or ask us what we hold. Use the self-serve deletion
          on your account page for the fastest route, or contact us directly
          for anything else. If you&rsquo;re unhappy with how we&rsquo;ve
          handled your data, you can complain to the UK Information
          Commissioner&rsquo;s Office (ico.org.uk).
        </p>
      </section>

      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-dim">
        Draft pending professional (legal) review — this page has not yet been
        signed off and should not be relied on as final before that review
        completes.
      </p>
    </article>
  );
}
