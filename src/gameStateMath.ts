import type { BountySnapshotEntry, ChipLeaderEntry, ChipLeadersState, GameState, GameStatus, RatingSnapshotEntry } from './types.ts';

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toWholeNumber(value: unknown, fallback = 0) {
  return Math.max(0, Math.round(toNumber(value, fallback)));
}

function toNullableNumber(value: unknown, fallback: number | null) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = toNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function toStringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function toNullableString(value: unknown, fallback: string | null) {
  return value === null ? null : typeof value === 'string' ? value : fallback;
}

function toBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function isGameStatus(value: unknown): value is GameStatus {
  return value === 'idle' || value === 'running' || value === 'paused' || value === 'break' || value === 'ended';
}

function normalizeChipLeaderEntry(raw: unknown, index: number): ChipLeaderEntry | null {
  if (!raw || typeof raw !== 'object') return null;

  const source = raw as Record<string, unknown>;
  const name = toStringValue(source.name).trim();
  const stack = toWholeNumber(source.stack, 0);
  if (!name || stack <= 0) return null;

  return {
    id: toStringValue(source.id, `${index + 1}`),
    playerId: toStringValue(source.playerId, toStringValue(source.player_id, '')),
    name,
    stack,
    tableNumber: toNullableNumber(source.tableNumber ?? source.table_number, null),
    seatNumber: toNullableNumber(source.seatNumber ?? source.seat_number, null),
  };
}

function normalizeChipLeaders(raw: unknown, fallback: ChipLeadersState | null): ChipLeadersState | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (!raw || typeof raw !== 'object') return fallback;

  const source = raw as Record<string, unknown>;
  const levelIndex = toWholeNumber(source.levelIndex ?? source.level_index, fallback?.levelIndex ?? 0);
  const hideAfterLevelIndex = toWholeNumber(
    source.hideAfterLevelIndex ?? source.hide_after_level_index,
    fallback?.hideAfterLevelIndex ?? levelIndex
  );
  const entries = Array.isArray(source.entries)
    ? source.entries
        .map((entry, index) => normalizeChipLeaderEntry(entry, index))
        .filter((entry): entry is ChipLeaderEntry => entry !== null)
        .slice(0, 3)
    : fallback?.entries ?? [];

  if (entries.length === 0) return null;
  return { levelIndex, hideAfterLevelIndex, entries };
}

export function calcTotalStack(state: Pick<GameState, 'players' | 'rebuys' | 'startStack' | 'addonCount' | 'addonStack' | 'bonusCount' | 'bonusStack'>) {
  return (
    Math.max(0, state.players + state.rebuys) * Math.max(0, state.startStack) +
    Math.max(0, state.addonCount) * Math.max(0, state.addonStack) +
    Math.max(0, state.bonusCount) * Math.max(0, state.bonusStack)
  );
}

function normalizeRatingSnapshot(raw: unknown, fallback: RatingSnapshotEntry[] | null): RatingSnapshotEntry[] | null {
  if (!Array.isArray(raw)) return fallback;
  return raw
    .filter(item => item && typeof item === 'object')
    .map((item: Record<string, unknown>) => ({
      rank: typeof item.rank === 'number' ? item.rank : 0,
      telegram_id: typeof item.telegram_id === 'number' ? item.telegram_id : null,
      name: typeof item.name === 'string' ? item.name : '',
      username: typeof item.username === 'string' ? item.username : '',
      points: typeof item.points === 'number' ? item.points : 0,
      games: typeof item.games === 'number' ? item.games : 0,
      best_place: typeof item.best_place === 'number' ? item.best_place : 0,
      championships: typeof item.championships === 'number' ? item.championships : 0,
    } satisfies RatingSnapshotEntry));
}

function normalizeBountySnapshot(raw: unknown, fallback: BountySnapshotEntry[] | null): BountySnapshotEntry[] | null {
  if (!Array.isArray(raw)) return fallback;
  return raw
    .filter(item => item && typeof item === 'object')
    .map((item: Record<string, unknown>) => ({
      rank: typeof item.rank === 'number' ? item.rank : 0,
      telegram_id: typeof item.telegram_id === 'number' ? item.telegram_id : null,
      name: typeof item.name === 'string' ? item.name : '',
      username: typeof item.username === 'string' ? item.username : null,
      total_bounty: typeof item.total_bounty === 'number' ? item.total_bounty : 0,
      games: typeof item.games === 'number' ? item.games : 0,
    } satisfies BountySnapshotEntry));
}

export function normalizeGameState(raw: unknown, fallback: GameState): GameState {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};

  const normalized: GameState = {
    ...fallback,
    status: isGameStatus(source.status) ? source.status : fallback.status,
    currentLevelIndex: toWholeNumber(source.currentLevelIndex, fallback.currentLevelIndex),
    timeLeft: Math.max(0, toWholeNumber(source.timeLeft, fallback.timeLeft)),
    lastTickAt: toNullableNumber(source.lastTickAt, fallback.lastTickAt),
    players: toWholeNumber(source.players, fallback.players),
    outs: toWholeNumber(source.outs, fallback.outs),
    rebuys: toWholeNumber(source.rebuys, fallback.rebuys),
    addonCount: toWholeNumber(source.addonCount ?? source.addon_count, fallback.addonCount),
    bonusCount: toWholeNumber(source.bonusCount ?? source.bonus_count, fallback.bonusCount),
    startStack: toWholeNumber(source.startStack ?? source.start_stack, fallback.startStack),
    addonStack: toWholeNumber(source.addonStack ?? source.addon_stack, fallback.addonStack),
    bonusStack: toWholeNumber(source.bonusStack ?? source.bonus_stack, fallback.bonusStack),
    totalStack: fallback.totalStack,
    backgroundUrl: toNullableString(source.backgroundUrl, fallback.backgroundUrl),
    nextGameInfo: toStringValue(source.nextGameInfo, fallback.nextGameInfo),
    showRating: toBoolean(source.showRating, fallback.showRating),
    showLogo: toBoolean(source.showLogo, fallback.showLogo),
    prizeAmount: toWholeNumber(source.prizeAmount, fallback.prizeAmount),
    prizePlaces: toWholeNumber(source.prizePlaces, fallback.prizePlaces),
    tournamentTitle: toStringValue(source.tournamentTitle, fallback.tournamentTitle),
    tournamentBotId: toNullableNumber(source.tournamentBotId, fallback.tournamentBotId),
    nextGameBotId: toNullableNumber(source.nextGameBotId, fallback.nextGameBotId),
    tournamentBuyIn: toNullableNumber(source.tournamentBuyIn, fallback.tournamentBuyIn),
    rebuyCost: toNullableNumber(source.rebuyCost ?? source.rebuy_cost, fallback.rebuyCost),
    addonCost: toNullableNumber(source.addonCost ?? source.addon_cost, fallback.addonCost),
    chipLeaders: normalizeChipLeaders(source.chipLeaders ?? source.chip_leaders, fallback.chipLeaders),
    chipLeaderCollectionActive: toBoolean(
      source.chipLeaderCollectionActive ?? source.chip_leader_collection_active,
      fallback.chipLeaderCollectionActive ?? false
    ),
    resetAt: toWholeNumber(source.resetAt, fallback.resetAt ?? 0),
    tableCount: Math.max(1, toWholeNumber(source.tableCount ?? source.table_count, fallback.tableCount ?? 4)),
    addonOpen: toBoolean(source.addonOpen ?? source.addon_open, fallback.addonOpen ?? false),
    extraAddonCount: toWholeNumber(source.extraAddonCount ?? source.extra_addon_count, fallback.extraAddonCount ?? 0),
    extraBonusCount: toWholeNumber(source.extraBonusCount ?? source.extra_bonus_count, fallback.extraBonusCount ?? 0),
    ratingSnapshot: normalizeRatingSnapshot(source.ratingSnapshot ?? source.rating_snapshot, fallback.ratingSnapshot ?? null),
    bountySnapshot: normalizeBountySnapshot(source.bountySnapshot ?? source.bounty_snapshot, fallback.bountySnapshot ?? null),
  };

  const explicitTotal = source.totalStack ?? source.total_stack;
  normalized.totalStack = toWholeNumber(explicitTotal, calcTotalStack(normalized));

  return normalized;
}

export function hasMissingResetAt(error: unknown) {
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : '';
  return message.includes('resetAt');
}

export function hasMissingNextGameBotId(error: unknown) {
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : '';
  return message.includes('nextGameBotId');
}

export function hasMissingBonusColumns(error: unknown) {
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : '';

  return (
    message.includes('bonusCount') ||
    message.includes('bonusStack') ||
    message.includes('bonus_count') ||
    message.includes('bonus_stack')
  );
}

export function hasMissingTableCount(error: unknown) {
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : '';
  return message.includes('tableCount') || message.includes('table_count');
}

export function hasMissingAddonOpen(error: unknown) {
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : '';
  return message.includes('addonOpen') || message.includes('addon_open');
}

export function hasMissingChipLeaders(error: unknown) {
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : '';

  return message.includes('chipLeaders') || message.includes('chip_leaders');
}

export function hasMissingChipLeaderCollectionActive(error: unknown) {
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : '';

  return message.includes('chipLeaderCollectionActive') || message.includes('chip_leader_collection_active');
}

export function hasIntegerOverflow(error: unknown) {
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : '';
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  return code === '22003' || message.includes('out of range for type integer');
}

export function toLegacyGameState(state: GameState) {
  const { bonusCount, bonusStack, chipLeaders, chipLeaderCollectionActive, ...legacy } = state;
  void bonusCount;
  void bonusStack;
  void chipLeaders;
  void chipLeaderCollectionActive;
  return legacy;
}
