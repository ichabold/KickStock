'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { getDeviceId } from '@/lib/device';
import { saveOAuthPending } from '@/lib/pseudo';

/** Primary "Continue with Google" CTA + benefit checklist — shared between
 *  the guest sign-up modal and the post-first-trade upgrade prompt. */
export default function GoogleSignInBlock() {
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4, width: '100%' }}>
      <button
        onClick={handleGoogle}
        disabled={googleLoading}
        style={{ ...s.googlePri, opacity: googleLoading ? 0.6 : 1 }}
      >
        <span style={s.googleIcon}>G</span>
        {googleLoading ? tc('redirecting') : t('continueGoogle')}
      </button>
      <div style={s.benefitsList}>
        <div style={s.benefit}>✓ {t('googleBenefit1')}</div>
        <div style={s.benefit}>✓ {t('googleBenefit2')}</div>
        <div style={s.benefit}>✓ {t('googleBenefit3')}</div>
      </div>
      {googleError && <div style={s.error}>{googleError}</div>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  googlePri: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    background: 'var(--gold)',
    color: '#000',
    border: 'none',
    borderRadius: 10,
    padding: '13px 16px',
    fontFamily: 'var(--font-display)',
    fontSize: 16,
    letterSpacing: 3,
    textTransform: 'uppercase',
    cursor: 'pointer',
    transition: 'opacity .15s',
  },
  googleIcon: {
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 900,
    fontSize: 13,
    color: '#333',
    flexShrink: 0,
  },
  benefitsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '4px 6px 0',
  },
  benefit: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    color: 'var(--gain)',
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
};
