import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTournamentBotLiveSyncPayload } from '../src/tournamentBotLiveSync.ts';
import { setKnockoutMarker } from '../src/blindLevelMarkers.ts';
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
  setKnockoutMarker({
    id: 'level_2',
    level: 2,
    sb: 200,
    bb: 400,
    ante: 0,
    duration: 1200,
    isBreak: false,
  }, true, 'Knockout'),
];

test('buildTournamentBotLiveSyncPayload returns null without tournament id', () => {
  const payload = buildTournamentBotLiveSyncPayload({
    tournamentBotId: null,
    tournamentTitle: 'Test',
    status: 'running',
    currentLevelIndex: 0,
    currentTimeLeft: 600,
    playersInGame: 12,
    playersRegistered: 18,
    playersOut: 6,
    blindLevels: LEVELS,
    authoritativeNowMs: Date.UTC(2026, 4, 19, 12, 0, 0),
  });

  assert.equal(payload, null);
});

test('buildTournamentBotLiveSyncPayload includes active players and knockout ETA', () => {
  const authoritativeNowMs = Date.UTC(2026, 4, 19, 12, 0, 0);
  const payload = buildTournamentBotLiveSyncPayload({
    tournamentBotId: 77,
    tournamentTitle: 'Crazy Friday',
    status: 'running',
    currentLevelIndex: 0,
    currentTimeLeft: 600,
    playersInGame: 14,
    playersRegistered: 21,
    playersOut: 7,
    blindLevels: LEVELS,
    authoritativeNowMs,
  });

  assert.ok(payload);
  assert.equal(payload.playersInGame, 14);
  assert.equal(payload.playersRegistered, 21);
  assert.equal(payload.playersOut, 7);
  assert.equal(payload.knockout?.label, 'Knockout');
  assert.equal(payload.knockout?.secondsUntil, 600);
  assert.equal(payload.knockout?.startsAt, new Date(authoritativeNowMs + 600_000).toISOString());
});
