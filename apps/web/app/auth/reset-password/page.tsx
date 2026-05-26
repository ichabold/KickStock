'use client';

/**
 * /auth/reset-password
 * Shown after the user clicks the password-reset link in their email.
 * The /auth/confirm route has already verified the OTP and established
 * a session — so supabase.auth.updateUser() will work here.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const router  = useRouter();
  const [password,  setPassword]  = useState('');
  const [password2, setPassword2] = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [done,      setDone]      = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError('Le mot de passe doit faire au moins 8 caractères.'); return; }
    if (password !== password2) { setError('Les mots de passe ne correspondent pas.'); return; }

    setLoading(true);
    setError('');

    const sb = createClient();
    const { error: err } = await sb.auth.updateUser({ password });

    if (err) {
      setError('Erreur lors de la mise à jour. Réessaie.');
      setLoading(false);
      return;
    }

    setDone(true);
    setTimeout(() => router.replace('/'), 2000);
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        {done ? (
          <>
            <div style={s.icon}>✓</div>
            <div style={s.title}>MOT DE PASSE MODIFIÉ</div>
            <div style={s.sub}>Tu vas être redirigé…</div>
          </>
        ) : (
          <>
            <div style={s.title}>NOUVEAU MOT DE PASSE</div>
            <div style={s.sub}>Choisis un nouveau mot de passe pour ton compte.</div>

            <form onSubmit={handleSubmit} style={s.form}>
              <div>
                <label style={s.label}>Nouveau mot de passe</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="8 caractères minimum"
                  autoFocus
                  style={s.input}
                />
              </div>
              <div>
                <label style={s.label}>Confirmer</label>
                <input
                  type="password"
                  value={password2}
                  onChange={e => setPassword2(e.target.value)}
                  placeholder="Même mot de passe"
                  style={s.input}
                />
              </div>

              {error && <div style={s.errorBox}>{error}</div>}

              <button
                type="submit"
                disabled={loading || password.length < 8 || password !== password2}
                style={{
                  ...s.btn,
                  opacity: (loading || password.length < 8 || password !== password2) ? 0.45 : 1,
                }}
              >
                {loading ? 'SAUVEGARDE…' : 'CONFIRMER →'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px 16px',
    background: 'var(--bg)',
  },
  card: {
    width: '100%',
    maxWidth: 360,
    background: 'var(--s1)',
    border: '1px solid var(--border-hi)',
    borderRadius: 20,
    padding: '32px 24px 28px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    textAlign: 'center',
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: '50%',
    background: 'rgba(0,255,135,.1)',
    border: '1px solid var(--gain-dk)',
    color: 'var(--gain)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    marginBottom: 4,
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 20,
    letterSpacing: 4,
    color: 'var(--text)',
  },
  sub: {
    fontSize: 12,
    color: 'var(--muted)',
    lineHeight: 1.6,
    marginBottom: 4,
  },
  form: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  label: {
    display: 'block',
    fontSize: 10,
    color: 'var(--muted)',
    letterSpacing: 1,
    marginBottom: 4,
    fontFamily: 'var(--font-display)',
  },
  input: {
    width: '100%',
    background: 'var(--s2)',
    border: '1px solid var(--border-hi)',
    borderRadius: 8,
    padding: '11px 14px',
    color: 'var(--text)',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'var(--font-body)',
    boxSizing: 'border-box' as const,
  },
  errorBox: {
    background: 'var(--loss-bg)',
    border: '1px solid var(--loss-dk)',
    borderRadius: 6,
    padding: '7px 10px',
    fontSize: 11,
    color: 'var(--loss)',
    textAlign: 'left' as const,
  },
  btn: {
    width: '100%',
    background: 'var(--gold)',
    color: '#000',
    border: 'none',
    borderRadius: 9,
    padding: '13px 0',
    fontFamily: 'var(--font-display)',
    fontSize: 15,
    letterSpacing: 3,
    cursor: 'pointer',
  },
};
