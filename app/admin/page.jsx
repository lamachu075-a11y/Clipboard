'use client';

import dynamic from 'next/dynamic';

// Reads browser storage, so it renders in the browser only.
const AdminApp = dynamic(() => import('../../components/AdminApp.jsx'), {
  ssr: false,
  loading: () => <p className="loading">Loading admin panel…</p>,
});

export default function AdminPage() {
  return <AdminApp />;
}
