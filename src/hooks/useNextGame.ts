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

export function useNextGame() {
  const [game, setGame] = useState<NextGame | null>(null);

  useEffect(() => {
    const fetchGame = () => {
      fetch(`${BOT_API}/api/games`)
        .then(r => r.json())
        .then((games: NextGame[]) => {
          const upcoming = games.find(g => g.status === 'upcoming');
          setGame(upcoming ?? null);
        })
        .catch(() => setGame(null));
    };

    fetchGame();
    const interval = setInterval(fetchGame, 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(interval);
  }, []);

  return game;
}
