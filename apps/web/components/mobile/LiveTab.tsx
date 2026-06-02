'use client';

/**
 * LiveTab — Online mode replacement for SimulateTab.
 *
 * Shows today's real matches with live status from the DB.
 * - NS:  "Kicks off in X min" + trading lock countdown
 * - 1H/HT/2H/ET: "EN JEU" with elapsed minutes
 * - FT/AET/PEN: score + price movement indicator
 *
 * No Simulate button — results come automatically from sync-results cron.
 */

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useGameStore, fmt } from '@/stores/gameStore';
import styles from './PlayButton.module.css';

interface LiveMatch {
  fixture_id:       number;
  nation_a:         string;
  nation_b:         string;
  scheduled_at:     string;
  api_status:       string;
  score_a:          number | null;
  score_b:          number | null;
  trade_lock_until: string | null;
  processed_at:     string | null;
  phase:            string;
  venue:            string | null;
}

interface TeamInfo {
  id:         string;
  name:       string;
  flag_emoji: string | null;
}

export default function LiveTab() {
  const [matches,   setMatches]   = useState<LiveMatch[]>([]);
  const [teams,     setTeams]     = useState<Record<string, TeamInfo>>({});
  const [loading,   setLoading]   = useState(true);
  const [now,       setNow]       = useState(new Date());

  const t = useTranslations('live');

  const prices    = useGameStore(s => s.prices);
  const portfolio = useGameStore(s => s.portfolio);

  // Refresh clock every 30 seconds (for lock countdowns)
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Poll for today's matches every 60 seconds
  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res  = await fetch('/api/game/live-matches');
        if (!res.ok) return;
        const data = await res.json() as { matches: LiveMatch[]; teams: Record<string, TeamInfo> };
        if (mounted) {
          setMatches(data.matches ?? []);
          setTeams(data.teams ?? {});
        }
      } catch { /* silent */ } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    const id = setInterval(load, 60_000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  if (loading) {
    return (
      <div className={styles.wrap}>
        <div className={styles.dayLabel}>⚡ LIVE</div>
        <div className={styles.phase} style={{ color: 'var(--muted)' }}>{t('loading')}</div>
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className={styles.wrap}>
        <div className={styles.dayLabel}>⚡ LIVE</div>
        <div className={styles.phase} style={{ color: 'var(--muted)', marginTop: 24 }}>
          {t('noMatchToday')}
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
          {t('nextMatchHint')}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.dayLabel}>⚡ LIVE</div>

      <div className={styles.matchList}>
        {matches.map(m => {
          const tA        = teams[m.nation_a];
          const tB        = teams[m.nation_b];
          const hasA      = (portfolio[m.nation_a] ?? 0) > 0;
          const hasB      = (portfolio[m.nation_b] ?? 0) > 0;
          const isLive    = ['1H','HT','2H','ET','BT','P'].includes(m.api_status);
          const isDone    = ['FT','AET','PEN'].includes(m.api_status);
          const lockUntil = m.trade_lock_until ? new Date(m.trade_lock_until) : null;
          const locked    = !isDone || (lockUntil && lockUntil > now);
          const kickoff   = new Date(m.scheduled_at);
          const minsToKO  = Math.round((kickoff.getTime() - now.getTime()) / 60_000);

          const statusBadge = isDone
            ? `${m.score_a}–${m.score_b}`
            : isLive
              ? t('inPlay')
              : minsToKO > 0
                ? `-${minsToKO}min`
                : 'BIENTÔT';

          const statusColor = isDone ? 'var(--muted)' : isLive ? 'var(--gain)' : 'var(--gold)';

          return (
            <div
              key={m.fixture_id}
              className={`${styles.matchPreview} ${hasA || hasB ? styles.exposed : ''}`}
              style={{ opacity: isDone ? 0.65 : 1 }}
            >
              {/* Team A */}
              <span className={styles.mpFlag}>{tA?.flag_emoji ?? '🏳️'}</span>
              <div className={styles.mpInfo}>
                <span className={styles.mpName}>{tA?.name?.toUpperCase() ?? m.nation_a}</span>
                <span className={styles.mpPrice} style={{ color: hasA ? 'var(--gold)' : 'var(--muted)' }}>
                  {fmt(prices[m.nation_a] ?? 0)} KC
                </span>
              </div>

              {/* Score / status */}
              <div className={styles.mpCenter}>
                <span className={styles.mpVs} style={{ color: statusColor, fontWeight: 700 }}>
                  {statusBadge}
                </span>
                {locked && !isDone && (
                  <span className={styles.lockBadge}>🔒</span>
                )}
              </div>

              {/* Team B */}
              <div className={styles.mpInfo} style={{ textAlign: 'right' }}>
                <span className={styles.mpName}>{tB?.name?.toUpperCase() ?? m.nation_b}</span>
                <span className={styles.mpPrice} style={{ color: hasB ? 'var(--gold)' : 'var(--muted)' }}>
                  {fmt(prices[m.nation_b] ?? 0)} KC
                </span>
              </div>
              <span className={styles.mpFlag}>{tB?.flag_emoji ?? '🏳️'}</span>

              {/* Venue */}
              {m.venue && <span className={styles.mpVenue}>📍 {m.venue}</span>}
            </div>
          );
        })}
      </div>

      <div className={styles.liveNote}>
        Résultats automatiques · mise à jour toutes les 5 min
      </div>
    </div>
  );
}
