'use client';

import { useEffect, useState, useCallback } from 'react';
import { getDeviceId } from '@/lib/device';
import type { RankingRow } from '@/app/api/leaderboard/online/route';

export type { RankingRow };

/**
 * Live "Online" ranking — cash + holdings value for every player in the
 * active competition, sorted descending. Polls every 30s, matching
 * useLeaderboard's cadence.
 */
export function useOnlineRanking(limit = 50) {
  const [entries, setEntries] = useState<RankingRow[]>([]);
  const [me,      setMe]      = useState<RankingRow | null>(null);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchRanking = useCallback(async () => {
    setLoading(true);
    try {
      const deviceId = getDeviceId();
      const res  = await fetch(`/api/leaderboard/online?limit=${limit}&deviceId=${encodeURIComponent(deviceId)}`);
      const data = await res.json();
      setEntries((data.entries as RankingRow[]) ?? []);
      setMe((data.me as RankingRow | null) ?? null);
      setTotal((data.total as number) ?? 0);
    } catch {
      setEntries([]);
      setMe(null);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchRanking();
    const interval = setInterval(fetchRanking, 30_000);
    return () => clearInterval(interval);
  }, [fetchRanking]);

  return { entries, me, total, loading, refresh: fetchRanking };
}
