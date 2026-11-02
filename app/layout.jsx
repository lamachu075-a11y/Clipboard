import './globals.css';

const base = process.env.NEXT_PUBLIC_BASE_PATH || '';

export const metadata = {
  title: 'Clipboard Extractor',
  description: 'Automatically reads your clipboard, extracts emails, phones, URLs, dates, amounts and custom fields, and collects them in a table.',
  manifest: `${base}/manifest.webmanifest`,
  icons: { icon: `${base}/icons/icon32.png`, apple: `${base}/icons/icon192.png` },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2563eb',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
