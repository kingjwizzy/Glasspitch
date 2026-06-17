import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import DisclaimerBanner from '@/components/DisclaimerBanner';
import { SITE_NAME, SITE_URL } from '@/lib/constants';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
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
    url: '/',
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
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
