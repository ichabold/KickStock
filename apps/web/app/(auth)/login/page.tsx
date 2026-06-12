'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { saveOAuthPending } from '@/lib/pseudo';
import { getDeviceId } from '@/lib/device';

export default function LoginPage() {
  const supabase = createClient();
  const t  = useTranslations('auth.login');
  const tw = useTranslations('authWidget');

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function handleGoogle() {
    setLoading(true);
    setError('');
    saveOAuthPending();
    document.cookie = `ks_pending_device=${getDeviceId()}; path=/; max-age=600; SameSite=Lax`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(tw('googleError'));
      setLoading(false);
    }
  }

  return (
    <div style={styles.bg}>
      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logoRow}>
          <span style={styles.logoIcon}>⚽</span>
          <span style={styles.logoText}>KICKSTOCK</span>
        </div>
        <div style={styles.subtitle}>{t('subtitle')}</div>

        <h1 style={styles.title}>{t('title')}</h1>

        <button onClick={handleGoogle} disabled={loading} style={{ ...styles.googleBtn, opacity: loading ? 0.6 : 1 }}>
          <span style={styles.googleIcon}>G</span>
          {loading ? tw('redirecting') : tw('continueGoogle')}
        </button>
        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.guestRow}>
          <Link href="/" style={styles.guestLink}>{t('continueGuest')}</Link>
        </div>

        <div style={styles.legalRow}>
          {t.rich('legalNotice', {
            terms: (chunks) => <Link href="/terms" style={styles.legalLink}>{chunks}</Link>,
            privacy: (chunks) => <Link href="/privacy" style={styles.legalLink}>{chunks}</Link>,
          })}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bg: {
    minHeight: '100dvh',
    background: '#0A0A0A',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    fontFamily: "'Inter Tight', sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: 400,
    background: '#111',
    border: '1px solid #1E1E1E',
    borderRadius: 16,
    padding: '32px 28px',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
    justifyContent: 'center',
  },
  logoIcon: { fontSize: 28 },
  logoText: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 28,
    letterSpacing: 4,
    color: '#FFDB00',
  },
  subtitle: {
    textAlign: 'center',
    fontSize: 9,
    letterSpacing: 2,
    color: '#444',
    fontWeight: 700,
    marginBottom: 28,
  },
  title: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 22,
    letterSpacing: 4,
    color: '#fff',
    marginBottom: 24,
    textAlign: 'center',
  },
  googleBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    background: '#fff',
    color: '#1a1a1a',
    border: 'none',
    borderRadius: 9,
    padding: '13px 0',
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 15,
    letterSpacing: 2,
    cursor: 'pointer',
  },
  googleIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: '#4285F4',
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    fontFamily: "'Inter Tight', sans-serif",
  },
  error: {
    background: 'rgba(255,59,92,.1)',
    border: '1px solid #7A1B2C',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 12,
    color: '#FF3B5C',
    marginTop: 12,
    textAlign: 'center',
  },
  guestRow: {
    textAlign: 'center',
    marginTop: 20,
  },
  guestLink: {
    fontSize: 11,
    color: '#444',
    textDecoration: 'none',
    letterSpacing: 1,
  },
  legalRow: {
    textAlign: 'center',
    marginTop: 16,
    fontSize: 10,
    color: '#444',
    lineHeight: 1.6,
  },
  legalLink: {
    color: '#666',
    textDecoration: 'underline',
  },
};
