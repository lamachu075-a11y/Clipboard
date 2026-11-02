'use client';

import dynamic from 'next/dynamic';

// The app reads the clipboard and browser storage, so it renders in the browser only.
const TableApp = dynamic(() => import('../components/TableApp.tsx'), {
  ssr: false,
  loading: () => <p className="loading">Loading Clipboard Extractor…</p>,
});

export default function Page() {
  return <TableApp />;
}
