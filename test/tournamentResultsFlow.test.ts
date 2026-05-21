import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStoredPlayersPayload,
  buildTournamentResultsSignature,
  calcPaymentDue,
  isIncomingPlayersSnapshotStale,
  parseStoredPlayersPayload,
  sortPlayersForResults,
} from '../src/hooks/useTournamentPlayers.ts';
import {
  deriveTournamentResultsUiState,
  getTournamentResultsButtonLabel,
} from '../src/tournamentResultsFlow.ts';
import type { LiveTournamentPlayer, TournamentResultsPayload } from '../src/types.ts';

function createPlayer(overrides: Partial<LiveTournamentPlayer> = {}): LiveTournamentPlayer {
  return {
    id: overrides.id ?? 'player-1',
    sessionId: overrides.sessionId ?? 100,
    tournamentBotId: overrides.tournamentBotId ?? 77,
    botRegistrationId: overrides.botRegistrationId ?? 'reg-1',
    telegramId: overrides.telegramId ?? 1,
    name: overrides.name ?? 'Alpha',
    username: overrides.username ?? null,
    source: overrides.source ?? 'manual',
    registrationSource: overrides.registrationSource ?? 'registered',
    status: overrides.status ?? 'active',
    arrivalStatus: overrides.arrivalStatus ?? 'paid',
    rebuyCount: overrides.rebuyCount ?? 0,
    addonCount: overrides.addonCount ?? 0,
    bonusCount: overrides.bonusCount ?? 0,
    bounty: overrides.bounty ?? 0,
    paymentDue: overrides.paymentDue ?? 1000,
    paymentMethod: overrides.paymentMethod ?? 'unpaid',
    place: overrides.place ?? null,
    placeOverride: overrides.placeOverride ?? false,
    bustoutOrder: overrides.bustoutOrder ?? null,
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: overrides.createdAt ?? '2026-05-19T12:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-05-19T12:00:00.000Z',
  };
}

test('calcPaymentDue distinguishes paid, free and promo entries', () => {
  assert.equal(calcPaymentDue('paid', 0, 0), 1000);
  assert.equal(calcPaymentDue('free', 0, 0), 0);
  assert.equal(calcPaymentDue('promo', 0, 0), 500);
  assert.equal(calcPaymentDue('paid', 1, 1), 3000);
  assert.equal(calcPaymentDue('free', 0, 1), 1000);
  assert.equal(calcPaymentDue('promo', 1, 1), 1500);
});

test('buildTournamentResultsSignature ignores finishedAt but reacts to actual result changes', () => {
  const basePayload: TournamentResultsPayload = {
    sessionId: 100,
    tournamentBotId: 77,
    tournamentTitle: 'Friday',
    tournamentMode: 'garage',
    finishedAt: '2026-05-19T10:00:00.000Z',
    levelsPlayed: 8,
    gameStatus: 'completed',
    summary: {
      entrants: 10,
      active: 0,
      bustouts: 10,
      pending: 0,
      waitlist: 0,
      rebuys: 2,
      addons: 1,
      bountyTotal: 300,
      paidEntries: 9,
      freeEntries: 1,
      totalDue: 11000,
      bonusCount: 0,
      totalStack: 123000,
    },
    players: [
      {
        id: 'alpha',
        botRegistrationId: 'reg-1',
        telegramId: 1,
        name: 'Alpha',
        username: null,
        source: 'manual',
        registrationSource: 'registered',
        arrivalStatus: 'paid',
        paymentMethod: 'cash',
        paymentDue: 1000,
        rebuyCount: 0,
        addonCount: 0,
        bounty: 100,
        status: 'out',
        place: 1,
        bustoutOrder: 10,
      },
    ],
  };

  const sameDataOtherTime = {
    ...basePayload,
    finishedAt: '2026-05-19T10:05:00.000Z',
  };
  const changedData = {
    ...basePayload,
    players: [{ ...basePayload.players[0], bounty: 200 }],
  };

  assert.equal(
    buildTournamentResultsSignature(basePayload),
    buildTournamentResultsSignature(sameDataOtherTime)
  );
  assert.notEqual(
    buildTournamentResultsSignature(basePayload),
    buildTournamentResultsSignature(changedData)
  );
});

test('stored players payload round-trips results submission metadata', () => {
  const payload = buildStoredPlayersPayload(
    [
      createPlayer({
        id: 'player-1',
        status: 'out',
        place: 1,
        placeOverride: true,
        bustoutOrder: 3,
      }),
    ],
    100,
    77,
    'Friday Garage',
    '2026-05-19T13:00:00.000Z',
    {
      sentAt: '2026-05-19T13:10:00.000Z',
      signature: 'sig-123',
    }
  );

  const parsed = parseStoredPlayersPayload(payload, 100, 77, 'Friday Garage');

  assert.ok(parsed);
  assert.equal(parsed.structured, true);
  assert.equal(parsed.updatedAt, '2026-05-19T13:00:00.000Z');
  assert.deepEqual(parsed.resultsSubmission, {
    sentAt: '2026-05-19T13:10:00.000Z',
    signature: 'sig-123',
  });
  assert.equal(parsed.players.length, 1);
  assert.equal(parsed.players[0]?.place, 1);
});

test('sortPlayersForResults puts placed players first and preserves stable fallback order', () => {
  const players = [
    createPlayer({ id: 'c', name: 'Charlie', status: 'active', place: null, sortOrder: 2 }),
    createPlayer({ id: 'b', name: 'Bravo', status: 'out', place: 2, placeOverride: true, sortOrder: 3 }),
    createPlayer({ id: 'a', name: 'Alpha', status: 'out', place: 1, placeOverride: true, sortOrder: 1 }),
    createPlayer({ id: 'd', name: 'Delta', status: 'active', place: null, sortOrder: 0 }),
  ];

  assert.deepEqual(
    sortPlayersForResults(players).map(player => player.id),
    ['a', 'b', 'd', 'c']
  );
});

test('deriveTournamentResultsUiState and button labels reflect first send, resend and locked states', () => {
  const firstSend = deriveTournamentResultsUiState({
    hasBotResultsTarget: true,
    playersMissingFinalPlace: 0,
    resultsSubmissionSignature: null,
    currentResultsSignature: 'sig-a',
  });
  assert.deepEqual(firstSend, {
    resultsAlreadyCurrent: false,
    resultsNeedResubmit: false,
    canSubmitTournamentResults: true,
  });
  assert.equal(getTournamentResultsButtonLabel({ resultsBusy: false, ...firstSend }), '📤 Отправить в бот');

  const alreadySent = deriveTournamentResultsUiState({
    hasBotResultsTarget: true,
    playersMissingFinalPlace: 0,
    resultsSubmissionSignature: 'sig-a',
    currentResultsSignature: 'sig-a',
  });
  assert.deepEqual(alreadySent, {
    resultsAlreadyCurrent: true,
    resultsNeedResubmit: false,
    canSubmitTournamentResults: false,
  });
  assert.equal(getTournamentResultsButtonLabel({ resultsBusy: false, ...alreadySent }), '✓ Уже отправлено');

  const changedAfterSend = deriveTournamentResultsUiState({
    hasBotResultsTarget: true,
    playersMissingFinalPlace: 0,
    resultsSubmissionSignature: 'sig-a',
    currentResultsSignature: 'sig-b',
  });
  assert.deepEqual(changedAfterSend, {
    resultsAlreadyCurrent: false,
    resultsNeedResubmit: true,
    canSubmitTournamentResults: true,
  });
  assert.equal(getTournamentResultsButtonLabel({ resultsBusy: false, ...changedAfterSend }), '📤 Отправить обновление');

  const missingPlaces = deriveTournamentResultsUiState({
    hasBotResultsTarget: true,
    playersMissingFinalPlace: 2,
    resultsSubmissionSignature: null,
    currentResultsSignature: 'sig-a',
  });
  assert.equal(missingPlaces.canSubmitTournamentResults, false);
});

test('isIncomingPlayersSnapshotStale ignores older shared snapshots and accepts newer ones', () => {
  assert.equal(
    isIncomingPlayersSnapshotStale('2026-05-20T01:00:10.000Z', '2026-05-20T01:00:09.000Z'),
    true
  );
  assert.equal(
    isIncomingPlayersSnapshotStale('2026-05-20T01:00:10.000Z', '2026-05-20T01:00:10.000Z'),
    false
  );
  assert.equal(
    isIncomingPlayersSnapshotStale('2026-05-20T01:00:10.000Z', '2026-05-20T01:00:11.000Z'),
    false
  );
  assert.equal(
    isIncomingPlayersSnapshotStale(null, '2026-05-20T01:00:11.000Z'),
    false
  );
});
