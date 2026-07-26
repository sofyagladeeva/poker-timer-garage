import { useState, useEffect, useCallback } from 'react';
import { buildLeaderboardCacheKey, loadCachedLeaderboard, saveCachedLeaderboard } from './botLeaderboardCache.ts';

const BOT_API = (import.meta as ImportMeta & { env?: { VITE_BOT_API_URL?: string } }).env?.VITE_BOT_API_URL
  || 'https://web-production-6035.up.railway.app';
export const BOT_BOUNTY_CACHE_PREFIX = 'poker_bot_bounty_cache';

export interface BotBountyPlayer {
  rank: number;
  telegram_id: number | null;
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

function toNullableNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toNullableString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function withCacheBuster(url: string) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_=${Date.now()}`;
}

export function normalizeBotBountyPlayers(data: unknown) {
  if (!Array.isArray(data)) return null;

  return data.map((raw, index) => {
    const source = raw as Record<string, unknown>;
    const rank = Math.max(1, Math.round(toNullableNumber(source.rank) ?? index + 1));
    const telegramId = toNullableNumber(source.telegram_id);
    const name = (toNullableString(source.name) ?? '').trim() || 'Игрок';
    const username = toNullableString(source.username);
    const totalBounty = Math.max(0, toNullableNumber(source.total_bounty) ?? 0);
    const games = Math.max(0, Math.round(toNullableNumber(source.games) ?? 0));

    return {
      rank,
      telegram_id: telegramId,
      name,
      username,
      total_bounty: totalBounty,
      games,
    } satisfies BotBountyPlayer;
  });
}

export function useBotBounty(): UseBotBountyResult {
  const [players, setPlayers] = useState<BotBountyPlayer[]>(() => (
    loadCachedLeaderboard<BotBountyPlayer>(buildLeaderboardCacheKey(BOT_BOUNTY_CACHE_PREFIX, currentMonth()))
  ));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonthState] = useState<string>(currentMonth());
  const [tick, setTick] = useState(0);

  const beginFetch = useCallback(() => {
    setLoading(true);
    setError(null);
  }, []);

  const setMonth = useCallback((nextMonth: string) => {
    setPlayers(loadCachedLeaderboard<BotBountyPlayer>(buildLeaderboardCacheKey(BOT_BOUNTY_CACHE_PREFIX, nextMonth)));
    beginFetch();
    setMonthState(nextMonth);
  }, [beginFetch]);

  const refetch = useCallback(() => {
    beginFetch();
    setTick(t => t + 1);
  }, [beginFetch]);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = buildLeaderboardCacheKey(BOT_BOUNTY_CACHE_PREFIX, month);

    fetch(withCacheBuster(`${BOT_API}/api/rating/bounty?month=${month}`))
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: unknown) => {
        const normalizedPlayers = normalizeBotBountyPlayers(data);
        if (!normalizedPlayers) throw new Error('Invalid bounty payload');
        if (!cancelled) {
          setPlayers(normalizedPlayers);
          saveCachedLeaderboard(cacheKey, normalizedPlayers);
        }
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

  useEffect(() => {
    const refetchWhenActive = () => {
      if (document.visibilityState === 'hidden') return;
      refetch();
    };

    document.addEventListener('visibilitychange', refetchWhenActive);
    window.addEventListener('focus', refetchWhenActive);
    window.addEventListener('online', refetchWhenActive);

    return () => {
      document.removeEventListener('visibilitychange', refetchWhenActive);
      window.removeEventListener('focus', refetchWhenActive);
      window.removeEventListener('online', refetchWhenActive);
    };
  }, [refetch]);

  return { players, loading, error, month, setMonth, refetch };
}
