import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabase.ts';
import { fetchActiveGiftsByTelegramIds } from '../playerGifts.ts';
import type { PlayerGift } from '../types.ts';

export interface UsePlayerGiftsResult {
  giftsByTelegramId: Map<number, PlayerGift[]>;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function usePlayerGifts(telegramIds: number[], sessionId?: number | null): UsePlayerGiftsResult {
  const [gifts, setGifts] = useState<PlayerGift[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const idsKey = telegramIds.slice().sort((a, b) => a - b).join(',');

  const reload = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (telegramIds.length === 0) { setGifts([]); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchActiveGiftsByTelegramIds(telegramIds, sessionId)
      .then(data => { if (!cancelled) setGifts(data); })
      .catch(err => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, idsKey, sessionId]);

  useEffect(() => {
    const channel = supabase
      .channel('player_gifts_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_gifts' }, () => {
        reload();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [reload]);

  const giftsByTelegramId = new Map<number, PlayerGift[]>();
  for (const gift of gifts) {
    if (gift.telegramId == null) continue;
    const list = giftsByTelegramId.get(gift.telegramId) ?? [];
    list.push(gift);
    giftsByTelegramId.set(gift.telegramId, list);
  }

  return { giftsByTelegramId, loading, error, reload };
}
