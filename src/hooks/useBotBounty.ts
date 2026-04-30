import { useState, useEffect, useCallback } from 'react';

const BOT_API = import.meta.env.VITE_BOT_API_URL || 'https://web-production-6035.up.railway.app';

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState<string>(currentMonth());
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

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
