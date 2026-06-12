'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/useAuth';
import { useGameStore } from '@/stores/gameStore';
import { fmt } from '@kickstock/game-engine';
import { isValidPseudoFormat, getPseudo, clearPseudo, clearOAuthPending } from '@/lib/pseudo';

type Step = 'migration' | 'username' | null;

export default function WelcomeModal() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const { user } = useAuth();

  const isMigrated = searchParams.get('ks_migrated') === '1';
  const isNewUser  = searchParams.get('ks_new_user')  === '1';

  // Guest username passed by the callback route via URL.
  // We do this instead of updating the profile server-side in the callback,
  // because handle_new_user trigger may not have run yet at that point (race).
  const ksPseudo = searchParams.get('ks_pseudo');

  const [step, setStep] = useState<Step>(null);

  // Capture the guest pseudo from localStorage at mount (synchronous, before
  // any useEffect can erase it) — used to skip the username prompt when the
  // player already chose one as a guest.
  const [savedGuestPseudo] = useState<string | null>(() => getPseudo());

  // Whether the player has a pending pseudo to apply (decides which step to show).
  // For the 'migration' step, handleMigrationDone applies it directly below.
  // AuthWidget also attempts this in the background as a fallback for flows
  // that don't render this modal (e.g. isNewUser && hasPendingPseudo with no migration).
  const hasPendingPseudo =
    (ksPseudo    && isValidPseudoFormat(ksPseudo))    ||
    (savedGuestPseudo && isValidPseudoFormat(savedGuestPseudo));

  // The pseudo chosen as a guest, to be applied to the freshly-created profile
  // (which got an auto-generated username from the handle_new_user trigger).
  const pendingPseudo =
    (ksPseudo && isValidPseudoFormat(ksPseudo) && ksPseudo) ||
    (savedGuestPseudo && isValidPseudoFormat(savedGuestPseudo) && savedGuestPseudo) ||
    null;

  const [applying, setApplying] = useState(false);

  // ── Determine which modal step to show ───────────────────────────────────
  useEffect(() => {
    if (!user) return;

    if (isMigrated && !hasPendingPseudo) {
      // Migrated guest who still needs to confirm their username (merged step)
      setStep('username');
      return;
    }

    if (isMigrated && hasPendingPseudo) {
      // Migration with pending pseudo — show confirmation, apply pseudo on continue
      setStep('migration');
      return;
    }

    if (isNewUser && !hasPendingPseudo) {
      // Truly new Google user with no prior guest pseudo — ask them to choose
      setStep('username');
      return;
    }

    // hasPendingPseudo: AuthWidget will apply it silently — just clean the URL
    if (isNewUser && hasPendingPseudo) {
      cleanUrl();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isMigrated, isNewUser]);

  function cleanUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('ks_migrated');
    url.searchParams.delete('ks_new_user');
    url.searchParams.delete('ks_pseudo');
    url.searchParams.delete('ks_auth_error');
    router.replace(url.pathname, { scroll: false });
  }

  function handleDone() {
    clearPseudo();
    setStep(null);
    cleanUrl();
    // Reload so useAuth picks up the updated profile.username
    window.location.reload();
  }

  // For the migration step: apply the guest-chosen pseudo to the freshly
  // created profile (still carrying its auto-generated username) BEFORE
  // reloading. This must happen synchronously here — AuthWidget also tries
  // to apply it in the background, but its fetch can be aborted by the
  // reload below before it completes, leaving the auto-generated username.
  async function handleMigrationDone() {
    if (pendingPseudo) {
      setApplying(true);
      try {
        await fetch('/api/auth/set-username', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: pendingPseudo }),
        });
      } catch { /* ignore — user can still rename later via account menu */ }
      clearOAuthPending();
    }
    handleDone();
  }

  if (!step) return null;

  return (
    <div style={s.overlay}>
      <div style={s.card}>
        {step === 'migration' && <MigrationStep onNext={handleMigrationDone} applying={applying} />}
        {step === 'username'  && <UsernameStep  onDone={handleDone} guestPseudo={savedGuestPseudo} />}
      </div>
    </div>
  );
}

// ─── Migration confirmation ───────────────────────────────────────────────────

function MigrationStep({ onNext, applying }: { onNext: () => void; applying: boolean }) {
  const t = useTranslations('auth.welcome');
  const cash      = useGameStore(s => s.cash);
  const portfolio = useGameStore(s => s.portfolio);
  const prices    = useGameStore(s => s.prices);
  const bestScore = useGameStore(s => s.bestScore);

  const portVal   = Object.entries(portfolio).reduce((a, [id, q]) => a + q * (prices[id] ?? 0), 0);
  const totalVal  = cash + portVal;
  const positions = Object.values(portfolio).filter(q => q > 0).length;

  return (
    <>
      <div style={s.checkmark}>✓</div>
      <div style={s.title}>{t('accountCreatedTitle')}</div>
      <div style={s.subtitle}>{t('accountCreatedSubtitle')}</div>

      <div style={s.statsBox}>
        <StatRow label={t('totalValue')}  value={`${fmt(totalVal)} KC`} />
        <StatRow label="Positions"        value={t('positions', { count: positions })} />
        {bestScore && <StatRow label={t('bestScore')} value={`${fmt(bestScore)} KC`} />}
      </div>

      <button onClick={onNext} disabled={applying} style={{ ...s.btn, opacity: applying ? 0.6 : 1 }}>
        {applying ? t('savingButton') : t('continueButton')}
      </button>
    </>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.statRow}>
      <span style={s.statLabel}>{label}</span>
      <span style={s.statValue}>{value}</span>
    </div>
  );
}

// ─── Username prompt (new Google user, no prior guest pseudo) ─────────────────

function UsernameStep({ onDone, guestPseudo }: { onDone: () => void; guestPseudo: string | null }) {
  const t = useTranslations('auth.welcome');
  const { user } = useAuth();

  const initialPseudo = (() => {
    if (guestPseudo && isValidPseudoFormat(guestPseudo)) return guestPseudo;
    const name = user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? '';
    const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);
    return cleaned.length >= 3 ? cleaned : '';
  })();

  const [pseudo,     setPseudo]     = useState(initialPseudo);
  const [state,      setState]      = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');

  useEffect(() => {
    if (initialPseudo && isValidPseudoFormat(initialPseudo)) checkAvailability(initialPseudo);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkAvailability(value: string) {
    if (!isValidPseudoFormat(value)) { setState('idle'); return; }
    setState('checking');
    setSuggestion(null);
    const res  = await fetch(`/api/auth/check-pseudo?q=${encodeURIComponent(value)}`);
    const data = await res.json();
    setState(data.available ? 'available' : 'taken');
    if (!data.available) setSuggestion(data.suggestion ?? null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = pseudo.trim();
    if (!isValidPseudoFormat(trimmed) || state === 'taken' || saving) return;

    setSaving(true);
    setError('');

    // Single-click: inline check if not already confirmed available
    if (state !== 'available') {
      try {
        const chk     = await fetch(`/api/auth/check-pseudo?q=${encodeURIComponent(trimmed)}`);
        const chkData = await chk.json();
        if (!chkData.available) {
          setState('taken');
          setSuggestion(chkData.suggestion ?? null);
          setError(t('pseudoTaken'));
          setSaving(false);
          return;
        }
        setState('available');
      } catch { /* let set-username handle it */ }
    }

    const res  = await fetch('/api/auth/set-username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: trimmed }),
    });
    const data = await res.json();

    if (!res.ok) {
      setState(data.error === 'taken' ? 'taken' : 'idle');
      setError(data.error === 'taken' ? t('pseudoTaken') : t('pseudoTaken'));
      setSaving(false);
      return;
    }

    onDone();
  }

  const isSubmittable = isValidPseudoFormat(pseudo.trim()) && state !== 'taken';

  return (
    <>
      <div style={s.title}>{t('choosePseudoTitle')}</div>
      <div style={s.subtitle}>{t('choosePseudoSubtitle')}</div>

      <form onSubmit={handleSave} style={{ width: '100%' }}>
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <input
            autoFocus
            value={pseudo}
            onChange={e => { setPseudo(e.target.value); setState('idle'); setSuggestion(null); setError(''); }}
            onBlur={() => { if (pseudo.trim()) checkAvailability(pseudo.trim()); }}
            placeholder={t('pseudoPlaceholder')}
            maxLength={20}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            style={{
              ...s.input,
              borderColor: state === 'taken'
                ? 'var(--loss)'
                : state === 'available'
                  ? 'var(--gain-dk)'
                  : 'var(--border-hi)',
            }}
          />
          {state === 'checking'  && <span style={s.inputHint}>…</span>}
          {state === 'available' && <span style={{ ...s.inputHint, color: 'var(--gain)' }}>✓</span>}
        </div>

        {state === 'taken' && (
          <div style={s.errorBox}>
            {t('pseudoTaken')}{suggestion && (
              <button type="button"
                onClick={() => { setPseudo(suggestion); setState('idle'); setSuggestion(null); setTimeout(() => checkAvailability(suggestion), 0); }}
                style={s.suggestionBtn}
              >
                {' '}{t('useSuggestion', { suggestion })}
              </button>
            )}
          </div>
        )}
        {error && state !== 'taken' && <div style={s.errorBox}>{error}</div>}

        <button
          type="submit"
          disabled={!isSubmittable || saving}
          style={{ ...s.btn, marginTop: 12, opacity: !isSubmittable || saving ? 0.45 : 1 }}
        >
          {saving ? t('savingButton') : t('confirmButton')}
        </button>
      </form>

      <div style={{ fontSize: 10, color: 'var(--dim)', textAlign: 'center', marginTop: 4 }}>
        {t('pseudoInfo')}
      </div>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
    animation: 'fadeIn .15s ease-out',
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
    animation: 'slideUp .2s ease-out',
  },
  checkmark: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: 'rgba(0,255,135,.1)',
    border: '1px solid var(--gain-dk)',
    color: 'var(--gain)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
    marginBottom: 4,
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 22,
    letterSpacing: 4,
    color: 'var(--text)',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 11,
    color: 'var(--muted)',
    textAlign: 'center',
    marginBottom: 8,
  },
  statsBox: {
    width: '100%',
    background: 'var(--s2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginBottom: 8,
  },
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 10,
    color: 'var(--muted)',
    letterSpacing: 1,
  },
  statValue: {
    fontSize: 12,
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontWeight: 700,
  },
  btn: {
    width: '100%',
    background: 'var(--gold)',
    color: '#000',
    border: 'none',
    borderRadius: 9,
    padding: '13px 0',
    fontFamily: 'var(--font-display)',
    fontSize: 16,
    letterSpacing: 3,
    cursor: 'pointer',
    transition: 'opacity .15s',
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
    boxSizing: 'border-box' as const,
    transition: 'border-color .15s',
  },
  inputHint: {
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
    marginBottom: 4,
    width: '100%',
    boxSizing: 'border-box' as const,
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
};
