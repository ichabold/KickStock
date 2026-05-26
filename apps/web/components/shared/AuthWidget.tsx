'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { fmt } from '@kickstock/game-engine';
import { useGameStore } from '@/stores/gameStore';
import { getPseudo, clearPseudo } from '@/lib/pseudo';
import { getDeviceId } from '@/lib/device';
import BottomSheet from './BottomSheet';

interface Props {
  compact?: boolean;
}

export default function AuthWidget({ compact = false }: Props) {
  const { user, profile, loading, signOut } = useAuth();
  const bestScore = useGameStore(s => s.bestScore);

  const [guestPseudo, setGuestPseudo] = useState<string | null>(null);
  useEffect(() => {
    if (!loading && !user) setGuestPseudo(getPseudo());
    if (user) clearPseudo(); // clean up localStorage on login
  }, [loading, user]);

  useEffect(() => {
    function onSaved() { setGuestPseudo(getPseudo()); }
    window.addEventListener('kickstock:pseudo-saved', onSaved);
    return () => window.removeEventListener('kickstock:pseudo-saved', onSaved);
  }, []);

  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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
    const name      = profile?.username ?? user.email?.split('@')[0] ?? '';
    const initial   = name[0]?.toUpperCase() ?? '?';
    const avatarUrl = user.user_metadata?.avatar_url as string | undefined;

    if (compact) {
      return (
        <>
          <button onClick={() => setPanelOpen(true)} style={s.avatarBtn}>
            <Avatar initial={initial} size={26} url={avatarUrl} />
          </button>
          <BottomSheet open={panelOpen} onClose={() => setPanelOpen(false)}>
            <AccountMenu
              name={name}
              bestScore={bestScore}
              avatarUrl={avatarUrl}
              initial={initial}
              onSignOut={() => { setPanelOpen(false); signOut(); }}
            />
          </BottomSheet>
        </>
      );
    }

    // Desktop: avatar only, panel on click
    return (
      <div ref={panelRef}>
        <button onClick={() => setPanelOpen(v => !v)} style={s.sidebarAvatarBtn}>
          <Avatar initial={initial} size={34} url={avatarUrl} />
        </button>

        {panelOpen && (
          <div style={s.desktopPanel}>
            <AccountMenu
              name={name}
              bestScore={bestScore}
              avatarUrl={avatarUrl}
              initial={initial}
              onSignOut={() => { setPanelOpen(false); signOut(); }}
            />
          </div>
        )}
      </div>
    );
  }

  // ── Guest user ────────────────────────────────────────────────────────────
  if (guestPseudo) {
    const initial = guestPseudo[0].toUpperCase();

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

    // Desktop: avatar only + GUEST label below, panel on click
    return (
      <div ref={panelRef}>
        <button onClick={() => setPanelOpen(v => !v)} style={s.sidebarAvatarBtn}>
          <Avatar initial={initial} size={34} />
          <span style={s.guestLabel}>GUEST</span>
        </button>

        {panelOpen && (
          <div style={s.desktopPanel}>
            <UpgradePanel pseudo={guestPseudo} onClose={() => setPanelOpen(false)} />
          </div>
        )}
      </div>
    );
  }

  // ── Anonymous ─────────────────────────────────────────────────────────────
  return (
    <Link href="/login" style={{
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
    }}>
      {compact ? '⚽ LOGIN' : '⚽ SE CONNECTER'}
    </Link>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ initial, size, url }: { initial: string; size: number; url?: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt={initial}
        referrerPolicy="no-referrer"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
          border: '1.5px solid var(--border-hi)',
        }}
      />
    );
  }
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
      fontSize: size <= 26 ? 12 : 14,
      fontWeight: 700,
      flexShrink: 0,
      letterSpacing: 0,
    }}>
      {initial}
    </div>
  );
}

// ─── Account menu (registered users) ─────────────────────────────────────────

function AccountMenu({ name, bestScore, avatarUrl, initial, onSignOut }: {
  name: string;
  bestScore: number | null;
  avatarUrl?: string;
  initial: string;
  onSignOut: () => void;
}) {
  return (
    <div style={s.menuWrap}>
      <div style={s.menuHeader}>
        <Avatar initial={initial} size={36} url={avatarUrl} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{name}</div>
          {bestScore !== null && (
            <div style={{ fontSize: 10, color: 'var(--gold)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
              🏆 {fmt(bestScore)} KC
            </div>
          )}
        </div>
      </div>
      <div style={s.menuDivider} />
      <button onClick={onSignOut} style={s.signOutBtn}>
        Déconnexion
      </button>
    </div>
  );
}

// ─── Upgrade panel (guest users) ─────────────────────────────────────────────

function UpgradePanel({ pseudo, onClose }: { pseudo: string; onClose: () => void }) {
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError,   setGoogleError]   = useState('');

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
    <div style={s.menuWrap}>
      <div style={s.guestHeader}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{pseudo}</div>
        <div style={{ fontSize: 9, letterSpacing: 1, color: 'var(--muted)', fontFamily: 'var(--font-display)', marginTop: 2 }}>
          GUEST
        </div>
      </div>

      <div style={s.menuDivider} />

      <div style={s.benefitsList}>
        {['Joue sur tous tes devices', 'Progression sauvegardée', 'Classement protégé'].map(b => (
          <div key={b} style={s.benefit}>
            <span style={{ color: 'var(--gain)', marginRight: 8, fontSize: 11 }}>✓</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{b}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={handleGoogle}
          disabled={googleLoading}
          style={{ ...s.oauthBtn, opacity: googleLoading ? 0.6 : 1 }}
        >
          <span style={s.oauthIcon}>G</span>
          {googleLoading ? 'Redirection…' : 'Continuer avec Google'}
        </button>
        {googleError && <div style={s.errorTip}>{googleError}</div>}
        <button disabled style={{ ...s.oauthBtn, opacity: 0.3, cursor: 'not-allowed' }}>
          <span style={s.oauthIcon}>✉</span>Email
          <span style={s.comingSoon}>BIENTÔT</span>
        </button>
        <button disabled style={{ ...s.oauthBtn, opacity: 0.3, cursor: 'not-allowed' }}>
          <span style={s.oauthIcon}></span>Apple
          <span style={s.comingSoon}>BIENTÔT</span>
        </button>
      </div>

      <div style={s.migrationNote}>Ta progression sera migrée automatiquement.</div>
    </div>
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
    gap: 8,
  },
  // Sidebar (desktop): centered column, avatar + optional label
  sidebarAvatarBtn: {
    background: 'none',
    border: 'none',
    padding: '4px 0',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    width: '100%',
  },
  guestLabel: {
    fontSize: 7,
    letterSpacing: 1.5,
    color: 'var(--muted)',
    fontFamily: 'var(--font-display)',
  },
  desktopPanel: {
    position: 'fixed',
    bottom: 16,
    left: 80, // just outside the 72px sidebar
    width: 260,
    background: 'var(--s1)',
    border: '1px solid var(--border-hi)',
    borderRadius: 12,
    padding: '14px 16px',
    zIndex: 300,
    boxShadow: '0 8px 32px rgba(0,0,0,.6)',
  },
  menuWrap: {
    width: '100%',
  },
  menuHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 0 12px',
  },
  guestHeader: {
    padding: '0 0 12px',
  },
  menuDivider: {
    height: 1,
    background: 'var(--border)',
    margin: '0 0 12px',
  },
  benefitsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginBottom: 14,
  },
  benefit: {
    display: 'flex',
    alignItems: 'center',
  },
  oauthBtn: {
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
    textAlign: 'left' as const,
    boxSizing: 'border-box' as const,
  },
  oauthIcon: {
    width: 20,
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
  errorTip: {
    fontSize: 10,
    color: 'var(--loss)',
  },
  migrationNote: {
    marginTop: 12,
    fontSize: 10,
    color: 'var(--dim)',
    lineHeight: 1.4,
  },
  signOutBtn: {
    width: '100%',
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 7,
    padding: '9px 12px',
    color: 'var(--muted)',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    textAlign: 'left' as const,
    transition: 'border-color .15s, color .15s',
  },
};
