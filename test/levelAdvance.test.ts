import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAdvanceLevelPatch } from '../src/levelAdvance.ts';
import type { BlindLevel } from '../src/types.ts';

const LEVELS: BlindLevel[] = [
  {
    id: 'level_1',
    level: 1,
    sb: 100,
    bb: 200,
    ante: 0,
    duration: 1200,
    isBreak: false,
  },
  {
    id: 'level_2',
    level: 2,
    sb: 200,
    bb: 400,
    ante: 0,
    duration: 1200,
    isBreak: false,
  },
  {
    id: 'level_3',
    level: 3,
    sb: 300,
    bb: 600,
    ante: 0,
    duration: 1200,
    isBreak: false,
  },
];

test('buildAdvanceLevelPatch targets the explicit next index without skipping', () => {
  const patch = buildAdvanceLevelPatch(LEVELS, 1, 12_345);

  assert.deepEqual(patch, {
    currentLevelIndex: 1,
    timeLeft: 1200,
    status: 'running',
    lastTickAt: 12_345,
  });
});

test('buildAdvanceLevelPatch ends the tournament after the last level', () => {
  const patch = buildAdvanceLevelPatch(LEVELS, LEVELS.length, 12_345);

  assert.deepEqual(patch, { status: 'ended' });
});
