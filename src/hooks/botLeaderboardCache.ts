export type LeaderboardStorageLike = Pick<Storage, 'getItem' | 'setItem'>;

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
    storage.setItem(cacheKey, JSON.stringify(players));
  } catch {
    // Smart TV browsers can fail localStorage writes under quota pressure.
  }
}
