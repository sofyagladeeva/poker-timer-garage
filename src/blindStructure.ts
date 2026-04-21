import type { BlindLevel } from './types';

export const GARAGE_BLIND_PAIRS = [
  { sb: 100, bb: 100 },
  { sb: 100, bb: 200 },
  { sb: 200, bb: 400 },
  { sb: 300, bb: 600 },
  { sb: 500, bb: 1000 },
  { sb: 600, bb: 1200 },
  { sb: 800, bb: 1600 },
  { sb: 1000, bb: 2000 },
  { sb: 1200, bb: 2400 },
  { sb: 1500, bb: 3000 },
  { sb: 2000, bb: 4000 },
  { sb: 3000, bb: 6000 },
  { sb: 4000, bb: 8000 },
  { sb: 5000, bb: 10000 },
  { sb: 10000, bb: 20000 },
  { sb: 15000, bb: 30000 },
] as const;

export function createGarageBlindTemplate(duration = 1200): BlindLevel[] {
  return GARAGE_BLIND_PAIRS.map((pair, idx) => ({
    id: `garage_${idx + 1}`,
    level: idx + 1,
    sb: pair.sb,
    bb: pair.bb,
    ante: pair.bb,
    duration,
    isBreak: false,
  }));
}

export function getNextGarageBlindPair(levels: BlindLevel[]) {
  const regularLevels = levels.filter(level => !level.isBreak);
  const lastLevel = regularLevels[regularLevels.length - 1];

  if (!lastLevel) {
    return GARAGE_BLIND_PAIRS[0];
  }

  const nextPresetIdx = GARAGE_BLIND_PAIRS.findIndex(
    pair => pair.sb === lastLevel.sb && pair.bb === lastLevel.bb
  );

  if (nextPresetIdx >= 0 && nextPresetIdx < GARAGE_BLIND_PAIRS.length - 1) {
    return GARAGE_BLIND_PAIRS[nextPresetIdx + 1];
  }

  const nextSb = Math.max(lastLevel.bb, 100);
  return {
    sb: nextSb,
    bb: nextSb * 2,
  };
}
