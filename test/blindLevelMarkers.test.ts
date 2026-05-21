import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getKnockoutLabel,
  getLateRegistrationLevel,
  getNextKnockoutInfo,
  isLateRegistrationLevel,
  setKnockoutMarker,
  setLateRegistrationMarker,
} from '../src/blindLevelMarkers.ts';
import type { BlindLevel } from '../src/types.ts';

const levels: BlindLevel[] = [
  {
    id: '1',
    level: 1,
    sb: 100,
    bb: 200,
    ante: 0,
    duration: 1200,
    isBreak: false,
  },
  {
    id: '2',
    level: 2,
    sb: 200,
    bb: 400,
    ante: 0,
    duration: 1200,
    isBreak: false,
  },
  {
    id: '3',
    level: 0,
    sb: 0,
    bb: 0,
    ante: 0,
    duration: 900,
    isBreak: true,
    breakLabel: 'ПЕРЕРЫВ',
  },
  {
    id: '4',
    level: 3,
    sb: 300,
    bb: 600,
    ante: 0,
    duration: 1200,
    isBreak: false,
  },
];

test('setKnockoutMarker marks a regular level without turning it into a break', () => {
  const marked = setKnockoutMarker(levels[1], true);

  assert.equal(marked.isBreak, false);
  assert.equal(getKnockoutLabel(marked), 'Игра на вылет');
});

test('getNextKnockoutInfo counts through remaining levels and breaks', () => {
  const markedLevels = [...levels];
  markedLevels[3] = setKnockoutMarker(markedLevels[3], true);

  const info = getNextKnockoutInfo(markedLevels, 0, 600);
  assert.ok(info);
  assert.equal(info?.levelsUntil, 3);
  assert.equal(info?.secondsUntil, 600 + 1200 + 900);
  assert.equal(info?.startsNow, false);
});

test('getNextKnockoutInfo returns startsNow for the current knockout level', () => {
  const markedLevels = [...levels];
  markedLevels[1] = setKnockoutMarker(markedLevels[1], true);

  const info = getNextKnockoutInfo(markedLevels, 1, 900);
  assert.ok(info);
  assert.equal(info?.startsNow, true);
  assert.equal(info?.secondsUntil, 0);
});

test('setLateRegistrationMarker marks one level without breaking knockout metadata', () => {
  const lateRegLevel = setLateRegistrationMarker(levels[1], true);
  assert.equal(isLateRegistrationLevel(lateRegLevel), true);

  const combined = setKnockoutMarker(lateRegLevel, true, 'Bubble');
  assert.equal(isLateRegistrationLevel(combined), true);
  assert.equal(getKnockoutLabel(combined), 'Bubble');
});

test('getLateRegistrationLevel returns the marked regular level', () => {
  const markedLevels = [...levels];
  markedLevels[0] = setLateRegistrationMarker(markedLevels[0], true);

  const lateRegLevel = getLateRegistrationLevel(markedLevels);
  assert.ok(lateRegLevel);
  assert.equal(lateRegLevel?.level, 1);
});

test('getLateRegistrationLevel falls back to knockout level when no separate marker exists', () => {
  const markedLevels = [...levels];
  markedLevels[1] = setKnockoutMarker(markedLevels[1], true);

  const lateRegLevel = getLateRegistrationLevel(markedLevels);
  assert.ok(lateRegLevel);
  assert.equal(lateRegLevel?.level, 2);
});
