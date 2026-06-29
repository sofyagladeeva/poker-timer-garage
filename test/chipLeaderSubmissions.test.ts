import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTopChipLeaders,
  getActiveChipLeaderTables,
  getChipLeaderHideAfterLevelIndex,
  getRequiredStackCountForTable,
  haveAllActiveTablesSubmitted,
} from '../src/chipLeaderSubmissions.ts';
import type { ChipLeaderSubmission, LiveTournamentPlayer } from '../src/types.ts';

function player(overrides: Partial<LiveTournamentPlayer>): LiveTournamentPlayer {
  return {
    id: overrides.id ?? 'p1',
    sessionId: 100,
    tournamentBotId: null,
    botRegistrationId: null,
    telegramId: null,
    name: overrides.name ?? 'Player',
    username: null,
    realName: null,
    phone: null,
    instagram: null,
    source: 'manual',
    registrationSource: 'registered',
    status: overrides.status ?? 'active',
    arrivalStatus: overrides.arrivalStatus ?? 'paid',
    rebuyCount: 0,
    addonCount: 0,
    bonusCount: 0,
    bounty: 0,
    bonusRcPoints: 0,
    cashPaid: 0,
    cardPaid: 0,
    paymentDue: 0,
    paymentDueOverride: false,
    place: null,
    placeOverride: false,
    bustoutOrder: null,
    sortOrder: 0,
    registeredAt: null,
    createdAt: '',
    updatedAt: '',
    tableNumber: overrides.tableNumber ?? 1,
    seatNumber: overrides.seatNumber ?? 1,
  };
}

function submission(tableNumber: number, stacks: Array<[string, string, number]>): ChipLeaderSubmission {
  return {
    sessionId: 100,
    levelIndex: 5,
    tableNumber,
    submittedAt: '',
    entries: stacks.map(([playerId, name, stack], index) => ({
      playerId,
      name,
      stack,
      tableNumber,
      seatNumber: index + 1,
    })),
  };
}

test('active chip leader tables include only tables with live tournament players', () => {
  const players = [
    player({ id: 'a', tableNumber: 1, seatNumber: 1 }),
    player({ id: 'b', tableNumber: 1, seatNumber: 2 }),
    player({ id: 'c', tableNumber: 2, seatNumber: 1 }),
    player({ id: 'out', tableNumber: 3, status: 'out' }),
    player({ id: 'absent', tableNumber: 4, arrivalStatus: 'absent' }),
    player({ id: 'unseated', tableNumber: null }),
  ];

  assert.deepEqual(getActiveChipLeaderTables(players), [1, 2]);
});

test('required stack count is three unless fewer active players remain at table', () => {
  assert.equal(getRequiredStackCountForTable([
    player({ id: 'a' }),
    player({ id: 'b' }),
  ]), 2);

  assert.equal(getRequiredStackCountForTable([
    player({ id: 'a' }),
    player({ id: 'b' }),
    player({ id: 'c' }),
    player({ id: 'd' }),
  ]), 3);
});

test('all active tables are complete only when every active table submitted stacks', () => {
  const submissions = [
    submission(1, [['a', 'A', 100_000]]),
    submission(3, [['x', 'X', 90_000]]),
  ];

  assert.equal(haveAllActiveTablesSubmitted([1, 2], submissions), false);
  assert.equal(haveAllActiveTablesSubmitted([1, 3], submissions), true);
});

test('top chip leaders are the three biggest stacks across all submissions', () => {
  const top = buildTopChipLeaders([
    submission(1, [
      ['a', 'A', 80_000],
      ['b', 'B', 220_000],
    ]),
    submission(2, [
      ['c', 'C', 140_000],
      ['d', 'D', 180_000],
    ]),
  ]);

  assert.deepEqual(top.map(entry => [entry.playerId, entry.stack]), [
    ['b', 220_000],
    ['d', 180_000],
    ['c', 140_000],
  ]);
});

test('chip leader display window lasts through the next level when collected during break', () => {
  assert.equal(getChipLeaderHideAfterLevelIndex('break', 6), 7);
  assert.equal(getChipLeaderHideAfterLevelIndex('running', 6), 6);
});
