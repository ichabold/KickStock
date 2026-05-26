'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface LeaderboardEntry {
  username: string;
  country: string | null;
  user_type: 'registered' | 'guest';
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
      .select('username, country, user_type, best_score, updated_at')
      .limit(limit);

    setEntries((data as LeaderboardEntry[]) ?? []);
    setLoading(false);
  }, [supabase, limit]);

  useEffect(() => {
    fetch();
    const interval = setInterval(fetch, 30_000);
    return () => clearInterval(interval);
  }, [fetch]);

  return { entries, loading, refresh: fetch };
}
