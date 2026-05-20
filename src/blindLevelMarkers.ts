import type { BlindLevel } from './types';

const KNOCKOUT_MARKER_PREFIX = '__KNOCKOUT__';
const LEVEL_META_PREFIX = '__LEVEL_META__';
const DEFAULT_KNOCKOUT_LABEL = 'Игра на вылет';

type BlindLevelMarkerMeta = {
  knockoutLabel?: string;
  lateRegistration?: boolean;
};

function normalizeKnockoutLabel(label?: string | null) {
  const trimmed = label?.trim();
  return trimmed ? trimmed : DEFAULT_KNOCKOUT_LABEL;
}

function parseBlindLevelMarkerMeta(level: BlindLevel | null | undefined): BlindLevelMarkerMeta {
  if (!level || level.isBreak || typeof level.breakLabel !== 'string' || !level.breakLabel.trim()) {
    return {};
  }

  const rawLabel = level.breakLabel.trim();
  if (rawLabel.startsWith(LEVEL_META_PREFIX)) {
    const rawMeta = rawLabel.slice(LEVEL_META_PREFIX.length).trim();
    if (!rawMeta) return {};

    try {
      const parsed = JSON.parse(rawMeta) as Record<string, unknown>;
      return {
        knockoutLabel: typeof parsed.knockoutLabel === 'string' && parsed.knockoutLabel.trim()
          ? normalizeKnockoutLabel(parsed.knockoutLabel)
          : undefined,
        lateRegistration: parsed.lateRegistration === true,
      };
    } catch {
      return {};
    }
  }

  if (rawLabel.startsWith(KNOCKOUT_MARKER_PREFIX)) {
    return {
      knockoutLabel: normalizeKnockoutLabel(rawLabel.slice(KNOCKOUT_MARKER_PREFIX.length)),
    };
  }

  return {};
}

function buildBlindLevelMarkerLabel(meta: BlindLevelMarkerMeta) {
  const normalizedMeta: BlindLevelMarkerMeta = {};
  if (meta.knockoutLabel) normalizedMeta.knockoutLabel = normalizeKnockoutLabel(meta.knockoutLabel);
  if (meta.lateRegistration) normalizedMeta.lateRegistration = true;

  if (!normalizedMeta.knockoutLabel && !normalizedMeta.lateRegistration) {
    return undefined;
  }

  if (normalizedMeta.knockoutLabel && !normalizedMeta.lateRegistration) {
    return `${KNOCKOUT_MARKER_PREFIX}${normalizedMeta.knockoutLabel}`;
  }

  return `${LEVEL_META_PREFIX}${JSON.stringify(normalizedMeta)}`;
}

export function isKnockoutLevel(level: BlindLevel | null | undefined) {
  return Boolean(parseBlindLevelMarkerMeta(level).knockoutLabel);
}

export function getKnockoutLabel(level: BlindLevel | null | undefined) {
  return parseBlindLevelMarkerMeta(level).knockoutLabel ?? null;
}

export function setKnockoutMarker(level: BlindLevel, enabled: boolean, label = DEFAULT_KNOCKOUT_LABEL): BlindLevel {
  if (level.isBreak) return level;

  const meta = parseBlindLevelMarkerMeta(level);
  const nextMeta: BlindLevelMarkerMeta = {
    ...meta,
    knockoutLabel: enabled ? normalizeKnockoutLabel(label) : undefined,
  };

  return {
    ...level,
    breakLabel: buildBlindLevelMarkerLabel(nextMeta),
  };
}

export function isLateRegistrationLevel(level: BlindLevel | null | undefined) {
  return parseBlindLevelMarkerMeta(level).lateRegistration === true;
}

export function setLateRegistrationMarker(level: BlindLevel, enabled: boolean): BlindLevel {
  if (level.isBreak) return level;

  const meta = parseBlindLevelMarkerMeta(level);
  const nextMeta: BlindLevelMarkerMeta = {
    ...meta,
    lateRegistration: enabled || undefined,
  };

  return {
    ...level,
    breakLabel: buildBlindLevelMarkerLabel(nextMeta),
  };
}

export function getLateRegistrationLevel(blindLevels: BlindLevel[]) {
  return blindLevels.find(level => isLateRegistrationLevel(level)) ?? null;
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
