import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NEXT_GAMES_CACHE_KEY,
  loadCachedGames,
  saveCachedGames,
  selectNextGame,
  type NextGame,
} from '../src/hooks/useNextGame.ts';

function createStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));

  return {
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

const games: NextGame[] = [
  {
    id: 10,
    title: 'Crazy Friday',
    date: '2026-05-16T17:00:00.000Z',
    format: 'freezeout',
    buy_in: 5000,
    max_players: 39,
    confirmed: 37,
    seats_left: 2,
    status: 'upcoming',
  },
  {
    id: 11,
    title: 'Dogman',
    date: '2026-05-17T17:00:00.000Z',
    format: 'freezeout',
    buy_in: 5000,
    max_players: 37,
    confirmed: 6,
    seats_left: 31,
    status: 'upcoming',
  },
];

test('loadCachedGames returns an empty list for invalid cached payloads', () => {
  const storage = createStorage({ [NEXT_GAMES_CACHE_KEY]: '{bad json' });
  assert.deepEqual(loadCachedGames(storage), []);
});

test('saveCachedGames persists a round-trippable payload', () => {
  const storage = createStorage();
  saveCachedGames(games, storage);
  assert.deepEqual(loadCachedGames(storage), games);
});

test('selectNextGame prefers the chosen bot id and falls back to the first upcoming game', () => {
  assert.equal(selectNextGame(games, 11)?.title, 'Dogman');
  assert.equal(selectNextGame(games, null)?.title, 'Crazy Friday');
  assert.equal(selectNextGame(games, 999), null);
});
