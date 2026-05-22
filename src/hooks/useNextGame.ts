import { useState, useEffect } from 'react';

const BOT_API = (import.meta as ImportMeta & { env?: { VITE_BOT_API_URL?: string } }).env?.VITE_BOT_API_URL
  || 'https://web-production-6035.up.railway.app';
export const NEXT_GAMES_CACHE_KEY = 'poker_next_games_cache';

export interface NextGame {
  id: number;
  title: string;
  date: string;
  format: string;
  buy_in: number;
  max_players: number;
  confirmed: number;
  seats_left: number;
  status: string;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function loadCachedGames(storage: Pick<StorageLike, 'getItem'> = localStorage): NextGame[] {
  try {
    const raw = storage.getItem(NEXT_GAMES_CACHE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as NextGame[] : [];
  } catch {
    return [];
  }
}

export function saveCachedGames(games: NextGame[], storage: Pick<StorageLike, 'setItem'> = localStorage) {
  try {
    storage.setItem(NEXT_GAMES_CACHE_KEY, JSON.stringify(games));
  } catch {
    // Smart TV browsers can fail localStorage writes under quota pressure.
  }
}

export function selectNextGame(games: NextGame[], nextGameBotId: number | null) {
  if (nextGameBotId != null) {
    return games.find(g => g.id === nextGameBotId) ?? null;
  }

  return games.find(g => g.status === 'upcoming') ?? null;
}

export function useNextGame(nextGameBotId: number | null) {
  const [games, setGames] = useState<NextGame[]>(() => loadCachedGames());

  useEffect(() => {
    const fetchGames = () => {
      fetch(`${BOT_API}/api/games`)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((data: NextGame[]) => {
          setGames(data);
          saveCachedGames(data);
        })
        .catch(() => {
          // Keep the last successful list instead of blanking the widget.
        });
    };

    fetchGames();
    const interval = setInterval(fetchGames, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return selectNextGame(games, nextGameBotId);
}
