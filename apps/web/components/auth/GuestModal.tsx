'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getDeviceId } from '@/lib/device';
import { getPseudo, setPseudo, isValidPseudoFormat } from '@/lib/pseudo';
import EmailAuthModal from '@/components/auth/EmailAuthModal';
import { useGameStore } from '@/stores/gameStore';

interface Props {
  onDone: () => void;
}

type PseudoState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export default function GuestModal({ onDone }: Props) {
  const [visible, setVisible]       = useState(false);
  const [pseudo,  setPseudoVal]     = useState('');
  const [state,   setPseudoState]   = useState<PseudoState>('idle');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Show modal only if no session AND no saved pseudo
  useEffect(() => {
    async function check() {
      if (getPseudo()) return; // already a guest
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) setVisible(true);
    }
    check();
  }, []);

  // Focus input when modal becomes visible
  useEffect(() => {
    if (visible) setTimeout(() => inputRef.current?.focus(), 100);
  }, [visible]);

  const checkAvailability = useCallback(async (value: string) => {
    if (!isValidPseudoFormat(value)) {
      setPseudoState('invalid');
      return;
    }
    setPseudoState('checking');
    setSuggestion(null);
    try {
      const res = await fetch(`/api/auth/check-pseudo?q=${encodeURIComponent(value)}`);
      const data = await res.json();
      if (data.available) {
        setPseudoState('available');
      } else {
        setPseudoState('taken');
        setSuggestion(data.suggestion ?? null);
      }
    } catch {
      setPseudoState('idle'); // network error — let submit handle it
    }
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setPseudoVal(val);
    setPseudoState('idle');
    setSuggestion(null);
    setSubmitError(null);
  }

  function handleBlur() {
    if (pseudo.trim()) checkAvailability(pseudo.trim());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = pseudo.trim();
    if (!isValidPseudoFormat(trimmed) || submitting) return;

    setSubmitting(true);
    setSubmitError(null);

    // Always check availability on submit — no need to blur first.
    // If we already know it's taken (state='taken'), bail immediately.
    if (state === 'taken') {
      setSubmitError('Ce pseudo est déjà pris.');
      setSubmitting(false);
      return;
    }
    if (state !== 'available') {
      // Not yet checked (idle) or still checking from onBlur — do it now inline.
      try {
        const chk = await fetch(`/api/auth/check-pseudo?q=${encodeURIComponent(trimmed)}`);
        const chkData = await chk.json();
        if (!chkData.available) {
          setPseudoState('taken');
          setSuggestion(chkData.suggestion ?? null);
          setSubmitError('Ce pseudo est déjà pris.');
          setSubmitting(false);
          return;
        }
        setPseudoState('available');
      } catch {
        // Network error — let the main POST below handle it
      }
    }

    try {
      const res = await fetch('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pseudo: trimmed, deviceId: getDeviceId() }),
      });
      const data = await res.json();

      if (data.ok) {
        setPseudo(trimmed);
        window.dispatchEvent(new Event('kickstock:pseudo-saved'));
        // Always start fresh — new guest player begins from day 0
        useGameStore.getState().resetGame();
        setVisible(false);
        onDone();
      } else if (data.error === 'taken') {
        setPseudoState('taken');
        setSubmitError('Ce pseudo est déjà pris.');
      } else {
        setSubmitError('Erreur réseau, réessaie.');
      }
    } catch {
      setSubmitError('Erreur réseau, réessaie.');
    } finally {
      setSubmitting(false);
    }
  }

  function useSuggestion() {
    if (!suggestion) return;
    setPseudoVal(suggestion);
    setPseudoState('idle');
    setSuggestion(null);
    setTimeout(() => checkAvailability(suggestion), 0);
  }

  // Button stays enabled while checking — submit does an inline check if needed
  const isSubmittable = isValidPseudoFormat(pseudo.trim()) && state !== 'taken' && state !== 'invalid';

  if (!visible) return null;

  return (
    <div style={s.overlay}>
      <div style={s.container}>
        {/* Logo */}
        <div style={s.logoRow}>
          <span style={s.logoIcon}>⚽</span>
          <span style={s.logoText}>KICKSTOCK</span>
        </div>
        <div style={s.subtitle}>WORLD CUP 2026 · TRADING GAME</div>

        {/* ── Guest block ─────────────────────────────────── */}
        <div style={s.block}>
          <div style={s.blockTitle}>CONTINUER EN INVITÉ</div>

          <form onSubmit={handleSubmit} style={s.form}>
            <div style={s.inputWrap}>
              <input
                ref={inputRef}
                value={pseudo}
                onChange={handleChange}
                onBlur={handleBlur}
                placeholder="Ton pseudo"
                maxLength={20}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                style={{
                  ...s.input,
                  borderColor: state === 'taken' || state === 'invalid'
                    ? 'var(--loss)'
                    : state === 'available'
                      ? 'var(--gain-dk)'
                      : 'var(--border-hi)',
                }}
              />
              {state === 'checking' && <span style={s.inputStatus}>…</span>}
              {state === 'available' && <span style={{ ...s.inputStatus, color: 'var(--gain)' }}>✓</span>}
            </div>

            {/* Inline feedback */}
            {state === 'invalid' && pseudo.length > 0 && (
              <div style={s.error}>
                3 à 20 caractères, lettres, chiffres, _ et - uniquement. Ne peut pas commencer ou finir par _ ou -.
              </div>
            )}
            {state === 'taken' && (
              <div style={s.error}>
                Pseudo déjà utilisé.{suggestion && (
                  <> <button type="button" onClick={useSuggestion} style={s.suggestionBtn}>
                    Utiliser « {suggestion} »
                  </button></>
                )}
              </div>
            )}
            {submitError && <div style={s.error}>{submitError}</div>}

            <div style={s.deviceWarning}>
              <span style={{ color: 'var(--loss)', marginRight: 4 }}>⚠</span>
              Progression sauvegardée sur ce navigateur uniquement. Si tu changes de device ou effaces ton cache, ta progression sera perdue définitivement.
            </div>

            <button
              type="submit"
              disabled={!isSubmittable || submitting}
              style={{ ...s.btn, opacity: !isSubmittable || submitting ? 0.45 : 1 }}
            >
              {submitting ? 'CHARGEMENT…' : 'JOUER MAINTENANT'}
            </button>
          </form>
        </div>

        {/* ── Divider ──────────────────────────────────────── */}
        <div style={s.dividerRow}>
          <div style={s.dividerLine} />
          <span style={s.dividerText}>ou</span>
          <div style={s.dividerLine} />
        </div>

        {/* ── Account block ────────────────────────────────── */}
        <div style={s.block}>
          <div style={s.blockTitle}>CRÉER UN COMPTE</div>
          <AccountButtons />
        </div>
      </div>
    </div>
  );
}

function AccountButtons() {
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError,   setGoogleError]   = useState('');
  const [emailOpen,     setEmailOpen]     = useState(false);
  const [emailView,     setEmailView]     = useState<'signin' | 'signup'>('signup');

  async function handleGoogle() {
    setGoogleLoading(true);
    setGoogleError('');
    document.cookie = `ks_pending_device=${getDeviceId()}; path=/; max-age=600; SameSite=Lax`;
    const sb = createClient();
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setGoogleError('Connexion Google échouée. Réessaie.');
      setGoogleLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button onClick={handleGoogle} disabled={googleLoading}
        style={{ ...s.oauthBtn, opacity: googleLoading ? 0.6 : 1 }}>
        <span style={s.oauthIcon}>G</span>
        {googleLoading ? 'Redirection…' : 'Continuer avec Google'}
      </button>
      {googleError && <div style={s.error}>{googleError}</div>}

      <button onClick={() => { setEmailView('signup'); setEmailOpen(true); }} style={s.oauthBtn}>
        <span style={s.oauthIcon}>✉</span>Email / Mot de passe
      </button>

      <button disabled style={{ ...s.oauthBtn, opacity: 0.35, cursor: 'not-allowed' }}>
        <span style={s.oauthIcon}></span>
        <span>Apple</span>
        <span style={s.comingSoon}>BIENTÔT</span>
      </button>

      <div style={s.loginRow}>
        Déjà un compte ?{' '}
        <button onClick={() => { setEmailView('signin'); setEmailOpen(true); }}
          style={s.loginLink}>
          SE CONNECTER
        </button>
      </div>

      {emailOpen && (
        <EmailAuthModal
          defaultView={emailView}
          onClose={() => setEmailOpen(false)}
        />
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 600,
    background: 'rgba(0,0,0,0.92)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px 16px',
    backdropFilter: 'blur(4px)',
    // The blur on the game behind is handled by the parent rendering the game
    // underneath this overlay
  },
  container: {
    width: '100%',
    maxWidth: 440,
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 4,
  },
  logoIcon: { fontSize: 26 },
  logoText: {
    fontFamily: 'var(--font-display)',
    fontSize: 26,
    letterSpacing: 4,
    color: 'var(--gold)',
  },
  subtitle: {
    textAlign: 'center',
    fontSize: 9,
    letterSpacing: 2,
    color: '#444',
    fontWeight: 700,
    marginBottom: 20,
  },
  block: {
    background: 'var(--s1)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    padding: '20px 20px 18px',
  },
  blockTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 13,
    letterSpacing: 3,
    color: 'var(--muted)',
    marginBottom: 14,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  inputWrap: {
    position: 'relative',
  },
  input: {
    width: '100%',
    background: 'var(--s2)',
    border: '1px solid var(--border-hi)',
    borderRadius: 8,
    padding: '11px 36px 11px 14px',
    color: 'var(--text)',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'var(--font-body)',
    boxSizing: 'border-box',
    transition: 'border-color .15s',
  },
  inputStatus: {
    position: 'absolute',
    right: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: 12,
    color: 'var(--muted)',
    pointerEvents: 'none',
  },
  error: {
    background: 'var(--loss-bg)',
    border: '1px solid var(--loss-dk)',
    borderRadius: 6,
    padding: '7px 10px',
    fontSize: 11,
    color: 'var(--loss)',
    lineHeight: 1.4,
  },
  suggestionBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--gold)',
    fontSize: 11,
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'var(--font-body)',
    textDecoration: 'underline',
  },
  deviceWarning: {
    fontSize: 10,
    color: 'var(--muted)',
    lineHeight: 1.5,
    padding: '6px 0 2px',
  },
  btn: {
    marginTop: 4,
    background: 'var(--gold)',
    color: '#000',
    border: 'none',
    borderRadius: 9,
    padding: '13px 0',
    fontFamily: 'var(--font-display)',
    fontSize: 17,
    letterSpacing: 3,
    cursor: 'pointer',
    transition: 'opacity .15s',
    width: '100%',
  },
  dividerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    margin: '12px 0',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: 'var(--border)',
  },
  dividerText: {
    fontSize: 11,
    color: 'var(--dim)',
    fontFamily: 'var(--font-body)',
  },
  accountBtns: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  oauthBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    background: 'var(--s2)',
    border: '1px solid var(--border-hi)',
    borderRadius: 9,
    padding: '11px 16px',
    color: 'var(--text)',
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    fontWeight: 500,
    transition: 'border-color .15s',
    textAlign: 'left',
  },
  oauthIcon: {
    width: 20,
    height: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 13,
    flexShrink: 0,
  },
  comingSoon: {
    marginLeft: 'auto',
    fontSize: 9,
    color: 'var(--dim)',
    fontFamily: 'var(--font-display)',
    letterSpacing: 1,
  },
  loginRow: {
    marginTop: 12,
    textAlign: 'center',
    fontSize: 11,
    color: 'var(--muted)',
  },
  loginLink: {
    background: 'none',
    border: 'none',
    padding: 0,
    color: 'var(--gold)',
    fontWeight: 700,
    fontSize: 10,
    letterSpacing: 1,
    fontFamily: 'var(--font-display)',
    cursor: 'pointer',
    textDecoration: 'none',
  },
};
