import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';

export const metadata = { title: 'KickStock Admin' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== 'admin') {
    redirect('/');
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0A0A0A', color: '#fff', fontFamily: 'monospace' }}>
      <nav style={{
        padding: '14px 24px', borderBottom: '1px solid #222',
        display: 'flex', alignItems: 'center', gap: 24,
      }}>
        <strong style={{ color: '#FFDB00', fontSize: 14 }}>⚽ KICKSTOCK ADMIN</strong>
        <Link href="/admin" style={{ color: '#ccc', fontSize: 13, textDecoration: 'none' }}>Compétitions</Link>
        <Link href="/admin/competitions/new" style={{ color: '#ccc', fontSize: 13, textDecoration: 'none' }}>+ Nouvelle</Link>
        <Link href="/" style={{ color: '#555', fontSize: 13, textDecoration: 'none', marginLeft: 'auto' }}>← App</Link>
      </nav>
      <main style={{ padding: '24px 32px' }}>
        {children}
      </main>
    </div>
  );
}
