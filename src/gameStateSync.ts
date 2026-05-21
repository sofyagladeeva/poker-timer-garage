import type { GameState } from './types.ts';

type ShouldApplyRemoteGameStateUpdateArgs = {
  incoming: Record<string, unknown>;
  localState: GameState;
  hasFreshLocalWrite: boolean;
  authoritativeLoaded: boolean;
  authoritativeSource?: boolean;
};

export function shouldApplyRemoteGameStateUpdate({
  incoming,
  localState,
  hasFreshLocalWrite,
  authoritativeLoaded,
  authoritativeSource = false,
}: ShouldApplyRemoteGameStateUpdateArgs) {
  if (authoritativeSource && !authoritativeLoaded) {
    return true;
  }

  const incomingResetAt = typeof incoming.resetAt === 'number' ? incoming.resetAt : null;
  const localResetAt = localState.resetAt;
  if (incomingResetAt !== null && localResetAt > 0 && incomingResetAt < localResetAt) return false;
  if (hasFreshLocalWrite) return false;

  const incomingTick = typeof incoming.lastTickAt === 'number' ? incoming.lastTickAt : 0;
  const localTick = localState.lastTickAt ?? 0;
  return incomingTick >= localTick;
}

export function buildGameStatePersistencePatch(
  updatedState: GameState,
  patch: Partial<GameState>
): Partial<GameState> {
  const persistedPatch: Partial<GameState> = {};

  (Object.keys(patch) as (keyof GameState)[]).forEach(key => {
    Object.assign(persistedPatch, { [key]: updatedState[key] });
  });

  if (!('lastTickAt' in persistedPatch)) {
    persistedPatch.lastTickAt = updatedState.lastTickAt;
  }

  if (!('resetAt' in persistedPatch)) {
    persistedPatch.resetAt = updatedState.resetAt;
  }

  return persistedPatch;
}
