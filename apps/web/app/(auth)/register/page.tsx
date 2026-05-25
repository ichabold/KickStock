'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function RegisterPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [username, setUsername] = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [country,  setCountry]  = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);

    if (username.length < 3) {
      setError('Le pseudo doit faire au moins 3 caractères');
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, country: country || null },
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push('/');
      router.refresh();
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
        <div style={styles.subtitle}>WORLD CUP 2026 · TRADING GAME</div>

        <h1 style={styles.title}>CRÉER UN COMPTE</h1>

        <form onSubmit={handleRegister} style={styles.form}>
          <label style={styles.label}>PSEUDO *</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value.replace(/\s/g, ''))}
            required
            minLength={3}
            maxLength={20}
            placeholder="GoldenBoot99"
            style={styles.input}
          />
          <div style={styles.hint}>3–20 caractères, sans espaces</div>

          <label style={styles.label}>EMAIL *</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="joueur@email.com"
            style={styles.input}
          />

          <label style={styles.label}>MOT DE PASSE *</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="Min. 8 caractères"
            style={styles.input}
          />

          <label style={styles.label}>PAYS (optionnel)</label>
          <input
            type="text"
            value={country}
            onChange={e => setCountry(e.target.value)}
            placeholder="🇫🇷 France"
            maxLength={30}
            style={styles.input}
          />
          <div style={styles.hint}>Pour le classement par pays</div>

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" disabled={loading} style={styles.btn}>
            {loading ? 'CRÉATION…' : 'REJOINDRE LA PARTIE →'}
          </button>
        </form>

        <div style={styles.divider}/>

        <div style={styles.footer}>
          Déjà un compte ?{' '}
          <Link href="/login" style={styles.link}>SE CONNECTER</Link>
        </div>

        <div style={styles.guestRow}>
          <Link href="/" style={styles.guestLink}>Continuer sans compte →</Link>
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
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 9,
    letterSpacing: 2,
    color: '#666',
    fontWeight: 700,
    marginTop: 10,
  },
  hint: {
    fontSize: 9,
    color: '#444',
    marginTop: 2,
  },
  input: {
    background: '#181818',
    border: '1px solid #2E2E2E',
    borderRadius: 8,
    padding: '11px 14px',
    color: '#fff',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
  },
  error: {
    background: 'rgba(255,59,92,.1)',
    border: '1px solid #7A1B2C',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 12,
    color: '#FF3B5C',
    marginTop: 4,
  },
  btn: {
    marginTop: 16,
    background: '#FFDB00',
    color: '#000',
    border: 'none',
    borderRadius: 9,
    padding: '13px 0',
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 17,
    letterSpacing: 3,
    cursor: 'pointer',
  },
  divider: {
    height: 1,
    background: '#1E1E1E',
    margin: '24px 0 16px',
  },
  footer: {
    textAlign: 'center',
    fontSize: 12,
    color: '#666',
  },
  link: {
    color: '#FFDB00',
    textDecoration: 'none',
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: 1,
  },
  guestRow: {
    textAlign: 'center',
    marginTop: 12,
  },
  guestLink: {
    fontSize: 11,
    color: '#444',
    textDecoration: 'none',
    letterSpacing: 1,
  },
};
