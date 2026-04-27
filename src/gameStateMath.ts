import type { GameState, GameStatus } from './types';

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

export function calcTotalStack(state: Pick<GameState, 'players' | 'rebuys' | 'startStack' | 'addonCount' | 'addonStack' | 'bonusCount' | 'bonusStack'>) {
  return (
    Math.max(0, state.players + state.rebuys) * Math.max(0, state.startStack) +
    Math.max(0, state.addonCount) * Math.max(0, state.addonStack) +
    Math.max(0, state.bonusCount) * Math.max(0, state.bonusStack)
  );
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
    prizeAmount: toWholeNumber(source.prizeAmount, fallback.prizeAmount),
    prizePlaces: toWholeNumber(source.prizePlaces, fallback.prizePlaces),
    tournamentTitle: toStringValue(source.tournamentTitle, fallback.tournamentTitle),
    tournamentBotId: toNullableNumber(source.tournamentBotId, fallback.tournamentBotId),
    nextGameBotId: toNullableNumber(source.nextGameBotId, fallback.nextGameBotId),
    resetAt: toWholeNumber(source.resetAt, fallback.resetAt ?? 0),
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

export function toLegacyGameState(state: GameState) {
  const { bonusCount, bonusStack, ...legacy } = state;
  return legacy;
}
