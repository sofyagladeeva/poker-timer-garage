import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_GAME_STATE } from '../src/supabase.ts';
import {
  buildGameStatePersistencePatch,
  shouldApplyRemoteGameStateUpdate,
  shouldForceForegroundSyncBeforeWrite,
  stripUnsupportedBonusColumns,
} from '../src/gameStateSync.ts';
import type { GameState } from '../src/types.ts';

function createGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...DEFAULT_GAME_STATE,
    startStack: 20000,
    addonStack: 20000,
    bonusStack: 5000,
    resetAt: 100,
    lastTickAt: 1_000,
    players: 31,
    outs: 18,
    rebuys: 4,
    addonCount: 2,
    bonusCount: 1,
    tournamentTitle: 'Friday',
    ...overrides,
  };
}

test('authoritative server sync wins before authoritative state is loaded', () => {
  const localState = createGameState({
    resetAt: 500,
    lastTickAt: 50_000,
    players: 0,
    outs: 0,
  });

  const shouldApply = shouldApplyRemoteGameStateUpdate({
    incoming: {
      resetAt: 100,
      lastTickAt: 10_000,
      players: 31,
      outs: 20,
    },
    localState,
    hasFreshLocalWrite: false,
    authoritativeLoaded: false,
    authoritativeSource: true,
  });

  assert.equal(shouldApply, true);
});

test('peer broadcast is still rejected when local tournament generation is newer', () => {
  const localState = createGameState({
    resetAt: 500,
    lastTickAt: 50_000,
  });

  const shouldApply = shouldApplyRemoteGameStateUpdate({
    incoming: {
      resetAt: 100,
      lastTickAt: 10_000,
      players: 0,
    },
    localState,
    hasFreshLocalWrite: false,
    authoritativeLoaded: false,
    authoritativeSource: false,
  });

  assert.equal(shouldApply, false);
});

test('game state persistence patch only includes touched fields plus sync anchors', () => {
  const updatedState = createGameState({
    status: 'running',
    timeLeft: 875,
    lastTickAt: 12_345,
    players: 31,
    outs: 20,
  });

  const patch = buildGameStatePersistencePatch(updatedState, {
    status: 'running',
    timeLeft: 875,
  });

  assert.deepEqual(patch, {
    status: 'running',
    timeLeft: 875,
    lastTickAt: 12_345,
    resetAt: 100,
  });
  assert.equal('players' in patch, false);
  assert.equal('outs' in patch, false);
});

test('legacy bonus-column fallback keeps the write scoped to the current patch', () => {
  const staleLocalState = createGameState({
    currentLevelIndex: 4,
    timeLeft: 500,
    lastTickAt: 12_345,
    outs: 20,
    bonusCount: 2,
  });

  const patch = buildGameStatePersistencePatch(staleLocalState, {
    outs: 20,
    bonusCount: 2,
  });

  assert.deepEqual(stripUnsupportedBonusColumns({ id: 1, ...patch }), {
    id: 1,
    outs: 20,
    lastTickAt: 12_345,
    resetAt: 100,
  });
  assert.equal('currentLevelIndex' in patch, false);
  assert.equal('timeLeft' in patch, false);
});

test('foreground wake sync is forced only for long inactive running timers', () => {
  assert.equal(
    shouldForceForegroundSyncBeforeWrite(createGameState({ status: 'running' }), 9_000),
    true
  );
  assert.equal(
    shouldForceForegroundSyncBeforeWrite(createGameState({ status: 'break' }), 9_000),
    true
  );
  assert.equal(
    shouldForceForegroundSyncBeforeWrite(createGameState({ status: 'paused' }), 9_000),
    false
  );
  assert.equal(
    shouldForceForegroundSyncBeforeWrite(createGameState({ status: 'running' }), 5_000),
    false
  );
});
