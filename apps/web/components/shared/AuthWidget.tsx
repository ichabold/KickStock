'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { fmt } from '@kickstock/game-engine';
import { useGameStore } from '@/stores/gameStore';
import { getPseudo } from '@/lib/pseudo';
import BottomSheet from './BottomSheet';

interface Props {
  compact?: boolean;
}

export default function AuthWidget({ compact = false }: Props) {
  const { user, profile, loading, signOut } = useAuth();
  const bestScore = useGameStore(s => s.bestScore);

  // Guest state: no Supabase session but has a saved pseudo
  const [guestPseudo, setGuestPseudo] = useState<string | null>(null);
  useEffect(() => {
    if (!loading && !user) setGuestPseudo(getPseudo());
  }, [loading, user]);

  // Re-read pseudo when GuestModal saves it
  useEffect(() => {
    function onSaved() { setGuestPseudo(getPseudo()); }
    window.addEventListener('kickstock:pseudo-saved', onSaved);
    return () => window.removeEventListener('kickstock:pseudo-saved', onSaved);
  }, []);

  // Upgrade panel visibility
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close desktop panel on outside click
  useEffect(() => {
    if (!panelOpen || compact) return;
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [panelOpen, compact]);

  if (loading) return null;

  // ── Logged-in registered user ─────────────────────────────────────────────
  if (user) {
    const initial = (profile?.username ?? user.email ?? '?')[0].toUpperCase();
    const name    = profile?.username ?? user.email?.split('@')[0] ?? '';

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 6 : 10 }}>
        <Avatar initial={initial} size={compact ? 26 : 30} />

        {!compact && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
              {name}
            </div>
            {bestScore !== null && (
              <div style={{ fontSize: 9, color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>
                🏆 {fmt(bestScore)} KC
              </div>
            )}
          </div>
        )}

        <button
          onClick={signOut}
          style={{
            background: 'none',
            border: '1px solid #2A2A2A',
            color: '#555',
            padding: compact ? '3px 7px' : '4px 9px',
            borderRadius: 5,
            fontSize: compact ? 8 : 9,
            cursor: 'pointer',
            fontFamily: 'var(--font-body)',
            letterSpacing: 1,
          }}
        >
          {compact ? '✕' : 'DÉCONNEXION'}
        </button>
      </div>
    );
  }

  // ── Guest user (has pseudo, no session) ───────────────────────────────────
  if (guestPseudo) {
    const initial = guestPseudo[0].toUpperCase();

    // Mobile: bottom sheet
    if (compact) {
      return (
        <>
          <button onClick={() => setPanelOpen(true)} style={s.avatarBtn}>
            <Avatar initial={initial} size={26} />
          </button>
          <BottomSheet open={panelOpen} onClose={() => setPanelOpen(false)}>
            <UpgradePanel pseudo={guestPseudo} onClose={() => setPanelOpen(false)} />
          </BottomSheet>
        </>
      );
    }

    // Desktop: inline panel
    return (
      <div ref={panelRef} style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar initial={initial} size={30} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
              {guestPseudo}
            </div>
            <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>
              GUEST
            </div>
          </div>
          <button
            onClick={() => setPanelOpen(v => !v)}
            style={{
              background: 'none',
              border: '1px solid var(--border-hi)',
              color: 'var(--gold)',
              padding: '3px 8px',
              borderRadius: 5,
              fontSize: 9,
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              letterSpacing: 1,
              whiteSpace: 'nowrap',
            }}
          >
            ↑ COMPTE
          </button>
        </div>

        {panelOpen && (
          <div style={s.desktopPanel}>
            <UpgradePanel pseudo={guestPseudo} onClose={() => setPanelOpen(false)} />
          </div>
        )}
      </div>
    );
  }

  // ── Anonymous (no pseudo yet — GuestModal handles onboarding) ────────────
  return (
    <Link
      href="/login"
      style={{
        background: 'rgba(255,219,0,.12)',
        border: '1px solid var(--gold-dk)',
        color: 'var(--gold)',
        padding: compact ? '4px 10px' : '6px 14px',
        borderRadius: 6,
        fontSize: compact ? 9 : 11,
        fontWeight: 700,
        letterSpacing: 1,
        textDecoration: 'none',
        fontFamily: 'var(--font-display)',
        whiteSpace: 'nowrap',
      }}
    >
      {compact ? '⚽ LOGIN' : '⚽ SE CONNECTER'}
    </Link>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Avatar({ initial, size }: { initial: string; size: number }) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: '50%',
      background: 'var(--gold)',
      color: '#000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-display)',
      fontSize: size === 26 ? 12 : 14,
      fontWeight: 700,
      flexShrink: 0,
      letterSpacing: 0,
    }}>
      {initial}
    </div>
  );
}

function UpgradePanel({ pseudo, onClose }: { pseudo: string; onClose: () => void }) {
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError,   setGoogleError]   = useState('');

  async function handleGoogle() {
    setGoogleLoading(true);
    setGoogleError('');
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
    <div style={s.panel}>
      <div style={s.panelPseudo}>
        Tu joues en invité · <span style={{ color: 'var(--text)' }}>{pseudo}</span>
      </div>

      <ul style={s.benefitsList}>
        {['Joue sur tous tes devices', 'Progression sauvegardée', 'Classement protégé'].map(b => (
          <li key={b} style={s.benefit}>
            <span style={{ color: 'var(--gain)', marginRight: 6 }}>✓</span>{b}
          </li>
        ))}
      </ul>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        <button
          onClick={handleGoogle}
          disabled={googleLoading}
          style={{ ...s.oauthBtn, opacity: googleLoading ? 0.6 : 1 }}
        >
          <span style={s.oauthIcon}>G</span>
          {googleLoading ? 'Redirection…' : 'Continuer avec Google'}
        </button>
        {googleError && <div style={s.errorTip}>{googleError}</div>}
        <DisabledBtn label="✉  Email" />
        <DisabledBtn label="  Apple" />
      </div>

      <div style={s.migrationNote}>
        Ta progression sera migrée automatiquement.
      </div>
    </div>
  );
}

function DisabledBtn({ label }: { label: string }) {
  return (
    <button disabled style={{ ...s.oauthBtn, opacity: 0.3, cursor: 'not-allowed' }}>
      {label}
      <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--dim)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>
        BIENTÔT
      </span>
    </button>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  avatarBtn: {
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
  },
  desktopPanel: {
    position: 'absolute',
    bottom: 'calc(100% + 8px)',
    left: 0,
    right: 0,
    background: 'var(--s1)',
    border: '1px solid var(--border-hi)',
    borderRadius: 12,
    zIndex: 300,
    boxShadow: '0 8px 32px rgba(0,0,0,.6)',
  },
  panel: {
    padding: '4px 0 0',
  },
  panelPseudo: {
    fontSize: 11,
    color: 'var(--muted)',
    marginBottom: 10,
    lineHeight: 1.4,
  },
  benefitsList: {
    listStyle: 'none',
    padding: 0,
    margin: '0 0 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  benefit: {
    fontSize: 11,
    color: 'var(--muted)',
    display: 'flex',
    alignItems: 'center',
  },
  oauthBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    background: 'var(--s2)',
    border: '1px solid var(--border-hi)',
    borderRadius: 8,
    padding: '10px 12px',
    color: 'var(--text)',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    fontWeight: 500,
    transition: 'border-color .15s',
    textAlign: 'left' as const,
    boxSizing: 'border-box' as const,
  },
  oauthIcon: {
    width: 18,
    height: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 12,
    flexShrink: 0,
  },
  errorTip: {
    fontSize: 10,
    color: 'var(--loss)',
    padding: '4px 0',
  },
  migrationNote: {
    marginTop: 10,
    fontSize: 10,
    color: 'var(--dim)',
    lineHeight: 1.4,
  },
};
