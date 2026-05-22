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
