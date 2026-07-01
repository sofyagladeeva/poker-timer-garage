import assert from 'node:assert/strict';
import test from 'node:test';

import { getRankPoints } from '../src/types.ts';

const SHARES = [0.315, 0.195, 0.137, 0.105, 0.067, 0.054, 0.047, 0.042, 0.038];

function expectedPoints(playerCount: number): number[] {
  const coefficient = 1 + Math.floor(playerCount / 10) * 0.1;
  const pool = 5000 * coefficient;
  return SHARES.map(s => Number((pool * s).toFixed(1)));
}

test('getRankPoints returns empty list below 9 players', () => {
  assert.deepEqual(getRankPoints(8), []);
  assert.deepEqual(getRankPoints(0), []);
});

test('getRankPoints matches 5000 × coefficient formula across player counts', () => {
  for (const n of [9, 10, 19, 20, 34, 42, 100, 103, 130, 145]) {
    assert.deepEqual(getRankPoints(n), expectedPoints(n), `n=${n}`);
  }
});

test('getRankPoints coefficient increases at multiples of 10', () => {
  assert.equal(getRankPoints(9)[0],  Number((5000 * 0.315).toFixed(1)));  // 1575
  assert.equal(getRankPoints(10)[0], Number((5500 * 0.315).toFixed(1)));  // 1732.5
  assert.equal(getRankPoints(20)[0], Number((6000 * 0.315).toFixed(1)));  // 1890
  assert.equal(getRankPoints(100)[0], Number((10000 * 0.315).toFixed(1))); // 3150
});
