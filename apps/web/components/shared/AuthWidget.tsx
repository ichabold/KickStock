'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useGameStore } from '@/stores/gameStore';
import { fmt } from '@kickstock/game-engine';
import { getPseudo, clearPseudo, isValidPseudoFormat, getOAuthPending, clearOAuthPending, saveOAuthPending } from '@/lib/pseudo';
import { getDeviceId } from '@/lib/device';
import BottomSheet from './BottomSheet';
import EmailAuthModal from '@/components/auth/EmailAuthModal';

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

  // ── Apply pending OAuth pseudo (persistent across redirects) ───────────────
  // We store the guest pseudo in localStorage BEFORE the OAuth redirect so it
  // survives the round-trip. Here we apply it once the profile is available and
  // is_auto=true (i.e. the account still has the trigger-generated username).
  // This runs in AuthWidget (always mounted) — not WelcomeModal — so it is
  // never cancelled by an unmount mid-flow.
  useEffect(() => {
    if (!user || !profile) return;
    const pending = getOAuthPending();
    clearOAuthPending(); // remove regardless, to avoid stale re-apply
    if (!pending || !isValidPseudoFormat(pending)) return;
    if (!profile.is_auto) return; // already has a user-chosen pseudo

    fetch('/api/auth/set-username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: pending }),
    })
      .then(res => { if (res.ok) window.location.reload(); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, profile?.id]);

  const [panelOpen,     setPanelOpen]     = useState(false);
  const [emailAuthOpen, setEmailAuthOpen] = useState(false);
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
              onSignOut={async () => {
                setPanelOpen(false);
                useGameStore.getState().resetGame();
                await signOut();
                window.location.reload();
              }}
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
              onSignOut={async () => {
                setPanelOpen(false);
                useGameStore.getState().resetGame();
                await signOut();
                window.location.reload();
              }}
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
    <>
      <button
        onClick={() => setEmailAuthOpen(true)}
        style={{
          background: 'rgba(255,219,0,.12)',
          border: '1px solid var(--gold-dk)',
          color: 'var(--gold)',
          padding: compact ? '4px 10px' : '6px 14px',
          borderRadius: 6,
          fontSize: compact ? 9 : 11,
          fontWeight: 700,
          letterSpacing: 1,
          cursor: 'pointer',
          fontFamily: 'var(--font-display)',
          whiteSpace: 'nowrap',
        }}
      >
        {compact ? '⚽ LOGIN' : '⚽ SE CONNECTER'}
      </button>
      {emailAuthOpen && (
        <EmailAuthModal onClose={() => setEmailAuthOpen(false)} />
      )}
    </>
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
  const [confirmReset,   setConfirmReset]   = useState(false);
  const [changePseudo,   setChangePseudo]   = useState(false);
  const resetGame = useGameStore(s => s.resetGame);

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
      <button onClick={() => setChangePseudo(true)} style={s.resetBtn}>
        ✏️ Changer mon pseudo
      </button>
      <button onClick={() => setConfirmReset(true)} style={s.resetBtn}>
        🔄 Recommencer une partie
      </button>
      <button onClick={onSignOut} style={s.signOutBtn}>
        Déconnexion
      </button>

      {confirmReset && (
        <ResetConfirmOverlay
          onConfirm={() => { resetGame(); setConfirmReset(false); }}
          onCancel={() => setConfirmReset(false)}
        />
      )}
      {changePseudo && (
        <ChangePseudoModal
          currentPseudo={name}
          onClose={() => setChangePseudo(false)}
        />
      )}
    </div>
  );
}

// ─── Change pseudo modal ──────────────────────────────────────────────────────

function ChangePseudoModal({ currentPseudo, onClose }: { currentPseudo: string; onClose: () => void }) {
  const [pseudo,  setPseudo]  = useState('');
  const [state,   setState]   = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = pseudo.trim();
    if (!isValidPseudoFormat(trimmed) || state === 'taken' || saving) return;

    setSaving(true);
    setError('');

    // Inline availability check — single click
    if (state !== 'available') {
      try {
        const chk = await fetch(`/api/auth/check-pseudo?q=${encodeURIComponent(trimmed)}`);
        const chkData = await chk.json();
        if (!chkData.available) {
          setState('taken');
          setError('Ce pseudo est déjà pris.');
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
      setError(data.error === 'taken' ? 'Ce pseudo est déjà pris.' : 'Erreur, réessaie.');
      if (data.error === 'taken') setState('taken');
      setSaving(false);
      return;
    }

    setSuccess(true);
    setTimeout(() => { onClose(); window.location.reload(); }, 1200);
  }

  const isSubmittable = isValidPseudoFormat(pseudo.trim()) && state !== 'taken' && !saving;

  return (
    <div style={s.confirmOverlay}>
      <div style={{ ...s.confirmCard, gap: 0 }}>
        <div style={{ ...s.confirmTitle, marginBottom: 6 }}>CHANGER MON PSEUDO</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16, textAlign: 'center' }}>
          Actuel : <strong style={{ color: 'var(--text)' }}>{currentPseudo}</strong>
        </div>

        {success ? (
          <div style={{ textAlign: 'center', color: 'var(--gain)', fontSize: 13, padding: '12px 0' }}>
            ✓ Pseudo mis à jour !
          </div>
        ) : (
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ position: 'relative' }}>
              <input
                autoFocus
                value={pseudo}
                onChange={e => { setPseudo(e.target.value); setState('idle'); setError(''); }}
                onBlur={() => { if (pseudo.trim() && isValidPseudoFormat(pseudo.trim())) {
                  setState('checking');
                  fetch(`/api/auth/check-pseudo?q=${encodeURIComponent(pseudo.trim())}`)
                    .then(r => r.json())
                    .then(d => setState(d.available ? 'available' : 'taken'))
                    .catch(() => setState('idle'));
                }}}
                placeholder="Nouveau pseudo"
                maxLength={20}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                style={{
                  ...s.pseudoInput,
                  borderColor: state === 'taken' ? 'var(--loss)'
                    : state === 'available' ? 'var(--gain-dk)'
                    : 'var(--border-hi)',
                }}
              />
              {state === 'checking'  && <span style={s.pseudoHint}>…</span>}
              {state === 'available' && <span style={{ ...s.pseudoHint, color: 'var(--gain)' }}>✓</span>}
            </div>

            {state === 'taken' && (
              <div style={s.pseudoError}>Pseudo déjà pris.</div>
            )}
            {error && state !== 'taken' && (
              <div style={s.pseudoError}>{error}</div>
            )}

            <button
              type="submit"
              disabled={!isSubmittable}
              style={{ ...s.confirmDanger, background: 'var(--gold)', color: '#000', opacity: isSubmittable ? 1 : 0.4 }}
            >
              {saving ? 'SAUVEGARDE…' : 'CONFIRMER →'}
            </button>
            <button type="button" onClick={onClose} style={s.confirmCancel}>
              Annuler
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ResetConfirmOverlay({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={s.confirmOverlay}>
      <div style={s.confirmCard}>
        <div style={s.confirmTitle}>RECOMMENCER ?</div>
        <div style={s.confirmText}>
          Tu vas perdre toute ta progression actuelle : cash, positions, historique.
          Cette action est irréversible.
        </div>
        <button onClick={onConfirm} style={s.confirmDanger}>
          OUI, RECOMMENCER
        </button>
        <button onClick={onCancel} style={s.confirmCancel}>
          Annuler
        </button>
      </div>
    </div>
  );
}

// ─── Upgrade panel (guest users) ─────────────────────────────────────────────

function UpgradePanel({ pseudo, onClose }: { pseudo: string; onClose: () => void }) {
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError,   setGoogleError]   = useState('');
  const [emailOpen,     setEmailOpen]     = useState(false);

  async function handleGoogle() {
    setGoogleLoading(true);
    setGoogleError('');
    saveOAuthPending(); // persist guest pseudo before the page navigates away
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
        <button
          onClick={() => setEmailOpen(true)}
          style={s.oauthBtn}
        >
          <span style={s.oauthIcon}>✉</span>Email / Mot de passe
        </button>
        {emailOpen && (
          <EmailAuthModal
            defaultView="signup"
            onClose={() => setEmailOpen(false)}
          />
        )}
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
    marginTop: 6,
  },
  resetBtn: {
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
    marginBottom: 6,
  },
  confirmOverlay: {
    position: 'fixed' as const,
    inset: 0,
    zIndex: 600,
    background: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px 16px',
  },
  confirmCard: {
    width: '100%',
    maxWidth: 320,
    background: 'var(--s1)',
    border: '1px solid var(--border-hi)',
    borderRadius: 16,
    padding: '24px 20px 20px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  confirmTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 18,
    letterSpacing: 3,
    color: 'var(--text)',
    textAlign: 'center' as const,
  },
  confirmText: {
    fontSize: 12,
    color: 'var(--muted)',
    lineHeight: 1.6,
    textAlign: 'center' as const,
  },
  confirmDanger: {
    width: '100%',
    background: 'var(--loss)',
    color: '#fff',
    border: 'none',
    borderRadius: 9,
    padding: '12px 0',
    fontFamily: 'var(--font-display)',
    fontSize: 14,
    letterSpacing: 2,
    cursor: 'pointer',
  },
  confirmCancel: {
    width: '100%',
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 9,
    padding: '10px 0',
    color: 'var(--muted)',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
  },
  pseudoInput: {
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
  pseudoHint: {
    position: 'absolute' as const,
    right: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: 12,
    color: 'var(--muted)',
    pointerEvents: 'none' as const,
  },
  pseudoError: {
    background: 'var(--loss-bg)',
    border: '1px solid var(--loss-dk)',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 11,
    color: 'var(--loss)',
  },
};
