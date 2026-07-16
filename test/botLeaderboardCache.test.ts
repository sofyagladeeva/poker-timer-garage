import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLeaderboardCacheKey,
  loadCachedLeaderboard,
  saveCachedLeaderboard,
} from '../src/hooks/botLeaderboardCache.ts';
import {
  BOT_RATING_CACHE_PREFIX,
  normalizeBotRatingPlayers,
} from '../src/hooks/useBotRating.ts';
import {
  BOT_BOUNTY_CACHE_PREFIX,
  normalizeBotBountyPlayers,
} from '../src/hooks/useBotBounty.ts';

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

test('leaderboard cache round-trips and ignores broken payloads', () => {
  const storage = createStorage();
  const key = buildLeaderboardCacheKey(BOT_RATING_CACHE_PREFIX, '2026-05');
  const players = [{ rank: 1, name: 'Мулька', points: 313.96 }];

  saveCachedLeaderboard(key, players, storage);
  assert.deepEqual(loadCachedLeaderboard(key, storage), players);

  const saved = JSON.parse(storage.getItem(key) ?? '{}') as { cachedAt?: string; players?: unknown };
  assert.equal(typeof saved.cachedAt, 'string');
  assert.deepEqual(saved.players, players);

  const legacyStorage = createStorage({ [key]: JSON.stringify(players) });
  assert.deepEqual(loadCachedLeaderboard(key, legacyStorage), players);

  const brokenStorage = createStorage({ [key]: '{bad json' });
  assert.deepEqual(loadCachedLeaderboard(key, brokenStorage), []);
});

test('normalizeBotRatingPlayers sanitizes incoming payloads', () => {
  const players = normalizeBotRatingPlayers([
    {
      rank: '1',
      telegram_id: '123',
      name: '  Макс  ',
      username: null,
      points: '284.4',
      games: '1',
      best_place: '1',
      championships: '1',
    },
    {
      rank: null,
      telegram_id: null,
      name: '',
      points: null,
      games: null,
      best_place: null,
      championships: null,
    },
  ]);

  assert.deepEqual(players, [
    {
      rank: 1,
      telegram_id: 123,
      name: 'Макс',
      username: '',
      points: 284.4,
      games: 1,
      best_place: 1,
      championships: 1,
    },
    {
      rank: 2,
      telegram_id: null,
      name: 'Игрок',
      username: '',
      points: 0,
      games: 0,
      best_place: 0,
      championships: 0,
    },
  ]);

  assert.equal(normalizeBotRatingPlayers({ players: [] }), null);
});

test('normalizeBotBountyPlayers sanitizes incoming payloads', () => {
  const key = buildLeaderboardCacheKey(BOT_BOUNTY_CACHE_PREFIX, '2026-05');
  assert.equal(key, 'poker_bot_bounty_cache:2026-05');

  const players = normalizeBotBountyPlayers([
    {
      rank: '3',
      telegram_id: '845475373',
      name: ' Покерист ',
      username: 'hsb0071',
      total_bounty: '32',
      games: '11',
    },
    {
      rank: null,
      telegram_id: null,
      name: '',
      username: 42,
      total_bounty: null,
      games: null,
    },
  ]);

  assert.deepEqual(players, [
    {
      rank: 3,
      telegram_id: 845475373,
      name: 'Покерист',
      username: 'hsb0071',
      total_bounty: 32,
      games: 11,
    },
    {
      rank: 2,
      telegram_id: null,
      name: 'Игрок',
      username: null,
      total_bounty: 0,
      games: 0,
    },
  ]);

  assert.equal(normalizeBotBountyPlayers('bad payload'), null);
});
