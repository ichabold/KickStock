'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/useAuth';
import { useGameMode } from '@/hooks/useGameMode';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { useOnlineRanking } from '@/hooks/useOnlineRanking';
import { useGameStore, fmt } from '@/stores/gameStore';
import { getPseudo } from '@/lib/pseudo';

type Tab = 'online' | 'offline';

/**
 * Shared ranking panel — used by BrowserShell's "RANK." view and the mobile
 * ranking overlay.
 *
 * - "Online" tab: live standings (cash + holdings value) for every player
 *   in the active competition, sorted descending. If the logged-in player
 *   isn't in the visible top N, their row is appended at the end with
 *   their actual rank.
 * - "Offline" tab: best scores reached at the end of finished offline games
 *   (portfolios.best_score, via the `leaderboard` view).
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

  const [guestPseudo, setGuestPseudo] = useState<string | null>(null);
  useEffect(() => {
    setGuestPseudo(getPseudo());
    function onSaved() { setGuestPseudo(getPseudo()); }
    window.addEventListener('kickstock:pseudo-saved', onSaved);
    return () => window.removeEventListener('kickstock:pseudo-saved', onSaved);
  }, []);

  const offline = useLeaderboard(50);
  const online  = useOnlineRanking(50);

  const portVal = Object.entries(portfolio).reduce((a, [id, q]) => a + q * (prices[id] ?? 0), 0);
  const myTotal = cash + portVal;

  const offlineRank = profile
    ? offline.entries.findIndex(e => e.username === profile.username) + 1
    : guestPseudo
      ? offline.entries.findIndex(e => e.username === guestPseudo) + 1
      : 0;

  const myRank = tab === 'offline'
    ? (offlineRank > 0 ? offlineRank : null)
    : (online.me?.rank ?? null);

  const loading = tab === 'offline' ? offline.loading : online.loading;
  const refresh = tab === 'offline' ? offline.refresh : online.refresh;
  const entriesEmpty = tab === 'offline' ? offline.entries.length === 0 : online.entries.length === 0;

  const leaderScore = tab === 'offline'
    ? (offline.entries[0] ? Number(offline.entries[0].best_score) : null)
    : (online.entries[0] ? Number(online.entries[0].total_value) : null);

  return (
    <div className="rnk-wrap">
      {/* My score card */}
      <div className="rnk-mycard">
        <div>
          <div className="rnk-mylbl">{ts('total')}</div>
          <div className="rnk-myval">{fmt(myTotal)} KC</div>
          {leaderScore != null && <div className="rnk-mybest">🏆 {fmt(leaderScore)} KC</div>}
        </div>
        {!user && !guestPseudo
          ? <a href="/login" className="rnk-login">⚽ LOGIN</a>
          : myRank
            ? <div className="rnk-myrank">#{myRank}</div>
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

      {loading && <div className="rnk-empty">{tc('loading')}</div>}

      {!loading && entriesEmpty && (
        <div className="rnk-empty">
          <div className="rnk-emoji">🏆</div>
          <div>{ts('noScores')}</div>
        </div>
      )}

      <div className="rnk-list">
        {!loading && tab === 'offline' && offline.entries.map((p, i) => {
          const isMe = (!!profile && p.username === profile.username)
                    || (!!guestPseudo && p.username === guestPseudo);
          return (
            <div key={`${p.username}-${i}`} className={`rnk-row${isMe ? ' me' : ''}`}>
              <div className={`rnk-rank${i < 3 ? ' top' : ''}`}>{i + 1}</div>
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
              <div className="rnk-val">{fmt(Number(p.best_score))} KC</div>
            </div>
          );
        })}

        {!loading && tab === 'online' && online.entries.map((p, i) => {
          const isMe   = online.me?.portfolio_id === p.portfolio_id;
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
