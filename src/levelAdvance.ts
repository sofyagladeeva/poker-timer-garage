import type { BlindLevel, GameState } from './types.ts';

export function buildAdvanceLevelPatch(
  blindLevels: BlindLevel[],
  targetIndex: number,
  authoritativeNow: number
): Partial<GameState> {
  if (targetIndex >= blindLevels.length) {
    return { status: 'ended' };
  }

  const targetLevel = blindLevels[targetIndex];
  if (!targetLevel) {
    return { status: 'ended' };
  }

  return {
    currentLevelIndex: targetIndex,
    timeLeft: targetLevel.duration,
    status: targetLevel.isBreak ? 'break' : 'running',
    lastTickAt: authoritativeNow,
  };
}

export function buildAutoAdvanceAnchor(state: Pick<GameState, 'resetAt' | 'currentLevelIndex' | 'lastTickAt' | 'status'>) {
  return [
    Math.max(0, Math.round(state.resetAt || 0)),
    Math.max(0, Math.round(state.currentLevelIndex || 0)),
    typeof state.lastTickAt === 'number' && Number.isFinite(state.lastTickAt)
      ? Math.round(state.lastTickAt)
      : 'none',
    state.status,
  ].join(':');
}
