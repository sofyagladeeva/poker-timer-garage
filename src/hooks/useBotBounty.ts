import { useState, useEffect, useCallback } from 'react';

const BOT_API = (import.meta as ImportMeta & { env?: { VITE_BOT_API_URL?: string } }).env?.VITE_BOT_API_URL
  || 'https://web-production-6035.up.railway.app';

export interface BotBountyPlayer {
  rank: number;
  telegram_id: number;
  name: string;
  username: string | null;
  total_bounty: number;
  games: number;
}

interface UseBotBountyResult {
  players: BotBountyPlayer[];
  loading: boolean;
  error: string | null;
  month: string;
  setMonth: (m: string) => void;
  refetch: () => void;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function useBotBounty(): UseBotBountyResult {
  const [players, setPlayers] = useState<BotBountyPlayer[]>([]);
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

    fetch(`${BOT_API}/api/rating/bounty?month=${month}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: BotBountyPlayer[]) => {
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

  useEffect(() => {
    const interval = setInterval(refetch, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refetch]);

  return { players, loading, error, month, setMonth, refetch };
}
