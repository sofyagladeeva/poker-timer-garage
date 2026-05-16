import assert from 'node:assert/strict';
import test from 'node:test';

import { getRankPoints } from '../src/types.ts';

test('getRankPoints returns expected top-9 values for 42 players', () => {
  assert.deepEqual(getRankPoints(42), [284.4, 176.1, 123.7, 94.8, 60.5, 48.8, 42.4, 37.9, 34.3]);
});

test('getRankPoints returns an empty list below the minimum ranked player count', () => {
  assert.deepEqual(getRankPoints(8), []);
});
