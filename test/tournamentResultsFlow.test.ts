import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTournamentFinancePayload,
  buildTournamentResultsPayload,
  buildStoredPlayersPayload,
  buildTournamentResultsSignature,
  calcPaymentDue,
  findPlayerWithPlaceConflict,
  isIncomingPlayersSnapshotStale,
  mergeImportedRoster,
  mergeChangedPlayersOntoSnapshot,
  parseEmergencyPlayersPayload,
  parseStoredPlayersPayload,
  recalculatePlayers,
  rosterGroupSort,
  resolveHydratedPlayersSnapshot,
  sortPlayersForResults,
  shouldIgnoreBotRosterResponse,
  trustLoadedPlayersSnapshot,
} from '../src/hooks/useTournamentPlayers.ts';
import {
  buildFloorBustoutConfirmationEntries,
  deriveTournamentResultsUiState,
  getDuplicatePlaces,
  getTournamentResultsButtonLabel,
  shouldBlockNewTournamentForPendingBotResults,
} from '../src/tournamentResultsFlow.ts';
import type { FloorNotification, GameState, LiveTournamentPlayer, TournamentResultsPayload } from '../src/types.ts';

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

function createGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    status: overrides.status ?? 'running',
    currentLevelIndex: overrides.currentLevelIndex ?? 0,
    timeLeft: overrides.timeLeft ?? 900,
    lastTickAt: overrides.lastTickAt ?? Date.now(),
    players: overrides.players ?? 10,
    outs: overrides.outs ?? 3,
    rebuys: overrides.rebuys ?? 2,
    addonCount: overrides.addonCount ?? 1,
    bonusCount: overrides.bonusCount ?? 0,
    startStack: overrides.startStack ?? 20000,
    addonStack: overrides.addonStack ?? 20000,
    bonusStack: overrides.bonusStack ?? 5000,
    totalStack: overrides.totalStack ?? 245000,
    backgroundUrl: overrides.backgroundUrl ?? null,
    nextGameInfo: overrides.nextGameInfo ?? '',
    showRating: overrides.showRating ?? false,
    prizeAmount: overrides.prizeAmount ?? 0,
    prizePlaces: overrides.prizePlaces ?? 3,
    tournamentTitle: overrides.tournamentTitle ?? 'Friday Garage',
    tournamentBotId: overrides.tournamentBotId ?? 77,
    nextGameBotId: overrides.nextGameBotId ?? null,
    resetAt: overrides.resetAt ?? 100,
  };
}

function createFloorNotification(overrides: Partial<FloorNotification> = {}): FloorNotification {
  return {
    id: overrides.id ?? 'notification-1',
    sessionId: overrides.sessionId ?? 100,
    type: overrides.type ?? 'bustout',
    tableNumber: overrides.tableNumber ?? 1,
    playerId: overrides.playerId ?? 'player-1',
    playerName: overrides.playerName ?? 'Alpha',
    projectedPlace: overrides.projectedPlace ?? null,
    bounty: overrides.bounty ?? 0,
    status: overrides.status ?? 'pending',
    createdAt: overrides.createdAt ?? '2026-05-19T12:00:00.000Z',
    confirmedAt: overrides.confirmedAt ?? null,
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

test('buildTournamentResultsPayload excludes absent players from exported results', () => {
  const payload = buildTournamentResultsPayload({
    sessionId: 100,
    tournamentBotId: 77,
    tournamentTitle: 'Friday',
    finishedAt: '2026-05-19T10:00:00.000Z',
    levelsPlayed: 8,
    totalStack: 123000,
    players: [
      createPlayer({
        id: 'absent-1',
        name: 'Absent',
        arrivalStatus: 'absent',
        status: 'registered',
        place: null,
        paymentDue: 0,
      }),
      createPlayer({
        id: 'out-1',
        name: 'Out',
        arrivalStatus: 'paid',
        status: 'out',
        place: 1,
        bustoutOrder: 10,
      }),
    ],
  });

  assert.equal(payload.summary.entrants, 1);
  assert.equal(payload.summary.pending, 0);
  assert.equal(payload.players.length, 1);
  assert.equal(payload.players[0]?.id, 'out-1');
});

test('buildTournamentFinancePayload includes only participating players and keeps payment details', () => {
  const payload = buildTournamentFinancePayload({
    sessionId: 100,
    tournamentBotId: 77,
    tournamentTitle: 'Friday',
    finishedAt: '2026-05-19T10:00:00.000Z',
    levelsPlayed: 8,
    players: [
      createPlayer({
        id: 'absent-1',
        name: 'Absent',
        arrivalStatus: 'absent',
        status: 'registered',
        paymentDue: 0,
        paymentMethod: 'unpaid',
      }),
      createPlayer({
        id: 'paid-1',
        name: 'Paid',
        arrivalStatus: 'paid',
        status: 'out',
        place: 1,
        bustoutOrder: 10,
        paymentDue: 3000,
        paymentMethod: 'card',
        rebuyCount: 1,
        addonCount: 1,
        bonusCount: 1,
        bounty: 500,
      }),
    ],
  });

  assert.equal(payload.summary.entrants, 1);
  assert.equal(payload.summary.totalDue, 3000);
  assert.equal(payload.summary.bonusCount, 1);
  assert.equal(payload.players.length, 1);
  assert.equal(payload.players[0]?.id, 'paid-1');
  assert.equal(payload.players[0]?.paymentMethod, 'card');
  assert.equal(payload.players[0]?.paymentDue, 3000);
});

test('shouldIgnoreBotRosterResponse rejects stale roster from previous game context', () => {
  assert.equal(
    shouldIgnoreBotRosterResponse(100, 77, 101, 88),
    true
  );
  assert.equal(
    shouldIgnoreBotRosterResponse(100, 77, 100, 88),
    true
  );
  assert.equal(
    shouldIgnoreBotRosterResponse(100, 77, 100, 77),
    false
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

test('structured players snapshot stays trusted even when counters in game state drift', () => {
  const snapshot = parseStoredPlayersPayload(
    buildStoredPlayersPayload(
      [
        createPlayer({
          id: 'out-1',
          status: 'out',
          place: 1,
          placeOverride: true,
          bustoutOrder: 10,
          rebuyCount: 1,
          addonCount: 1,
        }),
      ],
      100,
      77,
      'Friday Garage',
      '2026-05-22T19:45:00.000Z'
    ),
    100,
    77,
    'Friday Garage'
  );

  const trusted = trustLoadedPlayersSnapshot(snapshot, createGameState({
    players: 0,
    outs: 0,
    rebuys: 0,
    addonCount: 0,
    bonusCount: 0,
  }));

  assert.ok(trusted);
  assert.equal(trusted.players.length, 1);
  assert.equal(trusted.players[0]?.id, 'out-1');
});

test('emergency snapshot can restore live players for the same bot tournament across session mismatch', () => {
  const emergency = parseEmergencyPlayersPayload(
    buildStoredPlayersPayload(
      [
        createPlayer({
          id: 'live-1',
          sessionId: 100,
          status: 'active',
          arrivalStatus: 'paid',
          rebuyCount: 2,
          addonCount: 1,
        }),
      ],
      100,
      77,
      'Friday Garage',
      '2026-05-22T20:00:00.000Z'
    ),
    200,
    77,
    'Friday Garage'
  );

  assert.ok(emergency);
  assert.equal(emergency.players[0]?.sessionId, 200);

  const resolved = resolveHydratedPlayersSnapshot({
    primarySnapshot: {
      players: [],
      updatedAt: '2026-05-22T20:05:00.000Z',
      revision: 0,
      structured: true,
      resultsSubmission: { sentAt: null, signature: null },
    },
    emergencySnapshot: emergency,
    gameState: createGameState({
      status: 'running',
      resetAt: 200,
      players: 14,
      outs: 4,
      rebuys: 3,
      addonCount: 1,
    }),
  });

  assert.ok(resolved.snapshot);
  assert.equal(resolved.recoveredFromEmergency, true);
  assert.equal(resolved.snapshot?.players.length, 1);
  assert.equal(resolved.snapshot?.players[0]?.id, 'live-1');
});

test('emergency snapshot is ignored for a fresh idle tournament', () => {
  const emergency = parseEmergencyPlayersPayload(
    buildStoredPlayersPayload(
      [createPlayer({ id: 'old-live-1', sessionId: 100, status: 'active' })],
      100,
      77,
      'Friday Garage',
      '2026-05-22T20:00:00.000Z'
    ),
    200,
    77,
    'Friday Garage'
  );

  const resolved = resolveHydratedPlayersSnapshot({
    primarySnapshot: {
      players: [],
      updatedAt: null,
      revision: null,
      structured: true,
      resultsSubmission: { sentAt: null, signature: null },
    },
    emergencySnapshot: emergency,
    gameState: createGameState({
      status: 'idle',
      resetAt: 200,
      players: 0,
      outs: 0,
      rebuys: 0,
      addonCount: 0,
      bonusCount: 0,
    }),
  });

  assert.equal(resolved.snapshot?.players.length ?? 0, 0);
  assert.equal(resolved.recoveredFromEmergency, false);
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

test('recalculatePlayers shifts later bustouts back when an earlier busted player returns', () => {
  const afterReturn = [
    ...Array.from({ length: 4 }, (_, index) => createPlayer({
      id: `early-${index + 1}`,
      name: `Early ${index + 1}`,
      status: 'out',
      place: null,
      bustoutOrder: index + 1,
      updatedAt: `2026-06-23T19:0${index}:00.000Z`,
    })),
    createPlayer({
      id: 'returned-player',
      name: 'Returned Player',
      status: 'active',
      place: null,
      bustoutOrder: null,
      updatedAt: '2026-06-23T20:15:00.000Z',
    }),
    createPlayer({
      id: 'takes-old-place',
      name: 'Takes Old Place',
      status: 'out',
      place: null,
      bustoutOrder: 6,
      updatedAt: '2026-06-23T20:20:00.000Z',
    }),
    createPlayer({
      id: 'next-out',
      name: 'Next Out',
      status: 'out',
      place: null,
      bustoutOrder: 7,
      updatedAt: '2026-06-23T20:25:00.000Z',
    }),
    ...Array.from({ length: 13 }, (_, index) => createPlayer({
      id: `active-${index + 1}`,
      name: `Active ${index + 1}`,
      status: 'active',
      place: null,
      bustoutOrder: null,
      updatedAt: '2026-06-23T20:00:00.000Z',
    })),
  ];

  const recalculatedAfterReturn = recalculatePlayers(afterReturn);

  assert.equal(recalculatedAfterReturn.find(player => player.id === 'returned-player')?.place, null);
  assert.equal(recalculatedAfterReturn.find(player => player.id === 'takes-old-place')?.place, 16);
  assert.equal(recalculatedAfterReturn.find(player => player.id === 'next-out')?.place, 15);

  const afterSecondBust = recalculatePlayers(afterReturn.map(player => (
    player.id === 'returned-player'
      ? { ...player, status: 'out' as const, bustoutOrder: 8, updatedAt: '2026-06-23T20:30:00.000Z' }
      : player
  )));

  assert.equal(afterSecondBust.find(player => player.id === 'returned-player')?.place, 14);
  assert.equal(afterSecondBust.find(player => player.id === 'takes-old-place')?.place, 16);

  const payload = buildTournamentResultsPayload({
    sessionId: 100,
    tournamentBotId: 77,
    tournamentTitle: 'Return Scenario',
    finishedAt: '2026-06-23T21:00:00.000Z',
    levelsPlayed: 12,
    totalStack: 400000,
    players: afterSecondBust,
  });

  assert.equal(payload.players.find(player => player.id === 'takes-old-place')?.place, 16);
  assert.equal(payload.players.find(player => player.id === 'returned-player')?.place, 14);
});

test('recalculatePlayers resolves duplicate projected places without promoting manual bustouts', () => {
  const players = [
    ...Array.from({ length: 26 }, (_, index) => createPlayer({
      id: `filler-${index + 1}`,
      name: `Filler ${index + 1}`,
      status: 'out',
      place: null,
      bustoutOrder: index + 1,
      updatedAt: `2026-06-23T19:${String(index + 1).padStart(2, '0')}:00.000Z`,
    })),
    createPlayer({
      id: 'manual-out',
      name: 'Manual Out',
      status: 'out',
      place: 9,
      bustoutOrder: 27,
      updatedAt: '2026-06-23T20:47:27.627Z',
    }),
    createPlayer({
      id: 'notification-out',
      name: 'Notification Out',
      status: 'out',
      place: 9,
      bustoutOrder: 27,
      placeOverride: true,
      updatedAt: '2026-06-23T20:49:50.904Z',
    }),
    ...[29, 30, 31, 32, 33, 34, 35].map(order => createPlayer({
      id: `late-${order}`,
      name: `Late ${order}`,
      status: 'out',
      place: null,
      bustoutOrder: order,
      updatedAt: `2026-06-23T21:${String(order).padStart(2, '0')}:00.000Z`,
    })),
  ];

  const recalculated = recalculatePlayers(players);

  assert.equal(recalculated.find(player => player.id === 'manual-out')?.place, 9);
  assert.equal(recalculated.find(player => player.id === 'notification-out')?.place, 8);
});

test('buildFloorBustoutConfirmationEntries appends dealer bustout after manual outs', () => {
  const players = [
    ...Array.from({ length: 4 }, (_, index) => createPlayer({
      id: `manual-out-${index + 1}`,
      name: `Manual Out ${index + 1}`,
      status: 'out',
      bustoutOrder: index + 1,
      updatedAt: `2026-06-23T18:0${index}:00.000Z`,
    })),
    createPlayer({
      id: 'dealer-out',
      name: 'Dealer Out',
      status: 'active',
      bustoutOrder: null,
      updatedAt: '2026-06-23T18:49:00.000Z',
    }),
    ...Array.from({ length: 15 }, (_, index) => createPlayer({
      id: `active-${index + 1}`,
      name: `Active ${index + 1}`,
      status: 'active',
      bustoutOrder: null,
    })),
  ];

  const entries = buildFloorBustoutConfirmationEntries({
    notifications: [
      createFloorNotification({
        id: 'dealer-notification',
        playerId: 'dealer-out',
        status: 'pending',
        createdAt: '2026-06-23T18:49:00.000Z',
        bounty: 2,
      }),
    ],
    players,
    confirmingNotificationId: 'dealer-notification',
    bounty: 2,
  });

  assert.deepEqual(entries, [{
    playerId: 'dealer-out',
    bounty: 2,
    requestOrder: 5,
  }]);

  const entrants = players.filter(player => player.arrivalStatus !== 'absent').length;
  const afterConfirm = recalculatePlayers(players.map(player => {
    const entry = entries.find(item => item.playerId === player.id);
    if (!entry) return player;

    return {
      ...player,
      status: 'out' as const,
      bounty: entry.bounty,
      place: Math.max(1, entrants - entry.requestOrder + 1),
      placeOverride: true,
      bustoutOrder: entry.requestOrder,
    };
  }));

  assert.equal(afterConfirm.find(player => player.id === 'dealer-out')?.place, 16);
  assert.equal(afterConfirm.find(player => player.id === 'manual-out-4')?.place, 17);
});

test('buildFloorBustoutConfirmationEntries inserts older pending dealer bustout before later confirmed bustouts', () => {
  const players = [
    createPlayer({
      id: 'manual-out',
      status: 'out',
      bustoutOrder: 1,
      updatedAt: '2026-06-23T18:00:00.000Z',
    }),
    createPlayer({
      id: 'older-pending',
      status: 'active',
      bustoutOrder: null,
      updatedAt: '2026-06-23T18:05:00.000Z',
    }),
    createPlayer({
      id: 'later-confirmed',
      status: 'out',
      bustoutOrder: 2,
      bounty: 1,
      updatedAt: '2026-06-23T18:10:00.000Z',
    }),
  ];

  const entries = buildFloorBustoutConfirmationEntries({
    notifications: [
      createFloorNotification({
        id: 'older-notification',
        playerId: 'older-pending',
        status: 'pending',
        createdAt: '2026-06-23T18:05:00.000Z',
      }),
      createFloorNotification({
        id: 'later-notification',
        playerId: 'later-confirmed',
        status: 'confirmed',
        createdAt: '2026-06-23T18:10:00.000Z',
        bounty: 1,
      }),
    ],
    players,
    confirmingNotificationId: 'older-notification',
    bounty: 3,
  });

  assert.deepEqual(entries, [
    {
      playerId: 'older-pending',
      bounty: 3,
      requestOrder: 2,
    },
    {
      playerId: 'later-confirmed',
      bounty: 1,
      requestOrder: 3,
      requireExistingOut: true,
    },
  ]);
});

test('getDuplicatePlaces returns unique repeated places in ascending order', () => {
  assert.deepEqual(getDuplicatePlaces([3, 1, 3, null, 2, 2, undefined, 5]), [2, 3]);
  assert.deepEqual(getDuplicatePlaces([1, 2, 3]), []);
});

test('findPlayerWithPlaceConflict ignores self and absent players', () => {
  const players = [
    createPlayer({ id: 'a', name: 'Alpha', arrivalStatus: 'paid', place: 5, status: 'out' }),
    createPlayer({ id: 'b', name: 'Bravo', arrivalStatus: 'absent', place: 5, status: 'registered' }),
    createPlayer({ id: 'c', name: 'Charlie', arrivalStatus: 'paid', place: 7, status: 'out' }),
  ];

  assert.equal(findPlayerWithPlaceConflict(players, 'a', 5), null);
  assert.equal(findPlayerWithPlaceConflict(players, 'c', 5)?.id, 'a');
  assert.equal(findPlayerWithPlaceConflict(players, 'c', 8), null);
});

test('mergeChangedPlayersOntoSnapshot preserves unrelated newer players while applying local edits', () => {
  const latestShared = [
    createPlayer({ id: 'a', name: 'Alpha', status: 'active', rebuyCount: 0, updatedAt: '2026-05-22T21:00:00.000Z' }),
    createPlayer({ id: 'b', name: 'Bravo', status: 'out', place: 2, placeOverride: true, bustoutOrder: 2, updatedAt: '2026-05-22T21:01:00.000Z' }),
  ];
  const localChanges = [
    createPlayer({ id: 'a', name: 'Alpha', status: 'out', place: 1, placeOverride: true, bustoutOrder: 1, updatedAt: '2026-05-22T21:02:00.000Z' }),
    createPlayer({ id: 'c', name: 'Charlie', status: 'active', sortOrder: 2, updatedAt: '2026-05-22T21:02:30.000Z' }),
  ];

  const merged = mergeChangedPlayersOntoSnapshot(latestShared, localChanges);

  assert.deepEqual(merged.map(player => player.id), ['a', 'b', 'c']);
  assert.equal(merged.find(player => player.id === 'a')?.status, 'out');
  assert.equal(merged.find(player => player.id === 'b')?.status, 'out');
  assert.equal(merged.find(player => player.id === 'c')?.name, 'Charlie');
});

test('rosterGroupSort puts newer player activations first', () => {
  const players = [
    createPlayer({ id: 'old', name: 'Old', sortOrder: 1, updatedAt: '2026-05-24T10:00:00.000Z' }),
    createPlayer({ id: 'new', name: 'New', sortOrder: 5, updatedAt: '2026-05-24T10:05:00.000Z' }),
    createPlayer({ id: 'mid', name: 'Mid', sortOrder: 3, updatedAt: '2026-05-24T10:03:00.000Z' }),
  ];

  assert.deepEqual([...players].sort(rosterGroupSort).map(player => player.id), ['new', 'mid', 'old']);
});

test('transient absent bot player disappears when bot roster no longer contains them', () => {
  const existingPlayers = [
    createPlayer({
      id: 'cancelled-bot',
      source: 'bot',
      botRegistrationId: 'reg-cancelled',
      telegramId: 2,
      arrivalStatus: 'absent',
      status: 'registered',
      sortOrder: 1,
      paymentMethod: 'unpaid',
      rebuyCount: 0,
      addonCount: 0,
      bonusCount: 0,
      bounty: 0,
      place: null,
      bustoutOrder: null,
    }),
    createPlayer({
      id: 'active-1',
      source: 'bot',
      botRegistrationId: 'reg-active',
      telegramId: 1,
      arrivalStatus: 'paid',
      status: 'active',
      sortOrder: 2,
    }),
  ];
  const merged = mergeImportedRoster(
    existingPlayers,
    [
      {
        botRegistrationId: 'reg-active',
        telegramId: 1,
        name: 'Alpha',
        username: null,
        registrationSource: 'registered',
      },
    ],
    100,
    77,
  );

  assert.deepEqual(merged.players.map(player => player.id), ['active-1']);
});

test('mergeImportedRoster replaces stale unmatched bot roster from another game', () => {
  const previous = [
    createPlayer({
      id: 'old-bot-1',
      source: 'bot',
      botRegistrationId: 'old-reg-1',
      telegramId: 101,
      name: 'Old One',
      arrivalStatus: 'paid',
      status: 'active',
    }),
    createPlayer({
      id: 'old-manual-1',
      source: 'manual',
      botRegistrationId: null,
      telegramId: null,
      name: 'Manual Keeper',
      arrivalStatus: 'paid',
      status: 'active',
    }),
  ];

  const merged = mergeImportedRoster(
    previous,
    [
      {
        botRegistrationId: 'new-reg-1',
        telegramId: 201,
        name: 'New One',
        username: null,
        registrationSource: 'registered',
        sortOrder: 0,
      },
    ],
    100,
    77,
  );

  assert.equal(merged.players.some(player => player.id === 'old-bot-1'), false);
  assert.equal(merged.players.some(player => player.name === 'New One'), true);
  assert.equal(merged.players.some(player => player.id === 'old-manual-1'), true);
});

test('mergeImportedRoster does not duplicate same bot player when registration id changes between syncs', () => {
  const previous = [
    createPlayer({
      id: 'bot-alpha',
      source: 'bot',
      botRegistrationId: 'registration-row-1',
      telegramId: null,
      username: 'alpha_user',
      name: 'Alpha Player',
      arrivalStatus: 'absent',
      status: 'registered',
    }),
  ];

  const merged = mergeImportedRoster(
    previous,
    [
      {
        botRegistrationId: 'registration-row-2',
        telegramId: null,
        username: 'alpha_user',
        name: 'Alpha Player',
        registrationSource: 'registered',
        sortOrder: 0,
      },
    ],
    100,
    77,
  );

  assert.equal(merged.players.length, 1);
  assert.equal(merged.players[0]?.id, 'bot-alpha');
  assert.equal(merged.players[0]?.botRegistrationId, 'registration-row-2');
});

test('mergeImportedRoster only auto-adds early bird bonus when enabled', () => {
  const imported = [
    {
      botRegistrationId: 'early-reg-1',
      telegramId: 301,
      username: 'early_user',
      name: 'Early Player',
      registrationSource: 'registered' as const,
      registeredAt: '2026-06-22T12:00:00.000Z',
      sortOrder: 0,
    },
  ];

  const classic = mergeImportedRoster(
    [],
    imported,
    100,
    77,
    '2026-06-22T19:00:00.000Z',
    true
  );
  const nonClassic = mergeImportedRoster(
    [],
    imported,
    100,
    77,
    '2026-06-22T19:00:00.000Z',
    false
  );

  assert.equal(classic.players[0]?.bonusCount, 1);
  assert.equal(nonClassic.players[0]?.bonusCount, 0);
});

test('deriveTournamentResultsUiState and button labels reflect first send, resend and locked states', () => {
  const firstSend = deriveTournamentResultsUiState({
    hasBotResultsTarget: true,
    playersMissingFinalPlace: 0,
    duplicatePlacesCount: 0,
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
    duplicatePlacesCount: 0,
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
    duplicatePlacesCount: 0,
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
    duplicatePlacesCount: 0,
    resultsSubmissionSignature: null,
    currentResultsSignature: 'sig-a',
  });
  assert.equal(missingPlaces.canSubmitTournamentResults, false);

  const duplicatePlaces = deriveTournamentResultsUiState({
    hasBotResultsTarget: true,
    playersMissingFinalPlace: 0,
    duplicatePlacesCount: 2,
    resultsSubmissionSignature: null,
    currentResultsSignature: 'sig-a',
  });
  assert.equal(duplicatePlaces.canSubmitTournamentResults, false);
});

test('new tournament is blocked for bot games until current results are sent', () => {
  assert.equal(
    shouldBlockNewTournamentForPendingBotResults({
      requiresBotResults: true,
      resultsAlreadyCurrent: false,
    }),
    true
  );
  assert.equal(
    shouldBlockNewTournamentForPendingBotResults({
      requiresBotResults: true,
      resultsAlreadyCurrent: true,
    }),
    false
  );
  assert.equal(
    shouldBlockNewTournamentForPendingBotResults({
      requiresBotResults: false,
      resultsAlreadyCurrent: false,
    }),
    false
  );
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
  assert.equal(
    isIncomingPlayersSnapshotStale('2026-05-20T01:00:20.000Z', '2026-05-20T01:00:05.000Z', 4, 5),
    false
  );
  assert.equal(
    isIncomingPlayersSnapshotStale('2026-05-20T01:00:05.000Z', '2026-05-20T01:00:20.000Z', 6, 5),
    true
  );
});
