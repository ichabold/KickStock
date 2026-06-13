'use client';

import { useTranslations } from 'next-intl';
import GoogleSignInBlock from './GoogleSignInBlock';

interface Props {
  onClose: () => void;
}

/** Shown once, right after a guest's first buy — offers to link a Google
 *  account (same pitch as the homepage) or keep playing as a guest. */
export default function FirstTradeUpsellModal({ onClose }: Props) {
  const t = useTranslations('upgradePrompt');

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.card} onClick={e => e.stopPropagation()}>
        <button style={s.close} onClick={onClose} aria-label={t('close')}>✕</button>
        <div style={s.icon}>🎉</div>
        <div style={s.title}>{t('title')}</div>
        <div style={s.subtitle}>{t('subtitle')}</div>

        <GoogleSignInBlock />

        <div style={s.dividerRow}>
          <div style={s.dividerLine} />
          <span style={s.dividerText}>{t('or')}</span>
          <div style={s.dividerLine} />
        </div>

        <button style={s.guestBtn} onClick={onClose}>{t('continueGuestButton')}</button>
        <div style={s.note}>{t('continueGuestNote')}</div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 550,
    background: 'rgba(0,0,0,0.88)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px 16px',
  },
  card: {
    width: '100%',
    maxWidth: 380,
    background: 'var(--s1)',
    border: '1px solid var(--border-hi)',
    borderRadius: 20,
    padding: '28px 24px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    position: 'relative',
  },
  close: {
    position: 'absolute',
    top: 12,
    right: 14,
    background: 'none',
    border: 'none',
    color: 'var(--muted)',
    fontSize: 16,
    cursor: 'pointer',
  },
  icon: { fontSize: 40, marginBottom: 4 },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 20,
    letterSpacing: 3,
    color: 'var(--gold)',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    color: 'var(--muted)',
    textAlign: 'center',
    lineHeight: 1.5,
    marginBottom: 8,
  },
  dividerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    margin: '4px 0',
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
  guestBtn: {
    width: '100%',
    background: 'transparent',
    color: 'var(--text)',
    border: '1px solid var(--border-hi)',
    borderRadius: 9,
    padding: '12px 0',
    fontFamily: 'var(--font-display)',
    fontSize: 13,
    letterSpacing: 2,
    cursor: 'pointer',
  },
  note: {
    fontSize: 10,
    color: 'var(--dim)',
    textAlign: 'center',
    lineHeight: 1.4,
    marginTop: 2,
  },
};
