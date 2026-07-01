import assert from 'node:assert/strict';
import test from 'node:test';

import { getRankPoints } from '../src/types.ts';

test('getRankPoints returns expected top-9 values for 42 players', () => {
  // coefficient = 1.4, pool = 7000
  assert.deepEqual(getRankPoints(42), [2205, 1365, 959, 735, 469, 378, 329, 294, 266]);
});

test('getRankPoints returns an empty list below the minimum ranked player count', () => {
  assert.deepEqual(getRankPoints(8), []);
});
