import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

const base = process.env.NEXT_PUBLIC_BASE_PATH || '';

export const metadata: Metadata = {
  title: 'Clipboard Extractor',
  description: 'Automatically reads your clipboard, extracts emails, phones, URLs, dates, amounts and custom fields, and collects them in a table.',
  manifest: `${base}/manifest.webmanifest`,
  icons: { icon: `${base}/icons/icon32.png`, apple: `${base}/icons/icon192.png` },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2563eb',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
