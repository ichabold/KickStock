'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getDeviceId } from '@/lib/device';
import type { User } from '@supabase/supabase-js';

export interface AuthProfile {
  id: string;
  username: string;
  country: string | null;
  is_auto: boolean;
}

export function useAuth() {
  const [user,    setUser]    = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('id, username, country, is_auto')
      .eq('id', userId)
      .single();
    if (data) setProfile(data);
  }, [supabase]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (user) fetchProfile(user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else setProfile(null);
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile, supabase.auth]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, [supabase]);

  return { user, profile, loading, signOut };
}

/** Fire-and-forget: sync best_score to Supabase when beaten */
export async function syncBestScore(score: number): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    // Only update if the new score is higher than what's stored
    // (Use .update with .lt to let Postgres handle the comparison atomically)
    await supabase
      .from('portfolios')
      .update({ best_score: score } as never)
      .eq('user_id', user.id)
      .or(`best_score.is.null,best_score.lt.${score}`);
    return;
  }

  // Guest (no Supabase auth session): RLS blocks a direct .update() on
  // portfolios for anonymous rows, so go through a SECURITY DEFINER RPC
  // keyed on device_id instead — required for guest scores to appear on
  // the offline ranking ("leaderboard" view).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).rpc('sync_guest_best_score', {
    p_device_id: getDeviceId(),
    p_score: score,
  });
}
