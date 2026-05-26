'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useGameStore } from '@/stores/gameStore';
import { fmt } from '@kickstock/game-engine';
import { isValidPseudoFormat } from '@/lib/pseudo';
import { clearPseudo } from '@/lib/pseudo';

type Step = 'migration' | 'username' | null;

export default function WelcomeModal() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const { user, profile } = useAuth();

  const isMigrated = searchParams.get('ks_migrated') === '1';
  const isNewUser  = searchParams.get('ks_new_user')  === '1';

  const [step, setStep] = useState<Step>(null);

  // Determine which step to show once auth is resolved
  useEffect(() => {
    if (!user) return;
    if (isMigrated)     { setStep('migration'); return; }
    if (isNewUser)      { setStep('username');  return; }
  }, [user, isMigrated, isNewUser]);

  // Clean up guest pseudo from localStorage on successful account creation
  useEffect(() => {
    if (user) clearPseudo();
  }, [user]);

  function cleanUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('ks_migrated');
    url.searchParams.delete('ks_new_user');
    url.searchParams.delete('ks_auth_error');
    router.replace(url.pathname, { scroll: false });
  }

  function handleDone() {
    setStep(null);
    cleanUrl();
  }

  if (!step) return null;

  return (
    <div style={s.overlay}>
      <div style={s.card}>
        {step === 'migration' && (
          <MigrationStep onNext={() => {
            if (isNewUser) setStep('username');
            else handleDone();
          }} />
        )}
        {step === 'username' && (
          <UsernameStep onDone={handleDone} />
        )}
      </div>
    </div>
  );
}

// ─── Migration confirmation ───────────────────────────────────────────────────

function MigrationStep({ onNext }: { onNext: () => void }) {
  const cash      = useGameStore(s => s.cash);
  const portfolio = useGameStore(s => s.portfolio);
  const prices    = useGameStore(s => s.prices);
  const bestScore = useGameStore(s => s.bestScore);

  const portVal    = Object.entries(portfolio).reduce((a, [id, q]) => a + q * (prices[id] ?? 0), 0);
  const totalVal   = cash + portVal;
  const positions  = Object.values(portfolio).filter(q => q > 0).length;

  return (
    <>
      <div style={s.checkmark}>✓</div>
      <div style={s.title}>COMPTE CRÉÉ</div>
      <div style={s.subtitle}>Ta progression a été migrée</div>

      <div style={s.statsBox}>
        <StatRow label="Valeur totale"   value={`${fmt(totalVal)} KC`} />
        <StatRow label="Positions"       value={`${positions} nation${positions > 1 ? 's' : ''}`} />
        {bestScore && <StatRow label="Meilleur score" value={`${fmt(bestScore)} KC`} />}
      </div>

      <button onClick={onNext} style={s.btn}>
        CONTINUER →
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

// ─── Username prompt ──────────────────────────────────────────────────────────

function UsernameStep({ onDone }: { onDone: () => void }) {
  const { user, profile } = useAuth();
  const [pseudo,    setPseudo]    = useState('');
  const [state,     setState]     = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');

  // Pre-fill with Google display name (cleaned)
  useEffect(() => {
    const name = user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? '';
    const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);
    if (cleaned.length >= 3) setPseudo(cleaned);
  }, [user]);

  async function checkAvailability(value: string) {
    if (!isValidPseudoFormat(value)) { setState('idle'); return; }
    setState('checking');
    setSuggestion(null);
    const res  = await fetch(`/api/auth/check-pseudo?q=${encodeURIComponent(value)}`);
    const data = await res.json();
    if (data.available) {
      setState('available');
    } else {
      setState('taken');
      setSuggestion(data.suggestion ?? null);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = pseudo.trim();
    if (!isValidPseudoFormat(trimmed) || state === 'taken' || saving) return;

    setSaving(true);
    setError('');

    const res  = await fetch('/api/auth/set-username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: trimmed }),
    });
    const data = await res.json();

    if (!res.ok) {
      if (res.status === 409 || data.error === 'taken') {
        setState('taken');
        setError('Ce pseudo est déjà pris.');
      } else {
        setError('Erreur, réessaie.');
      }
      setSaving(false);
      return;
    }

    // Force full page refresh so useAuth re-fetches the updated profile
    onDone();
    window.location.reload();
  }

  const isSubmittable = isValidPseudoFormat(pseudo.trim()) && state !== 'taken' && state !== 'checking';

  return (
    <>
      <div style={s.title}>CHOISIS TON PSEUDO</div>
      <div style={s.subtitle}>Visible dans le classement</div>

      <form onSubmit={handleSave} style={{ width: '100%' }}>
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <input
            autoFocus
            value={pseudo}
            onChange={e => { setPseudo(e.target.value); setState('idle'); setSuggestion(null); setError(''); }}
            onBlur={() => { if (pseudo.trim()) checkAvailability(pseudo.trim()); }}
            placeholder="Ton pseudo"
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
            Pseudo déjà pris.{suggestion && (
              <button
                type="button"
                onClick={() => { setPseudo(suggestion); setState('idle'); setSuggestion(null); setTimeout(() => checkAvailability(suggestion), 0); }}
                style={s.suggestionBtn}
              >
                {' '}Utiliser « {suggestion} »
              </button>
            )}
          </div>
        )}
        {error && <div style={s.errorBox}>{error}</div>}

        <button
          type="submit"
          disabled={!isSubmittable || saving}
          style={{ ...s.btn, marginTop: 12, opacity: !isSubmittable || saving ? 0.45 : 1 }}
        >
          {saving ? 'SAUVEGARDE…' : 'CONFIRMER →'}
        </button>
      </form>

      <button onClick={onDone} style={s.skipBtn}>
        Passer, je changerai plus tard
      </button>
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
  skipBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--dim)',
    fontSize: 10,
    cursor: 'pointer',
    letterSpacing: 1,
    fontFamily: 'var(--font-body)',
    marginTop: 4,
    padding: '4px 0',
  },
};
