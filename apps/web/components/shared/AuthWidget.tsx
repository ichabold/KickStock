'use client';

import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { fmt } from '@kickstock/game-engine';
import { useGameStore } from '@/stores/gameStore';

interface Props {
  compact?: boolean; // mobile header uses compact mode
}

export default function AuthWidget({ compact = false }: Props) {
  const { user, profile, loading, signOut } = useAuth();
  const bestScore = useGameStore(s => s.bestScore);

  if (loading) return null;

  if (!user) {
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

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 6 : 10 }}>
      {/* Avatar */}
      <div style={{
        width: compact ? 26 : 30,
        height: compact ? 26 : 30,
        borderRadius: '50%',
        background: 'var(--gold)',
        color: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-display)',
        fontSize: compact ? 12 : 14,
        fontWeight: 700,
        flexShrink: 0,
        letterSpacing: 0,
      }}>
        {(profile?.username ?? user.email ?? '?')[0].toUpperCase()}
      </div>

      {!compact && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
            {profile?.username ?? user.email?.split('@')[0]}
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
          whiteSpace: 'nowrap',
        }}
      >
        {compact ? '✕' : 'DÉCONNEXION'}
      </button>
    </div>
  );
}
