import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME, SUPPORT_EMAIL } from '@/lib/constants';

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
          Who&rsquo;s responsible for this data
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          {SITE_NAME} is the data controller for the personal data described
          in this notice — we decide why and how it&rsquo;s processed. Contact
          us at{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="underline decoration-fg-dim/40 underline-offset-2 transition-colors hover:text-fg"
          >
            {SUPPORT_EMAIL}
          </a>{' '}
          about anything in this notice, including exercising the rights
          below.
        </p>
      </section>

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
          <li>
            If you play &ldquo;Beat the model&rdquo;: the match picks you save
            and the display name you choose for each pool. Pool members see
            that display name and — only once a fixture has kicked off — your
            picks for it; they never see your email address.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
          Matchday email
        </h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          If you subscribe to the matchday email (no account needed), we store
          your email address, the time you asked, and the time you confirmed.
          It&rsquo;s double opt-in: nothing is sent beyond a single
          confirmation email until you click the link inside it. The lawful
          basis is your consent, which you withdraw by using the one-click
          unsubscribe in any email — that takes effect immediately and deletes
          your address from our mailing records entirely, not just flags it.
          Emails are delivered by Resend, who process the address on our
          behalf.
        </p>
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
          Supabase (our database and authentication provider), Stripe (our
          payment processor) and Resend (email delivery, if you subscribe to
          the matchday email) — all process data on our behalf, under their
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
        <p className="text-sm text-fg-dim">
          Questions?{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="underline decoration-fg-dim/40 underline-offset-2 transition-colors hover:text-fg"
          >
            {SUPPORT_EMAIL}
          </a>
        </p>
      </section>
    </article>
  );
}
