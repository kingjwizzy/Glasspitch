import type { Metadata } from 'next';
import { Archivo, Hanken_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import DisclaimerBanner from '@/components/DisclaimerBanner';
import { SITE_NAME, SITE_URL } from '@/lib/constants';

// Three deliberate type roles (DESIGN.md §3), self-hosted via next/font with
// `display: swap` so there is no layout shift (§8 Core Web Vitals).
const archivo = Archivo({
  variable: '--font-archivo',
  subsets: ['latin'],
  display: 'swap',
});

const hanken = Hanken_Grotesk({
  variable: '--font-hanken',
  subsets: ['latin'],
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
});

const DEFAULT_DESCRIPTION =
  'Football match probabilities and predicted scores, framed as analysis — not betting advice. Every prediction is locked at kickoff and scored in a permanent public ledger, wins and losses alike.';

// Global metadata, title template and Open Graph defaults (ARCHITECTURE.md §4,
// §11, §12). metadataBase uses NEXT_PUBLIC_SITE_URL with a localhost fallback.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — transparent football analysis`,
    template: `%s · ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: `${SITE_NAME} — transparent football analysis`,
    description: DEFAULT_DESCRIPTION,
    // No default `url` here on purpose: a hardcoded og:url would be inherited by
    // every page that does not set its own openGraph, pointing all of their
    // share cards at the homepage. Each route declares its own self-referential
    // og:url instead (resolved against metadataBase). (ARCHITECTURE.md §11)
  },
  twitter: {
    // TODO(ARCHITECTURE.md §11): add a default OG/social image
    // (app/opengraph-image.tsx) and upgrade this to 'summary_large_image'.
    card: 'summary',
    title: `${SITE_NAME} — transparent football analysis`,
    description: DEFAULT_DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${hanken.variable} ${plexMono.variable} dark h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-bg text-fg">
        {/* Persistent disclaimer on every page (ARCHITECTURE.md §13). */}
        <DisclaimerBanner />
        <Header />
        <main className="mx-auto w-full max-w-screen-md flex-1 px-4 py-6">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
