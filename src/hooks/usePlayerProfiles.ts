import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabase.ts';
import { fetchPlayerProfiles, buildProfilesMapByTelegramId } from '../playerProfiles.ts';
import type { PlayerProfile } from '../types.ts';

export interface UsePlayerProfilesResult {
  profiles: PlayerProfile[];
  profilesByTelegramId: Map<number, PlayerProfile>;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function usePlayerProfiles(): UsePlayerProfilesResult {
  const [profiles, setProfiles] = useState<PlayerProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPlayerProfiles()
      .then(data => { if (!cancelled) setProfiles(data); })
      .catch(err => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);

  useEffect(() => {
    const channel = supabase
      .channel('player_profiles_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_profiles' }, () => {
        reload();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [reload]);

  const profilesByTelegramId = buildProfilesMapByTelegramId(profiles);

  return { profiles, profilesByTelegramId, loading, error, reload };
}
