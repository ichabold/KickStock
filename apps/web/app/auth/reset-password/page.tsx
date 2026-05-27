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
import styles from './page.module.css';

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
    <div className={styles.page}>
      <div className={styles.card}>
        {done ? (
          <>
            <div className={styles.icon}>✓</div>
            <div className={styles.title}>MOT DE PASSE MODIFIÉ</div>
            <div className={styles.sub}>Tu vas être redirigé…</div>
          </>
        ) : (
          <>
            <div className={styles.title}>NOUVEAU MOT DE PASSE</div>
            <div className={styles.sub}>Choisis un nouveau mot de passe pour ton compte.</div>

            <form onSubmit={handleSubmit} className={styles.form}>
              <div>
                <label className={styles.label}>Nouveau mot de passe</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="8 caractères minimum"
                  autoFocus
                  className={styles.input}
                />
              </div>
              <div>
                <label className={styles.label}>Confirmer</label>
                <input
                  type="password"
                  value={password2}
                  onChange={e => setPassword2(e.target.value)}
                  placeholder="Même mot de passe"
                  className={styles.input}
                />
              </div>

              {error && <div className={styles.errorBox}>{error}</div>}

              <button
                type="submit"
                disabled={loading || password.length < 8 || password !== password2}
                className={styles.btn}
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
