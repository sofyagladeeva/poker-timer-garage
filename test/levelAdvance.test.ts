import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAdvanceLevelPatch, buildAutoAdvanceAnchor } from '../src/levelAdvance.ts';
import type { BlindLevel, GameState } from '../src/types.ts';

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

test('buildAutoAdvanceAnchor changes when tournament generation, level or tick changes', () => {
  const baseState: Pick<GameState, 'resetAt' | 'currentLevelIndex' | 'lastTickAt' | 'status'> = {
    resetAt: 1_000,
    currentLevelIndex: 2,
    lastTickAt: 55_000,
    status: 'running',
  };

  assert.equal(
    buildAutoAdvanceAnchor(baseState),
    buildAutoAdvanceAnchor({ ...baseState })
  );
  assert.notEqual(
    buildAutoAdvanceAnchor(baseState),
    buildAutoAdvanceAnchor({ ...baseState, currentLevelIndex: 3 })
  );
  assert.notEqual(
    buildAutoAdvanceAnchor(baseState),
    buildAutoAdvanceAnchor({ ...baseState, lastTickAt: 56_000 })
  );
  assert.notEqual(
    buildAutoAdvanceAnchor(baseState),
    buildAutoAdvanceAnchor({ ...baseState, resetAt: 2_000 })
  );
});
