import './globals.css';
import type { Metadata } from 'next';
import { GlobalRefreshProvider } from '@/components/GlobalRefreshProvider';

const APP_TITLE = 'Dinodia Platform';
const APP_DESCRIPTION =
  'Dinodia smart home portal for the Dinodia Hub (Home Assistant)';
const BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
  'http://localhost:3000';

export const metadata: Metadata = {
  title: APP_TITLE,
  description: APP_DESCRIPTION,
  metadataBase: new URL(BASE_URL),
  icons: {
    icon: [
      { url: '/favicon.ico', rel: 'icon' },
      { url: '/brand/logo-mark.png', type: 'image/png', sizes: '512x512' },
    ],
    shortcut: '/favicon.ico',
    apple: '/brand/logo-mark.png',
  },
  openGraph: {
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    images: [
      {
        url: '/brand/logo-mark.png',
        width: 512,
        height: 512,
        alt: 'Dinodia Smart Living logo',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    images: ['/brand/logo-mark.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-100 text-slate-900 antialiased">
        <GlobalRefreshProvider>
          <div className="min-h-screen">{children}</div>
        </GlobalRefreshProvider>
      </body>
    </html>
  );
}
