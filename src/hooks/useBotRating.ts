import { useState, useEffect, useCallback } from 'react';

const BOT_API = (import.meta as ImportMeta & { env?: { VITE_BOT_API_URL?: string } }).env?.VITE_BOT_API_URL
  || 'https://web-production-6035.up.railway.app';

export interface BotPlayer {
  rank: number;
  telegram_id: number;
  name: string;
  username: string;
  points: number;
  games: number;
  best_place: number;
  championships: number;
}

interface UseBotRatingResult {
  players: BotPlayer[];
  loading: boolean;
  error: string | null;
  month: string; // 'current' | 'YYYY-MM' | 'all'
  setMonth: (m: string) => void;
  refetch: () => void;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function useBotRating(): UseBotRatingResult {
  const [players, setPlayers] = useState<BotPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonthState] = useState<string>(currentMonth());
  const [tick, setTick] = useState(0);

  const beginFetch = useCallback(() => {
    setLoading(true);
    setError(null);
  }, []);

  const setMonth = useCallback((nextMonth: string) => {
    beginFetch();
    setMonthState(nextMonth);
  }, [beginFetch]);

  const refetch = useCallback(() => {
    beginFetch();
    setTick(t => t + 1);
  }, [beginFetch]);

  useEffect(() => {
    let cancelled = false;

    const url = month === 'all'
      ? `${BOT_API}/api/rating/rank?month=all`
      : `${BOT_API}/api/rating/rank?month=${month}`;

    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: BotPlayer[]) => {
        if (!cancelled) setPlayers(data);
      })
      .catch(err => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [month, tick]);

  // Auto-refresh every 2 minutes
  useEffect(() => {
    const interval = setInterval(refetch, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refetch]);

  return { players, loading, error, month, setMonth, refetch };
}
