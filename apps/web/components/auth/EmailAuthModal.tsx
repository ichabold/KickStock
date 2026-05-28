'use client';

/**
 * EmailAuthModal — Sign in / Sign up / Forgot password / Check email
 *
 * Props:
 *   defaultView  – which tab to open first ('signin' | 'signup')
 *   onClose      – called when the modal should be dismissed
 */

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isValidPseudoFormat, getPseudo, saveOAuthPending } from '@/lib/pseudo';
import { getDeviceId } from '@/lib/device';

type View = 'signin' | 'signup' | 'forgot' | 'check-email' | 'forgot-sent';

interface Props {
  defaultView?: 'signin' | 'signup';
  onClose: () => void;
}

export default function EmailAuthModal({ defaultView = 'signin', onClose }: Props) {
  const [view, setView] = useState<View>(defaultView);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.card} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={s.closeBtn}>✕</button>

        {(view === 'signin' || view === 'signup') && (
          <div style={s.tabs}>
            <button
              style={{ ...s.tab, ...(view === 'signin' ? s.tabActive : {}) }}
              onClick={() => setView('signin')}
            >
              CONNEXION
            </button>
            <button
              style={{ ...s.tab, ...(view === 'signup' ? s.tabActive : {}) }}
              onClick={() => setView('signup')}
            >
              INSCRIPTION
            </button>
          </div>
        )}

        {view === 'signin'       && <SignInView   onForgot={() => setView('forgot')} onClose={onClose} />}
        {view === 'signup'       && <SignUpView   onCheckEmail={() => setView('check-email')} onClose={onClose} />}
        {view === 'forgot'       && <ForgotView  onSent={() => setView('forgot-sent')} onBack={() => setView('signin')} />}
        {view === 'check-email'  && <CheckEmailView onClose={onClose} />}
        {view === 'forgot-sent'  && <ForgotSentView onClose={onClose} />}
      </div>
    </div>
  );
}

// ─── Sign In ──────────────────────────────────────────────────────────────────

function SignInView({ onForgot, onClose }: { onForgot: () => void; onClose: () => void }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');

    const sb = createClient();
    const { error: err } = await sb.auth.signInWithPassword({ email: email.trim(), password });

    if (err) {
      setError(err.message === 'Invalid login credentials'
        ? 'Email ou mot de passe incorrect.'
        : 'Erreur de connexion. Réessaie.');
      setLoading(false);
      return;
    }

    // Refresh so useAuth picks up the new session
    window.location.reload();
  }

  return (
    <form onSubmit={handleSubmit} style={s.form}>
      <Field label="Email" type="email" value={email} onChange={setEmail}
             placeholder="ton@email.com" autoFocus />
      <Field label="Mot de passe" type="password" value={password} onChange={setPassword}
             placeholder="••••••••" />

      {error && <div style={s.errorBox}>{error}</div>}

      <button type="submit" disabled={loading || !email || !password} style={s.submitBtn}>
        {loading ? 'CONNEXION…' : 'SE CONNECTER →'}
      </button>

      <button type="button" onClick={onForgot} style={s.linkBtn}>
        Mot de passe oublié ?
      </button>

      <Divider />
      <GoogleBtn />
    </form>
  );
}

// ─── Sign Up ──────────────────────────────────────────────────────────────────

function SignUpView({ onCheckEmail, onClose }: { onCheckEmail: () => void; onClose: () => void }) {
  // Pre-fill with the guest pseudo if the player already chose one
  const guestPseudo = getPseudo();
  const [pseudo,    setPseudo]    = useState(guestPseudo ?? '');
  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [pseudoState, setPseudoState] = useState<'idle' | 'checking' | 'ok' | 'taken'>('idle');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  // Immediately verify the pre-filled guest pseudo availability
  useEffect(() => {
    if (guestPseudo && isValidPseudoFormat(guestPseudo)) {
      checkPseudo(guestPseudo);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkPseudo(value: string) {
    if (!isValidPseudoFormat(value)) { setPseudoState('idle'); return; }
    setPseudoState('checking');
    const res  = await fetch(`/api/auth/check-pseudo?q=${encodeURIComponent(value)}`);
    const data = await res.json();
    setPseudoState(data.available ? 'ok' : 'taken');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimPseudo = pseudo.trim();
    const trimEmail  = email.trim().toLowerCase();
    if (loading || pseudoState === 'taken' || pseudoState === 'checking') return;
    if (!isValidPseudoFormat(trimPseudo)) { setError('Pseudo invalide (3-20 caractères, lettres/chiffres/_-).'); return; }
    if (password.length < 8) { setError('Le mot de passe doit faire au moins 8 caractères.'); return; }

    setLoading(true);
    setError('');

    // Check if email already exists before calling signUp (Supabase silently
    // accepts duplicate signups when "prevent enumeration" is on).
    try {
      const chk  = await fetch(`/api/auth/check-email?q=${encodeURIComponent(trimEmail)}`);
      const chkData = await chk.json() as { exists?: boolean; confirmed?: boolean };
      if (chkData.exists) {
        setError(
          chkData.confirmed
            ? 'Cet email est déjà utilisé. Connecte-toi ou utilise « Mot de passe oublié ».'
            : 'Un email de confirmation a déjà été envoyé à cette adresse. Vérifie ta boîte mail.',
        );
        setLoading(false);
        return;
      }
    } catch {
      // If the check fails, proceed anyway — signUp will catch the duplicate.
    }

    // Set pending device cookie for portfolio migration (same as Google flow)
    document.cookie = `ks_pending_device=${getDeviceId()}; path=/; max-age=600; SameSite=Lax`;

    const sb = createClient();
    const { data, error: err } = await sb.auth.signUp({
      email: trimEmail,
      password,
      options: {
        data: { username: trimPseudo },
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    });

    if (err) {
      if (err.message.toLowerCase().includes('already registered')) {
        setError('Cet email est déjà utilisé. Connecte-toi ou utilise « Mot de passe oublié ».');
      } else {
        setError('Erreur lors de l\'inscription. Réessaie.');
      }
      setLoading(false);
      return;
    }

    // Supabase may return success with empty identities when enumeration
    // protection is on but the email is already taken.
    if (!data.user || (data.user.identities ?? []).length === 0) {
      setError('Cet email est déjà utilisé. Connecte-toi ou utilise « Mot de passe oublié ».');
      setLoading(false);
      return;
    }

    onCheckEmail();
  }

  const canSubmit = isValidPseudoFormat(pseudo.trim())
    && pseudoState === 'ok'
    && email.includes('@')
    && password.length >= 8
    && !loading;

  return (
    <form onSubmit={handleSubmit} style={s.form}>
      <div>
        <label style={s.label}>Pseudo</label>
        <div style={{ position: 'relative' }}>
          <input
            value={pseudo}
            onChange={e => { setPseudo(e.target.value); setPseudoState('idle'); setError(''); }}
            onBlur={() => { if (pseudo.trim()) checkPseudo(pseudo.trim()); }}
            placeholder="Ton pseudo (3-20 car.)"
            maxLength={20}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            style={{
              ...s.input,
              borderColor: pseudoState === 'taken' ? 'var(--loss)'
                : pseudoState === 'ok' ? 'var(--gain-dk)'
                : 'var(--border-hi)',
            }}
          />
          {pseudoState === 'checking' && <span style={s.hint}>…</span>}
          {pseudoState === 'ok'       && <span style={{ ...s.hint, color: 'var(--gain)' }}>✓</span>}
        </div>
        {pseudoState === 'taken' && (
          <div style={{ ...s.errorBox, marginTop: 4 }}>Pseudo déjà pris.</div>
        )}
      </div>

      <Field label="Email" type="email" value={email} onChange={setEmail}
             placeholder="ton@email.com" />
      <Field label="Mot de passe" type="password" value={password} onChange={setPassword}
             placeholder="8 caractères minimum" />

      {error && <div style={s.errorBox}>{error}</div>}

      <button type="submit" disabled={!canSubmit} style={{ ...s.submitBtn, opacity: canSubmit ? 1 : 0.45 }}>
        {loading ? 'CRÉATION…' : 'CRÉER MON COMPTE →'}
      </button>

      <Divider />
      <GoogleBtn />
    </form>
  );
}

// ─── Forgot password ──────────────────────────────────────────────────────────

function ForgotView({ onSent, onBack }: { onSent: () => void; onBack: () => void }) {
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || !email.includes('@')) return;
    setLoading(true);
    setError('');

    const sb = createClient();
    const { error: err } = await sb.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/confirm`,
    });

    if (err) {
      setError('Erreur lors de l\'envoi. Réessaie.');
      setLoading(false);
      return;
    }

    onSent();
  }

  return (
    <form onSubmit={handleSubmit} style={s.form}>
      <div style={s.infoTitle}>MOT DE PASSE OUBLIÉ</div>
      <div style={s.infoSub}>Saisis ton email et on t&apos;envoie un lien de réinitialisation.</div>

      <Field label="Email" type="email" value={email} onChange={setEmail}
             placeholder="ton@email.com" autoFocus />

      {error && <div style={s.errorBox}>{error}</div>}

      <button type="submit" disabled={loading || !email.includes('@')} style={s.submitBtn}>
        {loading ? 'ENVOI…' : 'ENVOYER LE LIEN →'}
      </button>

      <button type="button" onClick={onBack} style={s.linkBtn}>
        ← Retour à la connexion
      </button>
    </form>
  );
}

// ─── Check email screen ───────────────────────────────────────────────────────

function CheckEmailView({ onClose }: { onClose: () => void }) {
  return (
    <div style={{ ...s.form, alignItems: 'center', textAlign: 'center' }}>
      <div style={s.bigIcon}>✉</div>
      <div style={s.infoTitle}>VÉRIFIE TES EMAILS</div>
      <div style={s.infoSub}>
        On t&apos;a envoyé un lien de confirmation.<br />
        Clique dessus pour activer ton compte.
      </div>
      <button onClick={onClose} style={{ ...s.submitBtn, marginTop: 8 }}>
        OK
      </button>
    </div>
  );
}

function ForgotSentView({ onClose }: { onClose: () => void }) {
  return (
    <div style={{ ...s.form, alignItems: 'center', textAlign: 'center' }}>
      <div style={s.bigIcon}>✓</div>
      <div style={s.infoTitle}>EMAIL ENVOYÉ</div>
      <div style={s.infoSub}>
        Vérifie ta boîte mail et clique sur le lien<br />
        pour réinitialiser ton mot de passe.
      </div>
      <button onClick={onClose} style={{ ...s.submitBtn, marginTop: 8 }}>
        OK
      </button>
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function Field({
  label, type, value, onChange, placeholder, autoFocus,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label style={s.label}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        style={s.input}
      />
    </div>
  );
}

function Divider() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span style={{ fontSize: 10, color: 'var(--dim)', letterSpacing: 1 }}>OU</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

function GoogleBtn() {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function handleGoogle() {
    setLoading(true);
    setError('');
    saveOAuthPending(); // persist guest pseudo before page navigates away
    document.cookie = `ks_pending_device=${getDeviceId()}; path=/; max-age=600; SameSite=Lax`;
    const sb = createClient();
    const { error: err } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (err) {
      setError('Connexion Google échouée. Réessaie.');
      setLoading(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={handleGoogle} disabled={loading} style={s.googleBtn}>
        <span style={s.googleIcon}>G</span>
        {loading ? 'Redirection…' : 'Continuer avec Google'}
      </button>
      {error && <div style={{ ...s.errorBox, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 560,
    background: 'rgba(0,0,0,0.88)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px 16px',
    animation: 'fadeIn .15s ease-out',
  },
  card: {
    width: '100%',
    maxWidth: 380,
    background: 'var(--s1)',
    border: '1px solid var(--border-hi)',
    borderRadius: 20,
    padding: '24px 24px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    animation: 'slideUp .2s ease-out',
    position: 'relative',
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 16,
    background: 'none',
    border: 'none',
    color: 'var(--dim)',
    fontSize: 14,
    cursor: 'pointer',
    padding: '2px 6px',
    lineHeight: 1,
  },
  tabs: {
    display: 'flex',
    gap: 0,
    marginBottom: 20,
    borderBottom: '1px solid var(--border)',
  },
  tab: {
    flex: 1,
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: 'var(--dim)',
    fontSize: 11,
    fontFamily: 'var(--font-display)',
    letterSpacing: 2,
    padding: '8px 0 10px',
    cursor: 'pointer',
    marginBottom: -1,
    transition: 'color .15s, border-color .15s',
  },
  tabActive: {
    color: 'var(--text)',
    borderBottomColor: 'var(--gold)',
  },
  form: {
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
    transition: 'border-color .15s',
  },
  hint: {
    position: 'absolute' as const,
    right: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: 12,
    color: 'var(--muted)',
    pointerEvents: 'none' as const,
  },
  errorBox: {
    background: 'var(--loss-bg)',
    border: '1px solid var(--loss-dk)',
    borderRadius: 6,
    padding: '7px 10px',
    fontSize: 11,
    color: 'var(--loss)',
    boxSizing: 'border-box' as const,
  },
  submitBtn: {
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
    transition: 'opacity .15s',
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--dim)',
    fontSize: 11,
    cursor: 'pointer',
    padding: '2px 0',
    fontFamily: 'var(--font-body)',
    textAlign: 'left' as const,
  },
  googleBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    background: 'var(--s2)',
    border: '1px solid var(--border-hi)',
    borderRadius: 8,
    padding: '10px 14px',
    color: 'var(--text)',
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    fontWeight: 500,
    transition: 'border-color .15s',
    boxSizing: 'border-box' as const,
  },
  googleIcon: {
    width: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 14,
    flexShrink: 0,
  },
  infoTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 18,
    letterSpacing: 3,
    color: 'var(--text)',
  },
  infoSub: {
    fontSize: 12,
    color: 'var(--muted)',
    lineHeight: 1.6,
  },
  bigIcon: {
    fontSize: 36,
    lineHeight: 1,
    marginBottom: 4,
  },
};
