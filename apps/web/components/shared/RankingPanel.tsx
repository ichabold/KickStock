'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/useAuth';
import { useGameMode } from '@/hooks/useGameMode';
import { useOfflineRanking } from '@/hooks/useOfflineRanking';
import { useOnlineRanking } from '@/hooks/useOnlineRanking';
import { useGameStore, fmt } from '@/stores/gameStore';

type Tab = 'online' | 'offline';

/**
 * Shared ranking panel — used by BrowserShell's "RANK." view and the mobile
 * ranking overlay.
 *
 * - "Online" tab: live standings (cash + holdings value) for every player
 *   in the active competition, sorted descending.
 * - "Offline" tab: best-ever scores of REGISTERED players only (1 row per
 *   player, MAX across all competitions). Guests are excluded to keep the
 *   ranking meaningful.
 *
 * Defaults to the tab matching the player's current game mode.
 */
export default function RankingPanel() {
  const ts = useTranslations('shell');
  const tc = useTranslations('common');
  const { mode } = useGameMode();
  const [tab, setTab] = useState<Tab>(mode === 'offline' ? 'offline' : 'online');

  useEffect(() => {
    setTab(mode === 'offline' ? 'offline' : 'online');
  }, [mode]);

  const { user, profile } = useAuth();
  const cash      = useGameStore(s => s.cash);
  const prices    = useGameStore(s => s.prices);
  const portfolio = useGameStore(s => s.portfolio);

  const offline = useOfflineRanking(50);
  const online  = useOnlineRanking(50);

  // Re-fetch when identity changes (login / logout)
  useEffect(() => {
    online.refresh();
    offline.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const portVal  = Object.entries(portfolio).reduce((a, [id, q]) => a + q * (prices[id] ?? 0), 0);
  const myTotal  = cash + portVal;

  // "me" in offline tab: matched by user_id via the API
  const offlineMe   = offline.me;
  const offlineRank = offlineMe?.rank ?? null;

  const myRank = tab === 'offline'
    ? offlineRank
    : (online.me?.rank ?? null);

  const loading     = tab === 'offline' ? offline.loading : online.loading;
  const refresh     = tab === 'offline' ? offline.refresh : online.refresh;
  const entriesEmpty = tab === 'offline' ? offline.entries.length === 0 : online.entries.length === 0;

  const leaderScore = tab === 'offline'
    ? (offline.entries[0] ? Number(offline.entries[0].best_score) : null)
    : (online.entries[0]  ? Number(online.entries[0].total_value) : null);

  // My best score (offline tab) — from the API row
  const myBestScore = tab === 'offline' ? (offlineMe ? Number(offlineMe.best_score) : null) : null;

  return (
    <div className="rnk-wrap">
      {/* My score card */}
      <div className="rnk-mycard">
        <div>
          <div className="rnk-mylbl">{tab === 'offline' ? 'BEST SCORE' : ts('total')}</div>
          <div className="rnk-myval">
            {tab === 'offline'
              ? (myBestScore != null ? `${fmt(myBestScore)} KC` : '—')
              : `${fmt(myTotal)} KC`
            }
          </div>
          {leaderScore != null && (
            <div className="rnk-mybest">🏆 {fmt(leaderScore)} KC</div>
          )}
        </div>
        {!user
          ? <a href="/login" className="rnk-login">⚽ LOGIN</a>
          : myRank
            ? <div className="rnk-myrank">#{myRank}</div>
            : tab === 'offline'
              ? <div className="rnk-noscore" style={{fontSize:10,color:'var(--muted)',textAlign:'center',maxWidth:80}}>
                  Finissez une partie offline pour apparaître
                </div>
              : <div className="rnk-noscore">{ts('tournamentEnded')}</div>
        }
      </div>

      <div className="rnk-tabs">
        <button className={`rtab${tab === 'online' ? ' on' : ''}`} onClick={() => setTab('online')}>
          {ts('onlineTab')}
        </button>
        <button className={`rtab${tab === 'offline' ? ' on' : ''}`} onClick={() => setTab('offline')}>
          {ts('offlineTab')}
        </button>
      </div>

      {/* Offline tab: registered-only notice */}
      {tab === 'offline' && !loading && (
        <div style={{fontSize:9,color:'var(--muted)',textAlign:'center',padding:'4px 0 8px',letterSpacing:1}}>
          🔒 JOUEURS ENREGISTRÉS · 1 SCORE PAR JOUEUR
        </div>
      )}

      {loading && <div className="rnk-empty">{tc('loading')}</div>}

      {!loading && entriesEmpty && (
        <div className="rnk-empty">
          <div className="rnk-emoji">🏆</div>
          <div>{ts('noScores')}</div>
        </div>
      )}

      <div className="rnk-list">
        {/* ── Offline tab ──────────────────────────────────────────────────── */}
        {!loading && tab === 'offline' && offline.entries.map((p, i) => {
          const isMe = !!user && p.user_id === user.id;
          const isOutOfRange = isMe && i === offline.entries.length - 1
            && offline.entries.length > 1 && p.rank !== offline.entries.length;
          return (
            <div key={p.user_id}>
              {isOutOfRange && <div className="rnk-sep">⋯</div>}
              <div className={`rnk-row${isMe ? ' me' : ''}`}>
                <div className={`rnk-rank${p.rank <= 3 ? ' top' : ''}`}>{p.rank}</div>
                <div className="rnk-av" style={isMe ? { background: 'var(--gold)', color: '#000' } : {}}>
                  {p.username[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="rnk-info">
                  <div className="rnk-name">{p.username}{isMe ? ' 👤' : ''}</div>
                  <div className="rnk-sub">{p.country ?? '🌍'}</div>
                </div>
                <div className="rnk-val">{fmt(Number(p.best_score))} KC</div>
              </div>
            </div>
          );
        })}

        {/* ── Online tab ───────────────────────────────────────────────────── */}
        {!loading && tab === 'online' && online.entries.map((p, i) => {
          const isMe = online.me?.portfolio_id === p.portfolio_id;
          const isOutOfRange = isMe && i === online.entries.length - 1
            && online.entries.length > 1 && p.rank !== online.entries.length;
          return (
            <div key={p.portfolio_id}>
              {isOutOfRange && <div className="rnk-sep">⋯</div>}
              <div className={`rnk-row${isMe ? ' me' : ''}`}>
                <div className={`rnk-rank${p.rank <= 3 ? ' top' : ''}`}>{p.rank}</div>
                <div className="rnk-av" style={isMe ? { background: 'var(--gold)', color: '#000' } : {}}>
                  {p.username[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="rnk-info">
                  <div className="rnk-name">
                    {p.username}{isMe ? ' 👤' : ''}
                    {p.user_type === 'guest' && <span className="rnk-guest">GUEST</span>}
                  </div>
                  <div className="rnk-sub">{p.country ?? '🌍'}</div>
                </div>
                <div className="rnk-val">{fmt(Number(p.total_value))} KC</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rnk-foot">
        <button onClick={refresh} className="rnk-refresh-btn">{ts('refresh')}</button>
        <div className="rnk-refresh-note">{ts('rankingAutoRefresh')}</div>
      </div>
    </div>
  );
}
