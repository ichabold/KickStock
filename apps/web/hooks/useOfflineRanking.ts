'use client';

import { useEffect, useState, useCallback } from 'react';
import type { OfflineRankingRow } from '@/app/api/leaderboard/offline/route';

export type { OfflineRankingRow };

interface OfflineRankingState {
  entries: OfflineRankingRow[];
  me:      OfflineRankingRow | null;
  total:   number;
  loading: boolean;
}

/**
 * Offline ranking — registered players only, 1 row per player (best score
 * across all competitions). Auto-refreshes every 60 s.
 */
export function useOfflineRanking(limit = 50): OfflineRankingState & { refresh: () => void } {
  const [state, setState] = useState<OfflineRankingState>({
    entries: [], me: null, total: 0, loading: true,
  });

  const fetch = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const res  = await window.fetch(`/api/leaderboard/offline?limit=${limit}`);
      const json = await res.json() as { entries: OfflineRankingRow[]; me: OfflineRankingRow | null; total: number };
      setState({ entries: json.entries ?? [], me: json.me ?? null, total: json.total ?? 0, loading: false });
    } catch {
      setState(s => ({ ...s, loading: false }));
    }
  }, [limit]);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, 60_000);
    return () => clearInterval(id);
  }, [fetch]);

  return { ...state, refresh: fetch };
}
