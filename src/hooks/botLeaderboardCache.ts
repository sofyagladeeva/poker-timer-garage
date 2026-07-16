export type LeaderboardStorageLike = Pick<Storage, 'getItem' | 'setItem'>;

type CachedLeaderboard<T> = {
  cachedAt: string;
  players: T[];
};

export function buildLeaderboardCacheKey(prefix: string, month: string) {
  return `${prefix}:${month}`;
}

export function loadCachedLeaderboard<T>(
  cacheKey: string,
  storage: Pick<LeaderboardStorageLike, 'getItem'> = localStorage,
) {
  try {
    const raw = storage.getItem(cacheKey);
    if (!raw) return [] as T[];

    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as CachedLeaderboard<T>).players)) {
      return (parsed as CachedLeaderboard<T>).players;
    }

    // Backward compatibility with the old cache format that stored the array directly.
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [] as T[];
  }
}

export function saveCachedLeaderboard<T>(
  cacheKey: string,
  players: T[],
  storage: Pick<LeaderboardStorageLike, 'setItem'> = localStorage,
) {
  try {
    storage.setItem(cacheKey, JSON.stringify({
      cachedAt: new Date().toISOString(),
      players,
    } satisfies CachedLeaderboard<T>));
  } catch {
    // Smart TV browsers can fail localStorage writes under quota pressure.
  }
}
