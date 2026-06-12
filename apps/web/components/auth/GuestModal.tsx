'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { getDeviceId } from '@/lib/device';
import { getPseudo, setPseudo, isValidPseudoFormat, saveOAuthPending } from '@/lib/pseudo';
import { useGameStore } from '@/stores/gameStore';

interface Props {
  onDone: () => void;
}

type PseudoState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

const TUT_KEY = 'kickstock_seen_tutorial';

export default function GuestModal({ onDone }: Props) {
  const t = useTranslations('auth.guest');
  const tc = useTranslations('common');
  const [visible, setVisible]       = useState(false);
  const [pseudo,  setPseudoVal]     = useState('');
  const [state,   setPseudoState]   = useState<PseudoState>('idle');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [cfToken, setCfToken]         = useState<string | null>(null);
  const inputRef        = useRef<HTMLInputElement>(null);
  const turnstileRef    = useRef<HTMLDivElement>(null);
  const turnstileWidget = useRef<string | null>(null);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null;

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

  // Focus input only on non-touch devices (not mobile) — P1 fix
  useEffect(() => {
    if (!visible) return;
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (!isTouch) setTimeout(() => inputRef.current?.focus(), 100);
  }, [visible]);

  // Load Turnstile invisible widget when modal opens
  useEffect(() => {
    if (!visible || !siteKey || !turnstileRef.current) return;

    const existing = document.getElementById('ks-turnstile-script');
    const render = () => {
      if (!turnstileRef.current || turnstileWidget.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      turnstileWidget.current = (window as any).turnstile?.render(turnstileRef.current, {
        sitekey:           siteKey,
        execution:         'render',
        size:              'invisible',
        callback:          (token: string) => setCfToken(token),
        'expired-callback': () => setCfToken(null),
      }) ?? null;
    };

    if (existing) {
      render();
    } else {
      const script = document.createElement('script');
      script.id  = 'ks-turnstile-script';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = render;
      document.head.appendChild(script);
    }

    return () => {
      if (turnstileWidget.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).turnstile?.remove(turnstileWidget.current);
        turnstileWidget.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setPseudoState('idle');
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

    if (state === 'taken') {
      setSubmitError(t('alreadyTaken'));
      setSubmitting(false);
      return;
    }
    if (state !== 'available') {
      try {
        const chk = await fetch(`/api/auth/check-pseudo?q=${encodeURIComponent(trimmed)}`);
        const chkData = await chk.json();
        if (!chkData.available) {
          setPseudoState('taken');
          setSuggestion(chkData.suggestion ?? null);
          setSubmitError(t('alreadyTaken'));
          setSubmitting(false);
          return;
        }
        setPseudoState('available');
      } catch {
        // Let main POST handle it
      }
    }

    try {
      if (siteKey && !cfToken) {
        setSubmitError(t('turnstileError'));
        setSubmitting(false);
        return;
      }

      const res = await fetch('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pseudo: trimmed, deviceId: getDeviceId(), cfToken }),
      });
      const data = await res.json();

      if (data.ok) {
        setPseudo(trimmed);
        window.dispatchEvent(new Event('kickstock:pseudo-saved'));

        // Auto-open tutorial for first-time players — P0 fix
        if (!localStorage.getItem(TUT_KEY)) {
          window.dispatchEvent(new Event('kickstock:show-tutorial'));
        }

        useGameStore.getState().resetGame();
        setVisible(false);
        onDone();
      } else if (data.error === 'taken') {
        setPseudoState('taken');
        setSubmitError(t('alreadyTaken'));
      } else {
        setSubmitError(tc('networkError'));
      }
    } catch {
      setSubmitError(tc('networkError'));
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
        <div style={s.subtitle}>{t('subtitle')}</div>

        {/* ── Guest block (primary) ────────────────────────────────── */}
        <div style={s.block}>
          <div style={s.blockTitle}>{t('title')}</div>
          <form onSubmit={handleSubmit} style={s.form}>
            <div style={s.inputWrap}>
              <input
                ref={inputRef}
                value={pseudo}
                onChange={handleChange}
                onBlur={handleBlur}
                placeholder={t('placeholder')}
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

            {state === 'invalid' && pseudo.length > 0 && (
              <div style={s.error}>
                {t('validationError')}
              </div>
            )}
            {state === 'taken' && (
              <div style={s.error}>
                {t('alreadyTaken')}{suggestion && (
                  <> <button type="button" onClick={useSuggestion} style={s.suggestionBtn}>
                    {t('useSuggestion', { suggestion })}
                  </button></>
                )}
              </div>
            )}
            {submitError && <div style={s.error}>{submitError}</div>}

            {/* Turnstile invisible widget — renders here, hidden from user */}
            <div ref={turnstileRef} style={{ display: 'none' }} />
            {siteKey && (
              <div style={s.turnstileNotice}>
                {t('turnstileNotice')}{' '}
                <a
                  href="https://www.cloudflare.com/privacypolicy/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={s.turnstileLink}
                >
                  {t('privacyPolicy')}
                </a>
              </div>
            )}

            <button
              type="submit"
              disabled={!isSubmittable || submitting}
              style={{ ...s.btn, opacity: !isSubmittable || submitting ? 0.45 : 1 }}
            >
              {submitting ? t('loadingButton') : t('submitButton')}
            </button>
          </form>
        </div>

        {/* ── Divider ──────────────────────────────────────────────── */}
        <div style={s.dividerRow}>
          <div style={s.dividerLine} />
          <span style={s.dividerText}>{tc('or')}</span>
          <div style={s.dividerLine} />
        </div>

        {/* ── Auth block (secondary) ────────────────────────────────── */}
        <AuthButtons />
      </div>
    </div>
  );
}

function AuthButtons() {
  const t = useTranslations('auth.guest');
  const te = useTranslations('auth.emailModal');
  const tc = useTranslations('common');
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError,   setGoogleError]   = useState('');

  async function handleGoogle() {
    setGoogleLoading(true);
    setGoogleError('');
    saveOAuthPending();
    document.cookie = `ks_pending_device=${getDeviceId()}; path=/; max-age=600; SameSite=Lax`;
    const sb = createClient();
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setGoogleError(te('googleError'));
      setGoogleLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        onClick={handleGoogle}
        disabled={googleLoading}
        style={{ ...s.oauthBtn, opacity: googleLoading ? 0.6 : 1 }}
      >
        <span style={s.oauthIcon}>G</span>
        {googleLoading ? tc('redirecting') : t('continueGoogle')}
      </button>
      {googleError && <div style={s.error}>{googleError}</div>}
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
  },
  container: {
    width: '100%',
    maxWidth: 400,
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
  loginRow: {
    textAlign: 'center',
    fontSize: 11,
    color: 'var(--muted)',
    marginBottom: 4,
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
  },
  turnstileNotice: {
    fontSize: 9,
    color: 'var(--dim)',
    textAlign: 'center' as const,
    lineHeight: 1.4,
    marginTop: 2,
  },
  turnstileLink: {
    color: 'var(--dim)',
    textDecoration: 'underline',
  },
};
