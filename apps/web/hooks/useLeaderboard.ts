'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface LeaderboardEntry {
  id: string;
  username: string;
  country: string | null;
  best_score: number;
  updated_at: string;
}

export function useLeaderboard(limit = 20) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('leaderboard')
      .select('id, username, country, best_score, updated_at')
      .limit(limit);

    setEntries((data as LeaderboardEntry[]) ?? []);
    setLoading(false);
  }, [supabase, limit]);

  useEffect(() => {
    fetch();
    // Refresh every 30s
    const interval = setInterval(fetch, 30_000);
    return () => clearInterval(interval);
  }, [fetch]);

  return { entries, loading, refresh: fetch };
}
