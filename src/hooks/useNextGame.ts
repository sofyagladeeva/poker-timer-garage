import { useState, useEffect } from 'react';

const BOT_API = import.meta.env.VITE_BOT_API_URL || 'https://web-production-6035.up.railway.app';

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

export function useNextGame(nextGameBotId: number | null) {
  const [games, setGames] = useState<NextGame[]>([]);

  useEffect(() => {
    const fetchGames = () => {
      fetch(`${BOT_API}/api/games`)
        .then(r => r.json())
        .then((data: NextGame[]) => setGames(data))
        .catch(() => setGames([]));
    };

    fetchGames();
    const interval = setInterval(fetchGames, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (nextGameBotId != null) {
    return games.find(g => g.id === nextGameBotId) ?? null;
  }
  // fallback: первая upcoming игра
  return games.find(g => g.status === 'upcoming') ?? null;
}
