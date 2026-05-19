import type { BlindLevel } from './types';

const KNOCKOUT_MARKER_PREFIX = '__KNOCKOUT__';
const DEFAULT_KNOCKOUT_LABEL = 'Игра на вылет';

function normalizeKnockoutLabel(label?: string | null) {
  const trimmed = label?.trim();
  return trimmed ? trimmed : DEFAULT_KNOCKOUT_LABEL;
}

export function isKnockoutLevel(level: BlindLevel | null | undefined) {
  return Boolean(
    level &&
    !level.isBreak &&
    typeof level.breakLabel === 'string' &&
    level.breakLabel.startsWith(KNOCKOUT_MARKER_PREFIX)
  );
}

export function getKnockoutLabel(level: BlindLevel | null | undefined) {
  if (!isKnockoutLevel(level)) return null;

  const rawLabel = level?.breakLabel?.slice(KNOCKOUT_MARKER_PREFIX.length).trim();
  return rawLabel || DEFAULT_KNOCKOUT_LABEL;
}

export function setKnockoutMarker(level: BlindLevel, enabled: boolean, label = DEFAULT_KNOCKOUT_LABEL): BlindLevel {
  if (level.isBreak) return level;

  if (!enabled) {
    if (!isKnockoutLevel(level)) return level;
    return { ...level, breakLabel: undefined };
  }

  return {
    ...level,
    breakLabel: `${KNOCKOUT_MARKER_PREFIX}${normalizeKnockoutLabel(label)}`,
  };
}

export interface KnockoutCountdownInfo {
  index: number;
  level: BlindLevel;
  levelsUntil: number;
  secondsUntil: number;
  startsNow: boolean;
}

export function getNextKnockoutInfo(
  blindLevels: BlindLevel[],
  currentLevelIndex: number,
  currentTimeLeft: number
): KnockoutCountdownInfo | null {
  const currentLevel = blindLevels[currentLevelIndex] ?? null;
  if (isKnockoutLevel(currentLevel) && currentLevel) {
    return {
      index: currentLevelIndex,
      level: currentLevel,
      levelsUntil: 0,
      secondsUntil: 0,
      startsNow: true,
    };
  }

  const nextIndex = blindLevels.findIndex((level, idx) => idx > currentLevelIndex && isKnockoutLevel(level));
  if (nextIndex < 0) return null;

  const secondsUntil = Math.max(0, currentTimeLeft) + blindLevels
    .slice(currentLevelIndex + 1, nextIndex)
    .reduce((sum, level) => sum + level.duration, 0);

  return {
    index: nextIndex,
    level: blindLevels[nextIndex],
    levelsUntil: nextIndex - currentLevelIndex,
    secondsUntil,
    startsNow: false,
  };
}
