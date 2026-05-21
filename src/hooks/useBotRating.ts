import { useState, useEffect, useCallback } from 'react';
import { buildLeaderboardCacheKey, loadCachedLeaderboard, saveCachedLeaderboard } from './botLeaderboardCache.ts';

const BOT_API = (import.meta as ImportMeta & { env?: { VITE_BOT_API_URL?: string } }).env?.VITE_BOT_API_URL
  || 'https://web-production-6035.up.railway.app';
export const BOT_RATING_CACHE_PREFIX = 'poker_bot_rating_cache';

export interface BotPlayer {
  rank: number;
  telegram_id: number | null;
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

function toNullableNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toStringOrEmpty(value: unknown) {
  return typeof value === 'string' ? value : '';
}

export function normalizeBotRatingPlayers(data: unknown) {
  if (!Array.isArray(data)) return null;

  return data.map((raw, index) => {
    const source = raw as Record<string, unknown>;
    const rank = Math.max(1, Math.round(toNullableNumber(source.rank) ?? index + 1));
    const telegramId = toNullableNumber(source.telegram_id);
    const name = toStringOrEmpty(source.name).trim() || 'Игрок';
    const username = toStringOrEmpty(source.username);
    const points = Math.max(0, toNullableNumber(source.points) ?? 0);
    const games = Math.max(0, Math.round(toNullableNumber(source.games) ?? 0));
    const bestPlace = Math.max(0, Math.round(toNullableNumber(source.best_place) ?? 0));
    const championships = Math.max(0, Math.round(toNullableNumber(source.championships) ?? 0));

    return {
      rank,
      telegram_id: telegramId,
      name,
      username,
      points,
      games,
      best_place: bestPlace,
      championships,
    } satisfies BotPlayer;
  });
}

export function useBotRating(): UseBotRatingResult {
  const [players, setPlayers] = useState<BotPlayer[]>(() => (
    loadCachedLeaderboard<BotPlayer>(buildLeaderboardCacheKey(BOT_RATING_CACHE_PREFIX, currentMonth()))
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
    setPlayers(loadCachedLeaderboard<BotPlayer>(buildLeaderboardCacheKey(BOT_RATING_CACHE_PREFIX, nextMonth)));
    beginFetch();
    setMonthState(nextMonth);
  }, [beginFetch]);

  const refetch = useCallback(() => {
    beginFetch();
    setTick(t => t + 1);
  }, [beginFetch]);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = buildLeaderboardCacheKey(BOT_RATING_CACHE_PREFIX, month);

    const url = month === 'all'
      ? `${BOT_API}/api/rating/rank?month=all`
      : `${BOT_API}/api/rating/rank?month=${month}`;

    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: unknown) => {
        const normalizedPlayers = normalizeBotRatingPlayers(data);
        if (!normalizedPlayers) throw new Error('Invalid rating payload');
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

  // Auto-refresh every 2 minutes
  useEffect(() => {
    const interval = setInterval(refetch, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refetch]);

  return { players, loading, error, month, setMonth, refetch };
}
