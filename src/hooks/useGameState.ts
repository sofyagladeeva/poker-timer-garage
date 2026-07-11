import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, DEFAULT_BLIND_LEVELS, DEFAULT_GAME_STATE } from '../supabase';
import {
  buildGameStatePersistencePatch,
  shouldApplyRemoteGameStateUpdate,
  shouldForceForegroundSyncBeforeWrite,
  stripUnsupportedBonusColumns,
  stripUnsupportedChipLeaderCollectionColumns,
  stripUnsupportedChipLeaderColumns,
} from '../gameStateSync';
import { hasMissingAddonOpen, hasMissingBonusColumns, hasMissingChipLeaderCollectionActive, hasMissingChipLeaders, hasMissingNextGameBotId, hasMissingResetAt, hasMissingTableCount, normalizeGameState } from '../gameStateMath';
import { buildAdvanceLevelPatch, buildAutoAdvanceAnchor } from '../levelAdvance';
import type {
  GameState,
  BlindLevel,
  Combination,
  TournamentArchiveDetails,
  TournamentRecord,
} from '../types';

const STATE_KEY = 'poker_game_state';
const BLINDS_KEY = 'poker_blind_levels';
const COMBINATIONS_KEY = 'poker_combinations';
const TOURNAMENTS_KEY = 'poker_tournaments';
const CLOCK_OFFSET_KEY = 'poker_server_clock_offset_ms';
const ARCHIVE_DETAILS_TABLE = 'blind_templates';
const ARCHIVE_DETAILS_PREFIX = '__archive_tournament__';
const LOCAL_WRITE_SYNC_GRACE_MS = 20_000;
const INITIAL_SYNC_TIMEOUT_MS = 20_000;
const INITIAL_SYNC_RETRY_COUNT = 2;
const GAME_STATE_POLL_MS = 2_000;
const AUX_SYNC_POLL_MS = 5_000;
const DISPLAY_STALE_RELOAD_MS = 45_000;
const DISPLAY_RAF_SOFT_SYNC_MS = 3_000;
const DISPLAY_HARD_RELOAD_MS = 10_000;
const DISPLAY_WATCHDOG_MS = 5_000;
const AUTO_ADVANCE_SERVER_CHECK_MS = 350;
const FOREGROUND_SYNC_TIMEOUT_MS = 5_000;
const AUTHORITATIVE_RETRY_MS = 10_000;

// ─── Local storage fallback (when Supabase not configured) ─────────────────
function loadLocal<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function saveLocal<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Failed to save ${key} to localStorage`, error);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return `${fallback} ${error.message.trim()}`;
  }

  if (typeof error === 'object' && error && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '').trim();
    if (message) return `${fallback} ${message}`;
  }

  return fallback;
}

async function withRetries<T>(
  run: () => Promise<T>,
  timeoutMs: number,
  label: string,
  attempts: number
): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await withTimeout(run(), timeoutMs, `${label} (attempt ${attempt}/${attempts})`);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await wait(750);
      }
    }
  }

  throw lastError ?? new Error(label);
}

function normalizeBlindNumber(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function hasPersistableChipLeaders(payload: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(payload, 'chipLeaders')) return false;
  return payload.chipLeaders !== null && payload.chipLeaders !== undefined;
}

function createClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function archiveDetailsStorageId(tournamentId: number) {
  return `${ARCHIVE_DETAILS_PREFIX}:${tournamentId}`;
}

function buildArchiveDetailsStorageName(finishedAt: string) {
  return `archive_tournament:${finishedAt}`;
}

function parseArchiveDetailsPayload(payload: unknown): TournamentArchiveDetails | null {
  if (!payload || typeof payload !== 'object') return null;

  const details = payload as Partial<TournamentArchiveDetails>;
  if (!Array.isArray(details.players) || typeof details.savedAt !== 'string') {
    return null;
  }

  return {
    tournamentBotId: details.tournamentBotId ?? null,
    tournamentTitle: details.tournamentTitle,
    resultsSentAt: details.resultsSentAt ?? null,
    resultsSignature: details.resultsSignature ?? null,
    players: details.players,
    summary: details.summary && typeof details.summary === 'object' ? details.summary : null,
    savedAt: details.savedAt,
    personnel: Array.isArray(details.personnel) ? details.personnel : undefined,
  } as TournamentArchiveDetails;
}

function normalizeBlindLevels(levels: BlindLevel[]) {
  let currentLevelNumber = 1;

  return levels.map((level, idx) => {
    const baseId = level.id.replace(/^\d{5}_/, '') || `level_${idx + 1}`;

    if (level.isBreak) {
      return {
        ...level,
        id: `${String(idx).padStart(5, '0')}_${baseId}`,
        level: 0,
        sb: 0,
        bb: 0,
        ante: 0,
        duration: Math.max(60, Math.round(level.duration || 900)),
        breakLabel: (level.breakLabel || 'ПЕРЕРЫВ').trim() || 'ПЕРЕРЫВ',
      };
    }

    const sb = normalizeBlindNumber(level.sb);
    const bb = normalizeBlindNumber(level.bb);
    const anteEnabled = normalizeBlindNumber(level.ante) > 0;

    return {
      ...level,
      id: `${String(idx).padStart(5, '0')}_${baseId}`,
      level: currentLevelNumber++,
      sb,
      bb,
      ante: anteEnabled ? bb : 0,
      duration: Math.max(60, Math.round(level.duration || 1200)),
      isBreak: false,
    };
  });
}

// ─── Hook ──────────────────────────────────────────────────────────────────
export function useGameState(readOnly = false) {
  const [gameState, setGameState] = useState<GameState>(() =>
    normalizeGameState(loadLocal(STATE_KEY, DEFAULT_GAME_STATE), DEFAULT_GAME_STATE)
  );
  const [blindLevels, setBlindLevels] = useState<BlindLevel[]>(() =>
    normalizeBlindLevels(loadLocal(BLINDS_KEY, DEFAULT_BLIND_LEVELS))
  );
  const [combinations, setCombinations] = useState<Combination[]>(() =>
    loadLocal(COMBINATIONS_KEY, [])
  );

  const isSupabaseConfigured =
    import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_ANON_KEY;
  const [syncReady, setSyncReady] = useState(!isSupabaseConfigured);
  const [authoritativeReady, setAuthoritativeReady] = useState(!isSupabaseConfigured);
  const [syncError, setSyncError] = useState<string | null>(null);

  // ─── Refs to avoid stale closures in stable callbacks ───────────────────
  const gameStateRef = useRef(gameState);
  const blindLevelsRef = useRef(blindLevels);
  const clientId = useRef('');

  // Skip realtime blind_levels updates for a short window after we write
  const skipBlindRealtime = useRef(false);
  const skipBlindTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Skip realtime game_state updates for a short window after we write
  const skipGameStateRealtime = useRef(false);
  const skipGameStateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Skip realtime combinations updates for a short window after we write
  const skipCombinationsRealtime = useRef(false);
  const skipCombinationsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce Supabase upsert for rapid counter updates
  const supabaseUpsertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUpsertState = useRef<GameState | null>(null);
  const pendingUpsertPatch = useRef<Partial<GameState> | null>(null);
  const autoAdvancePending = useRef(false);
  const lastAutoAdvanceAnchor = useRef<string | null>(null);

  // Broadcast channel ref — for low-latency state push (<100ms)
  const broadcastChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Time-based timer: all devices compute timeLeft from the same anchor point.
  // baseTimeLeft = canonical seconds remaining at the moment of last sync
  // baseTimestamp = wall-clock time when that sync happened
  const baseTimeLeft  = useRef(gameState.timeLeft);
  const baseTimestamp = useRef(gameState.lastTickAt ?? 0);
  // local clock minus authoritative shared clock
  const serverClockOffsetMs = useRef<number | null>(loadLocal<number | null>(CLOCK_OFFSET_KEY, null));
  const lastClientActivityAt = useRef(0);

  // Track when WE last wrote to Supabase — polling won't override local state
  // for 20 seconds after any local write, breaking the multi-device fight cycle
  const lastLocalWriteAt = useRef(0);
  const hasFreshLocalWrite = useCallback(() => {
    return Date.now() - lastLocalWriteAt.current < LOCAL_WRITE_SYNC_GRACE_MS;
  }, []);
  const lastServerSyncAt = useRef(0);

  // Guard: don't allow auto-advance until authoritative state is loaded from
  // Supabase. Prevents stale localStorage from writing wrong level to the DB
  // when a second device opens the admin panel mid-tournament.
  const serverLoaded = useRef(!isSupabaseConfigured);
  const foregroundSyncRequired = useRef(false);
  const foregroundSyncPromise = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    blindLevelsRef.current = blindLevels;
  }, [blindLevels]);

  useEffect(() => {
    if (!clientId.current) {
      clientId.current = createClientId();
    }
    if (lastClientActivityAt.current === 0) {
      lastClientActivityAt.current = Date.now();
    }
  }, []);

  const markAuthoritativeReady = useCallback(() => {
    serverLoaded.current = true;
    setAuthoritativeReady(true);
    setSyncError(null);
  }, []);

  const markClientActivity = useCallback(() => {
    lastClientActivityAt.current = Date.now();
  }, []);

  const getAuthoritativeNow = useCallback(() => {
    return Date.now() - (serverClockOffsetMs.current ?? 0);
  }, []);

  const syncAuthoritativeClock = useCallback((authoritativeNowMs: number, source?: string) => {
    if (!Number.isFinite(authoritativeNowMs) || authoritativeNowMs <= 0) return;

    void source;
    const nextOffset = Date.now() - authoritativeNowMs;
    serverClockOffsetMs.current = nextOffset;
    saveLocal(CLOCK_OFFSET_KEY, nextOffset);
  }, []);

  // ─── Shared sync helper (stable ref, usable in any effect) ─────────────
  const hydrateSyncedState = useCallback((raw: Record<string, unknown>) => {
    const normalized = normalizeGameState(raw as unknown as GameState, gameStateRef.current);
    const persistedTimeLeft = normalized.timeLeft;
    const persistedLastTickAt = typeof raw.lastTickAt === 'number'
      ? raw.lastTickAt
      : normalized.lastTickAt;

    if (
      persistedLastTickAt &&
      (normalized.status === 'running' || normalized.status === 'break')
    ) {
      const elapsed = Math.floor((getAuthoritativeNow() - persistedLastTickAt) / 1000);
      normalized.timeLeft = Math.max(0, persistedTimeLeft - elapsed);
    }

    return {
      persistedLastTickAt,
      persistedTimeLeft,
      persistedState: { ...normalized, timeLeft: persistedTimeLeft },
      liveState: normalized,
    };
  }, [getAuthoritativeNow]);

  const applySync = useCallback((raw: Record<string, unknown>, source?: string) => {
    void source;
    const { persistedLastTickAt, persistedTimeLeft, persistedState, liveState } = hydrateSyncedState(raw);
    if (persistedLastTickAt) {
      baseTimeLeft.current = persistedTimeLeft;
      baseTimestamp.current = persistedLastTickAt;
    }
    markAuthoritativeReady();
    setGameState(liveState);
    // Update ref immediately — useEffect lags behind by one render cycle.
    // Without this, applyGameStatePatch reads stale currentLevelIndex right
    // after a foreground sync completes (multi-device or wake-from-sleep).
    gameStateRef.current = liveState;
    saveLocal(STATE_KEY, persistedState);
    markClientActivity();
  }, [hydrateSyncedState, markAuthoritativeReady, markClientActivity]);

  const markServerSync = useCallback(() => {
    lastServerSyncAt.current = Date.now();
  }, []);

  const shouldApplyRemoteGameState = useCallback((
    data: Record<string, unknown>,
    authoritativeSource = false
  ) => {
    return shouldApplyRemoteGameStateUpdate({
      incoming: data,
      localState: gameStateRef.current,
      hasFreshLocalWrite: hasFreshLocalWrite(),
      authoritativeLoaded: serverLoaded.current,
      authoritativeSource,
    });
  }, [hasFreshLocalWrite]);

  const applyAuthoritativeGameState = useCallback((data: Record<string, unknown>, source?: string) => {
    markServerSync();
    applySync(data, source);
  }, [applySync, markServerSync]);

  const applyIfNewerGameState = useCallback((
    data: Record<string, unknown>,
    source?: string,
    authoritativeSource = false
  ) => {
    markServerSync();
    if (readOnly && authoritativeSource) {
      applySync(data, source);
      return true;
    }

    if (!shouldApplyRemoteGameState(data, authoritativeSource)) return false;
    applySync(data, source);
    return true;
  }, [applySync, markServerSync, readOnly, shouldApplyRemoteGameState]);

  const applyBlindLevelsSync = useCallback((levels: BlindLevel[]) => {
    const normalized = normalizeBlindLevels(levels);
    setBlindLevels(normalized);
    saveLocal(BLINDS_KEY, normalized);
    markServerSync();
  }, [markServerSync]);

  const applyCombinationsSync = useCallback((nextCombinations: Combination[]) => {
    setCombinations(nextCombinations);
    saveLocal(COMBINATIONS_KEY, nextCombinations);
    markServerSync();
  }, [markServerSync]);

  const syncGameStateFromServer = useCallback(async (source = 'sync') => {
    if (!isSupabaseConfigured || skipGameStateRealtime.current) return false;
    const { data, error } = await supabase.from('game_state').select('*').single();
    if (error) {
      console.error(`game_state sync failed (${source})`, error);
      if (!serverLoaded.current) {
        setSyncError(getErrorMessage(error, 'Не удалось загрузить текущее состояние турнира из Supabase.'));
      }
      return false;
    }
    if (!data || skipGameStateRealtime.current) {
      if (!data && !serverLoaded.current) {
        setSyncError('Supabase не вернул текущее состояние турнира.');
      }
      return false;
    }
    applyIfNewerGameState(data as Record<string, unknown>, source, true);
    return true;
  }, [applyIfNewerGameState, isSupabaseConfigured]);

  const syncBlindLevelsFromServer = useCallback(async () => {
    if (!isSupabaseConfigured || skipBlindRealtime.current) return false;
    const { data, error } = await supabase.from('blind_levels').select('*').order('id');
    if (error) {
      console.error('blind_levels sync failed', error);
      return false;
    }
    if (!data || skipBlindRealtime.current) return false;
    applyBlindLevelsSync(data);
    return true;
  }, [applyBlindLevelsSync, isSupabaseConfigured]);

  const syncCombinationsFromServer = useCallback(async () => {
    if (!isSupabaseConfigured || skipCombinationsRealtime.current) return false;
    const { data, error } = await supabase.from('combinations').select('*').order('created_at');
    if (error) {
      console.error('combinations sync failed', error);
      return false;
    }
    if (!data || skipCombinationsRealtime.current) return false;
    applyCombinationsSync(data);
    return true;
  }, [applyCombinationsSync, isSupabaseConfigured]);

  const queueForegroundSync = useCallback((source = 'visibility') => {
    if (!isSupabaseConfigured) return Promise.resolve(true);
    if (foregroundSyncPromise.current) return foregroundSyncPromise.current;

    const syncPromise = (async () => {
      const gameStateSynced = await syncGameStateFromServer(source);
      await Promise.allSettled([
        syncBlindLevelsFromServer(),
        syncCombinationsFromServer(),
      ]);

      if (gameStateSynced) {
        foregroundSyncRequired.current = false;
      }

      return gameStateSynced;
    })()
      .catch(error => {
        console.error(`Foreground sync failed (${source})`, error);
        return false;
      })
      .finally(() => {
        if (foregroundSyncPromise.current === syncPromise) {
          foregroundSyncPromise.current = null;
        }
      });

    foregroundSyncPromise.current = syncPromise;
    return syncPromise;
  }, [isSupabaseConfigured, syncBlindLevelsFromServer, syncCombinationsFromServer, syncGameStateFromServer]);

  const requestPeerTimeSync = useCallback((source = 'request') => {
    if (!broadcastChannelRef.current) return;

    broadcastChannelRef.current.send({
      type: 'broadcast',
      event: 'time_sync_request',
      payload: {
        _cid: clientId.current,
        requestSentAt: Date.now(),
        source,
      },
    });
  }, []);

  const persistGameState = useCallback(async (
    stateToSave: GameState,
    patchToPersist: Partial<GameState>,
    immediate = false
  ) => {
    skipGameStateRealtime.current = true;
    if (skipGameStateTimer.current) clearTimeout(skipGameStateTimer.current);
    skipGameStateTimer.current = setTimeout(() => { skipGameStateRealtime.current = false; }, immediate ? 8000 : 4000);
    lastLocalWriteAt.current = Date.now();

    if (immediate && stateToSave.resetAt > 0) {
      const serverCheckResult = await Promise.resolve(
        supabase.from('game_state').select('resetAt').single()
      );
      if (serverCheckResult.data) {
        const serverResetAt = (serverCheckResult.data as Record<string, unknown>).resetAt;
        if (typeof serverResetAt === 'number' && serverResetAt > stateToSave.resetAt) {
          Promise.resolve(supabase.from('game_state').select('*').single())
            .then(({ data }) => { if (data) applyAuthoritativeGameState(data as Record<string, unknown>, 'persist-stale-reset'); });
          return false;
        }
      }
    }

    let payload: Record<string, unknown> = { id: 1, ...patchToPersist };
    let error: unknown = null;

    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await supabase.from('game_state').upsert(payload);
      error = result.error;
      if (!error) return true;

      if (hasMissingBonusColumns(error)) {
        payload = stripUnsupportedBonusColumns(payload);
        continue;
      }

      if (hasMissingChipLeaders(error)) {
        if (hasPersistableChipLeaders(payload)) {
          console.error('Cannot persist chip leaders: game_state.chipLeaders column is missing', error);
          return false;
        }
        payload = stripUnsupportedChipLeaderColumns(payload);
        continue;
      }

      if (hasMissingChipLeaderCollectionActive(error)) {
        payload = stripUnsupportedChipLeaderCollectionColumns(payload);
        continue;
      }

      if (hasMissingNextGameBotId(error)) {
        const { nextGameBotId, ...noNextGameBotId } = payload;
        void nextGameBotId;
        payload = noNextGameBotId;
        continue;
      }

      if (hasMissingResetAt(error)) {
        const { resetAt, ...noReset } = payload;
        void resetAt;
        payload = noReset;
        continue;
      }

      if (hasMissingTableCount(error)) {
        const { tableCount, ...noTableCount } = payload;
        void tableCount;
        payload = noTableCount;
        continue;
      }

      if (hasMissingAddonOpen(error)) {
        const { addonOpen, ...noAddonOpen } = payload;
        void addonOpen;
        payload = noAddonOpen;
        continue;
      }

      break;
    }

    if (error) {
      console.error('Failed to persist game_state', error, payload);
      return false;
    }
    return true;
  }, [applyAuthoritativeGameState]);

  // ─── Supabase real-time subscriptions ───────────────────────────────────
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let cancelled = false;

    const loadInitialState = async () => {
      const [gs, bl, combs] = await Promise.allSettled([
        withRetries(
          () => Promise.resolve(supabase.from('game_state').select('*').single()),
          INITIAL_SYNC_TIMEOUT_MS,
          'Initial game_state sync',
          INITIAL_SYNC_RETRY_COUNT
        ),
        withRetries(
          () => Promise.resolve(supabase.from('blind_levels').select('*').order('id')),
          INITIAL_SYNC_TIMEOUT_MS,
          'Initial blind_levels sync',
          INITIAL_SYNC_RETRY_COUNT
        ),
        withRetries(
          () => Promise.resolve(supabase.from('combinations').select('*').order('created_at')),
          INITIAL_SYNC_TIMEOUT_MS,
          'Initial combinations sync',
          INITIAL_SYNC_RETRY_COUNT
        ),
      ]);

      if (cancelled) return;

      if (gs.status === 'fulfilled' && gs.value.data) {
        applyAuthoritativeGameState(gs.value.data as Record<string, unknown>, 'init');
      } else if (gs.status === 'rejected') {
        console.error('Initial game_state sync failed', gs.reason);
        setSyncError(getErrorMessage(gs.reason, 'Не удалось загрузить текущее состояние турнира из Supabase.'));
      } else {
        setSyncError('Supabase не вернул текущее состояние турнира.');
      }

      if (bl.status === 'fulfilled') {
        if (bl.value.data && bl.value.data.length > 0) {
          applyBlindLevelsSync(bl.value.data);
        } else if (Array.isArray(bl.value.data) && bl.value.data.length === 0) {
          const defaults = normalizeBlindLevels(DEFAULT_BLIND_LEVELS);
          setBlindLevels(defaults);
          saveLocal(BLINDS_KEY, defaults);

          skipBlindRealtime.current = true;
          if (skipBlindTimer.current) clearTimeout(skipBlindTimer.current);
          skipBlindTimer.current = setTimeout(() => { skipBlindRealtime.current = false; }, 4000);

          void Promise.resolve(supabase.from('blind_levels').insert(defaults)).catch(error => {
            console.error('Failed to seed blind_levels during initial sync', error);
          });
        }
      } else {
        console.error('Initial blind_levels sync failed', bl.reason);
      }

      if (combs.status === 'fulfilled' && combs.value.data) {
        applyCombinationsSync(combs.value.data);
      } else if (combs.status === 'rejected') {
        console.error('Initial combinations sync failed', combs.reason);
      }
    };

    void loadInitialState()
      .catch(error => {
        if (!cancelled) {
          console.error('Initial Supabase sync crashed', error);
          setSyncError(getErrorMessage(error, 'Первичная синхронизация с Supabase завершилась ошибкой.'));
        }
      })
      .finally(() => {
        if (!cancelled) setSyncReady(true);
      });

    // Broadcast channel — low-latency (<100ms) for pause/start/level commands
    const bc = supabase.channel('poker-broadcast')
      .on('broadcast', { event: 'game_state' }, (msg) => {
        if (!msg.payload || msg.payload._cid === clientId.current) return;
        const incoming = msg.payload as Record<string, unknown>;
        const peerAuthoritativeNow = typeof incoming._serverNow === 'number'
          ? incoming._serverNow
          : null;
        if (peerAuthoritativeNow !== null) {
          syncAuthoritativeClock(peerAuthoritativeNow, 'broadcast');
        }
        if (incoming._force === true) {
          applyAuthoritativeGameState({ ...gameStateRef.current, ...incoming }, 'broadcast-force');
          return;
        }
        // Tournament generation check: if resetAt differs, a stale admin may be
        // broadcasting old tournament data. Handle based on which is newer.
        const incomingResetAt = typeof incoming.resetAt === 'number' ? incoming.resetAt : null;
        const localResetAt = gameStateRef.current.resetAt;
        if (incomingResetAt !== null && localResetAt > 0 && incomingResetAt !== localResetAt) {
          if (incomingResetAt > localResetAt) {
            // Newer reset from another device — this is a legitimate new tournament
            applyAuthoritativeGameState({ ...gameStateRef.current, ...incoming }, 'broadcast-newer-reset');
          } else {
            // Incoming is older tournament — stale device, fetch authoritative state
            Promise.resolve(supabase.from('game_state').select('*').single())
              .then(({ data }) => { if (data) applyAuthoritativeGameState(data as Record<string, unknown>, 'broadcast-stale-fetch'); });
          }
          return;
        }
        applyIfNewerGameState({ ...gameStateRef.current, ...incoming }, 'broadcast');
      })
      .on('broadcast', { event: 'time_sync_request' }, (msg) => {
        const requesterCid = typeof msg.payload?._cid === 'string' ? msg.payload._cid : null;
        const requestSentAt = typeof msg.payload?.requestSentAt === 'number' ? msg.payload.requestSentAt : null;
        if (!requesterCid || requesterCid === clientId.current) return;
        if (!broadcastChannelRef.current) return;
        if (readOnly) return;

        broadcastChannelRef.current.send({
          type: 'broadcast',
          event: 'time_sync_response',
          payload: {
            _cid: clientId.current,
            targetCid: requesterCid,
            requestSentAt,
            serverNow: getAuthoritativeNow(),
          },
        });
      })
      .on('broadcast', { event: 'time_sync_response' }, (msg) => {
        const targetCid = typeof msg.payload?.targetCid === 'string' ? msg.payload.targetCid : null;
        const peerServerNow = typeof msg.payload?.serverNow === 'number' ? msg.payload.serverNow : null;
        const requestSentAt = typeof msg.payload?.requestSentAt === 'number' ? msg.payload.requestSentAt : null;
        if (targetCid !== clientId.current || peerServerNow === null) return;

        const estimatedPeerNow = requestSentAt === null
          ? peerServerNow
          : peerServerNow + Math.max(0, Date.now() - requestSentAt) / 2;
        syncAuthoritativeClock(estimatedPeerNow, 'peer-sync');
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          requestPeerTimeSync('subscribe');
        }
      });
    broadcastChannelRef.current = bc;

    // Real-time (postgres_changes) — for persistence sync on connect/reconnect
    const channel = supabase
      .channel('poker-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, (payload) => {
        const commitTimestampMs = Date.parse(payload.commit_timestamp);
        if (Number.isFinite(commitTimestampMs)) {
          syncAuthoritativeClock(commitTimestampMs, 'realtime');
        }
        if (skipGameStateRealtime.current) return;
        if (!payload.new) return;
        applyIfNewerGameState(payload.new as Record<string, unknown>, 'realtime', true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blind_levels' }, () => {
        if (skipBlindRealtime.current) return;
        void syncBlindLevelsFromServer();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'combinations' }, () => {
        if (skipCombinationsRealtime.current) return;
        void syncCombinationsFromServer();
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(bc);
      supabase.removeChannel(channel);
      broadcastChannelRef.current = null;
    };
  }, [
    isSupabaseConfigured,
    applyAuthoritativeGameState,
    applyBlindLevelsSync,
    applyCombinationsSync,
    applyIfNewerGameState,
    getAuthoritativeNow,
    requestPeerTimeSync,
    syncAuthoritativeClock,
    syncBlindLevelsFromServer,
    syncCombinationsFromServer,
    readOnly,
  ]);

  // ─── Re-sync when page becomes visible (fixes fullscreen WebSocket drop) ─
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const syncNow = () => {
      if (document.visibilityState !== 'visible') {
        foregroundSyncRequired.current = true;
        return;
      }

      requestPeerTimeSync('visibility');
      void queueForegroundSync('visibility');
    };

    document.addEventListener('visibilitychange', syncNow);

    // Polling every 2s as backup for realtime disconnects.
    const gameStatePollInterval = setInterval(() => {
      void syncGameStateFromServer('poll');
    }, GAME_STATE_POLL_MS);

    const auxiliaryPollInterval = setInterval(() => {
      void syncBlindLevelsFromServer();
      void syncCombinationsFromServer();
    }, AUX_SYNC_POLL_MS);

    return () => {
      document.removeEventListener('visibilitychange', syncNow);
      clearInterval(gameStatePollInterval);
      clearInterval(auxiliaryPollInterval);
    };
  }, [isSupabaseConfigured, queueForegroundSync, requestPeerTimeSync, syncBlindLevelsFromServer, syncCombinationsFromServer, syncGameStateFromServer]);

  useEffect(() => {
    if (!isSupabaseConfigured || !readOnly || !syncReady) return;

    const watchdogInterval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (lastServerSyncAt.current === 0) return;

      const staleFor = Date.now() - lastServerSyncAt.current;
      if (staleFor < DISPLAY_STALE_RELOAD_MS) return;

      if (staleFor >= DISPLAY_HARD_RELOAD_MS) {
        console.warn(`Display sync stalled for ${staleFor}ms, forcing hard reload`);
        window.location.reload();
        return;
      }

      console.warn(`Display sync stalled for ${staleFor}ms, forcing soft resync`);
      void syncGameStateFromServer('watchdog');
      void syncBlindLevelsFromServer();
      void syncCombinationsFromServer();
    }, DISPLAY_WATCHDOG_MS);

    // rAF-based watchdog: Smart TV browsers throttle setInterval but keep rAF
    // running. Soft-resync at 10s stale, hard reload at 30s stale.
    let rafId: number;
    let lastRafSoftSyncAt = 0;
    const rafCheck = () => {
      if (lastServerSyncAt.current > 0) {
        const now = Date.now();
        const staleFor = now - lastServerSyncAt.current;
        if (staleFor >= DISPLAY_HARD_RELOAD_MS) {
          console.warn(`rAF watchdog: stalled ${staleFor}ms, reloading`);
          window.location.reload();
          return;
        }
        if (staleFor >= DISPLAY_RAF_SOFT_SYNC_MS && now - lastRafSoftSyncAt >= DISPLAY_RAF_SOFT_SYNC_MS) {
          lastRafSoftSyncAt = now;
          void syncGameStateFromServer('raf-watchdog');
        }
      }
      rafId = requestAnimationFrame(rafCheck);
    };
    rafId = requestAnimationFrame(rafCheck);

    return () => {
      clearInterval(watchdogInterval);
      cancelAnimationFrame(rafId);
    };
  }, [
    isSupabaseConfigured,
    readOnly,
    syncReady,
    syncBlindLevelsFromServer,
    syncCombinationsFromServer,
    syncGameStateFromServer,
  ]);

  useEffect(() => {
    if (!isSupabaseConfigured || !syncReady || authoritativeReady) return;

    const retryAuthoritativeSync = () => {
      if (document.visibilityState !== 'visible') return;
      void queueForegroundSync('authoritative-retry');
    };

    const interval = setInterval(retryAuthoritativeSync, AUTHORITATIVE_RETRY_MS);
    window.addEventListener('online', retryAuthoritativeSync);
    retryAuthoritativeSync();

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', retryAuthoritativeSync);
    };
  }, [authoritativeReady, isSupabaseConfigured, queueForegroundSync, syncReady]);

  // ─── Local timer tick (time-based: all devices compute from same anchor) ─
  useEffect(() => {
    if (gameState.status !== 'running' && gameState.status !== 'break') return;

    const interval = setInterval(() => {
      markClientActivity();
      setGameState(prev => {
        if (prev.status !== 'running' && prev.status !== 'break') return prev;
        const elapsed = Math.floor((getAuthoritativeNow() - baseTimestamp.current) / 1000);
        const newTimeLeft = Math.max(0, baseTimeLeft.current - elapsed);
        if (prev.timeLeft === newTimeLeft) return prev;
        const updated = { ...prev, timeLeft: newTimeLeft };
        if (!isSupabaseConfigured) saveLocal(STATE_KEY, updated);
        return updated;
      });
    }, 500);

    return () => clearInterval(interval);
  }, [gameState.status, getAuthoritativeNow, isSupabaseConfigured, markClientActivity]);

  // ─── Admin actions (stable — don't depend on gameState/blindLevels) ─────
  // immediate=true skips debounce — used for pause/start/level changes
  const applyGameStatePatch = useCallback((patch: Partial<GameState>, immediate = false) => {
    if (isSupabaseConfigured && !serverLoaded.current) return Promise.resolve(false);

    const nextPatch: Partial<GameState> = { ...patch };
    const currentStatus = gameStateRef.current.status;
    const nextStatus = nextPatch.status ?? gameStateRef.current.status;

    if (nextStatus === 'running' || nextStatus === 'break') {
      const now = getAuthoritativeNow();
      const timerWasAdvancing = currentStatus === 'running' || currentStatus === 'break';
      const liveTimeLeft = timerWasAdvancing
        ? Math.max(0, baseTimeLeft.current - Math.floor((now - baseTimestamp.current) / 1000))
        : gameStateRef.current.timeLeft;

      if (nextPatch.timeLeft === undefined) {
        nextPatch.timeLeft = liveTimeLeft;
      }

      if (nextPatch.lastTickAt === undefined) {
        nextPatch.lastTickAt = now;
      }
    }

    const updated = normalizeGameState({ ...gameStateRef.current, ...nextPatch }, gameStateRef.current);
    const persistedPatch = buildGameStatePersistencePatch(updated, nextPatch);
    setGameState(updated);
    // Keep ref in sync immediately so subsequent patches in the same event loop
    // tick (e.g. two rapid player-count updates) read the correct state rather
    // than the pre-render stale snapshot.
    gameStateRef.current = updated;
    saveLocal(STATE_KEY, updated);
    markClientActivity();
    if (!isSupabaseConfigured) return Promise.resolve(true);

    // Debounce Supabase writes to avoid a DB call on every counter click
    // Update local time anchor so this device also uses the new base
    if (updated.lastTickAt) {
      baseTimeLeft.current  = updated.timeLeft;
      baseTimestamp.current = updated.lastTickAt;
    }

    // For immediate actions: broadcast via fast channel first, then persist to DB
    if (immediate && broadcastChannelRef.current) {
      broadcastChannelRef.current.send({
        type: 'broadcast',
        event: 'game_state',
        payload: {
          ...persistedPatch,
          _cid: clientId.current,
          _serverNow: getAuthoritativeNow(),
        },
      });
    }

    pendingUpsertState.current = updated;
    pendingUpsertPatch.current = persistedPatch;
    if (supabaseUpsertTimer.current) clearTimeout(supabaseUpsertTimer.current);
    if (immediate) {
      return persistGameState(updated, persistedPatch, true);
    }

    // Mark write intent immediately — persistGameState sets this too, but only
    // fires after the 300ms debounce. Without this, the 2s poll can race the
    // debounce window: it sees hasFreshLocalWrite=false AND incomingTick equal
    // to localTick, so it applies stale server state (potentially with an older
    // currentLevelIndex) before the local patch reaches Supabase.
    lastLocalWriteAt.current = Date.now();

    supabaseUpsertTimer.current = setTimeout(() => {
      const stateToSave = pendingUpsertState.current;
      const patchToPersist = pendingUpsertPatch.current;
      if (!stateToSave || !patchToPersist) return;
      void persistGameState(stateToSave, patchToPersist, false);
    }, 300);

    return Promise.resolve(true);
  }, [getAuthoritativeNow, isSupabaseConfigured, markClientActivity, persistGameState]);

  const updateGameState = useCallback(async (patch: Partial<GameState>, immediate = false) => {
    if (isSupabaseConfigured && !serverLoaded.current) return false;

    const inactiveForMs = Date.now() - lastClientActivityAt.current;
    const shouldForceWakeSync = isSupabaseConfigured && shouldForceForegroundSyncBeforeWrite(
      gameStateRef.current,
      inactiveForMs
    );

    if (shouldForceWakeSync) {
      foregroundSyncRequired.current = true;
    }

    if (isSupabaseConfigured && (foregroundSyncRequired.current || foregroundSyncPromise.current || shouldForceWakeSync)) {
      const wakeSync = foregroundSyncPromise.current ?? queueForegroundSync('foreground-write');

      try {
        await withTimeout(wakeSync, FOREGROUND_SYNC_TIMEOUT_MS, 'Foreground sync before write');
      } catch (error) {
        console.error('Foreground sync before write timed out', error);
      }

      if (foregroundSyncRequired.current) {
        console.warn('Blocking stale write until foreground sync succeeds');
        return false;
      }
    }

    return applyGameStatePatch(patch, immediate);
  }, [applyGameStatePatch, isSupabaseConfigured, queueForegroundSync]);

  const startTimer = useCallback(() => {
    updateGameState({ status: 'running', lastTickAt: getAuthoritativeNow() }, true);
  }, [getAuthoritativeNow, updateGameState]);

  const pauseTimer = useCallback(() => {
    // Capture the actual live time before pausing
    const elapsed = Math.floor((getAuthoritativeNow() - baseTimestamp.current) / 1000);
    const liveTimeLeft = Math.max(0, baseTimeLeft.current - elapsed);
    updateGameState({ status: 'paused', timeLeft: liveTimeLeft }, true);
  }, [getAuthoritativeNow, updateGameState]);

  const forceSyncDisplays = useCallback(async () => {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('game_state').select('*').single();
      if (error || !data) {
        const message = error
          ? getErrorMessage(error, 'Не удалось перечитать текущее состояние турнира перед синхронизацией экранов.')
          : 'Supabase не вернул текущее состояние турнира перед синхронизацией экранов.';
        console.error('Display force sync preflight failed', error);
        setSyncError(message);
        return false;
      }

      applyAuthoritativeGameState(data as Record<string, unknown>, 'force-display-sync-preflight');
    }

    const now = getAuthoritativeNow();
    const current = gameStateRef.current;
    const timerRunning = current.status === 'running' || current.status === 'break';
    const liveTimeLeft = timerRunning
      ? Math.max(0, baseTimeLeft.current - Math.floor((now - baseTimestamp.current) / 1000))
      : current.timeLeft;
    const synced = normalizeGameState({
      ...current,
      timeLeft: liveTimeLeft,
      lastTickAt: timerRunning ? now : current.lastTickAt,
    }, current);
    // Write full state so TVs with dead WebSocket pick up everything via polling.
    const persistedPatch = synced;

    setGameState(synced);
    gameStateRef.current = synced;
    saveLocal(STATE_KEY, synced);
    markClientActivity();

    if (synced.lastTickAt) {
      baseTimeLeft.current = synced.timeLeft;
      baseTimestamp.current = synced.lastTickAt;
    }

    if (!isSupabaseConfigured) return Promise.resolve(true);

    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.send({
        type: 'broadcast',
        event: 'game_state',
        payload: {
          ...synced,
          _cid: clientId.current,
          _force: true,
          _serverNow: now,
        },
      });
    }

    return persistGameState(synced, persistedPatch, true);
  }, [applyAuthoritativeGameState, getAuthoritativeNow, isSupabaseConfigured, markClientActivity, persistGameState]);

  const advanceToLevelIndex = useCallback((targetIndex: number) => {
    const patch = buildAdvanceLevelPatch(blindLevelsRef.current, targetIndex, getAuthoritativeNow());
    return updateGameState(patch, true);
  }, [getAuthoritativeNow, updateGameState]);

  const nextLevel = useCallback(() => {
    const nextIndex = gameStateRef.current.currentLevelIndex + 1;
    return advanceToLevelIndex(nextIndex);
  }, [advanceToLevelIndex]);

  useEffect(() => {
    if (gameState.timeLeft === 0 && (gameState.status === 'running' || gameState.status === 'break')) {
      return;
    }

    lastAutoAdvanceAnchor.current = null;
  }, [gameState.status, gameState.timeLeft]);

  // ─── Авто-переход: таймер дошёл до 0 → следующий уровень ──────────────
  // Only the admin client advances levels. Read-only Display screens can have
  // weak network or stale local state; letting them write creates level races.
  // serverLoaded guard prevents stale localStorage from triggering nextLevel()
  // before authoritative server state is received.
  useEffect(() => {
    if (readOnly) return;
    if (!serverLoaded.current) return;
    if (gameState.timeLeft !== 0) return;
    if (gameState.status !== 'running' && gameState.status !== 'break') return;
    if (autoAdvancePending.current) return;

    const autoAdvanceAnchor = buildAutoAdvanceAnchor(gameState);
    if (lastAutoAdvanceAnchor.current === autoAdvanceAnchor) return;

    lastAutoAdvanceAnchor.current = autoAdvanceAnchor;
    autoAdvancePending.current = true;
    const targetIndex = gameState.currentLevelIndex + 1;
    if (targetIndex >= blindLevelsRef.current.length) {
      autoAdvancePending.current = false;
      return;
    }

    const advanceImmediately = () => {
      void advanceToLevelIndex(targetIndex).then(applied => {
        if (applied === false && lastAutoAdvanceAnchor.current === autoAdvanceAnchor) {
          lastAutoAdvanceAnchor.current = null;
        }
      });
    };

    // Before advancing, check server state to ensure this device isn't stale.
    // If another admin already reset/advanced (server tick > local tick), sync
    // instead of writing a stale nextLevel() to Supabase.
    // If the check itself fails, keep the tournament moving from the local
    // timer anchor. Displays are read-only, so they cannot race this write.
    if (!isSupabaseConfigured) {
      advanceImmediately();
      autoAdvancePending.current = false;
      return;
    }

    void withTimeout(
      Promise.resolve(supabase.from('game_state').select('*').single()),
      AUTO_ADVANCE_SERVER_CHECK_MS,
      'Auto-advance server check'
    )
      .then(({ data }) => {
        if (!data) {
          advanceImmediately();
          return;
        }
        const serverTick = typeof data.lastTickAt === 'number' ? data.lastTickAt : 0;
        const localTick = gameStateRef.current.lastTickAt ?? 0;
        const serverLevelIndex = typeof data.currentLevelIndex === 'number' ? data.currentLevelIndex : null;
        if (serverLevelIndex !== null && serverLevelIndex !== gameStateRef.current.currentLevelIndex) {
          applyAuthoritativeGameState(data as Record<string, unknown>, 'auto-advance-level-mismatch');
          return;
        }
        if (serverTick > localTick) {
          // Server is ahead — someone else already acted, just sync
          applyAuthoritativeGameState(data as Record<string, unknown>, 'auto-advance-server-ahead');
        } else {
          advanceImmediately();
        }
      })
      .catch(() => {
        advanceImmediately();
      })
      .finally(() => {
        autoAdvancePending.current = false;
      });
  }, [
    readOnly,
    gameState,
    advanceToLevelIndex,
    isSupabaseConfigured,
    applyAuthoritativeGameState,
  ]);

  useEffect(() => {
    if (readOnly) return;
    if (!serverLoaded.current) return;
    if (!gameState.chipLeaders) return;

    const hideAfterLevelIndex = gameState.chipLeaders.hideAfterLevelIndex ?? gameState.chipLeaders.levelIndex;
    if (gameState.currentLevelIndex <= hideAfterLevelIndex) return;

    void updateGameState({ chipLeaders: null }, true);
  }, [readOnly, gameState.currentLevelIndex, gameState.chipLeaders, updateGameState]);

  const prevLevel = useCallback(() => {
    const gs = gameStateRef.current;
    const bl = blindLevelsRef.current;
    const prevIndex = Math.max(0, gs.currentLevelIndex - 1);
    const level = bl[prevIndex];
    if (!level) return;
    updateGameState({
      currentLevelIndex: prevIndex,
      timeLeft: level.duration,
      status: 'paused',
    }, true);
  }, [updateGameState]);

  const resetTournament = useCallback(() => {
    const bl = blindLevelsRef.current;
    const first = bl[0];
    const now = getAuthoritativeNow();
    const { nextGameBotId, nextGameInfo } = gameStateRef.current;
    // immediate=true: broadcast instantly to all devices so their timers stop.
    // resetAt = now: tournament generation marker — stale devices that missed
    // this broadcast will be rejected when they try to write old game data.
    return updateGameState({
      ...DEFAULT_GAME_STATE,
      nextGameBotId,
      nextGameInfo,
      timeLeft: first?.duration ?? 1200,
      lastTickAt: now,
      resetAt: now,
    }, true);
  }, [getAuthoritativeNow, updateGameState]);

  const updateBlindLevels = useCallback(async (levels: BlindLevel[]) => {
    const ordered = normalizeBlindLevels(levels);
    setBlindLevels(ordered);
    if (!isSupabaseConfigured) {
      saveLocal(BLINDS_KEY, ordered);
      return;
    }
    skipBlindRealtime.current = true;
    if (skipBlindTimer.current) clearTimeout(skipBlindTimer.current);
    skipBlindTimer.current = setTimeout(() => { skipBlindRealtime.current = false; }, 4000);
    await supabase.from('blind_levels').delete().neq('id', '');
    await supabase.from('blind_levels').insert(ordered);
  }, [isSupabaseConfigured]);

  const saveTournament = useCallback(async (
    gs: GameState,
    levelsPlayed: number,
    archiveDetails?: TournamentArchiveDetails | null
  ) => {
    if (gs.players === 0 && gs.totalStack === 0 && !archiveDetails) return;
    const record = {
      title: gs.tournamentTitle || null,
      players: gs.players,
      rebuys: gs.rebuys ?? 0,
      addon_count: gs.addonCount ?? 0,
      bonus_count: gs.bonusCount ?? 0,
      bonus_stack: gs.bonusStack ?? 0,
      total_stack: gs.totalStack,
      levels_played: levelsPlayed,
    };
    if (!isSupabaseConfigured) {
      const existing = loadLocal<TournamentRecord[]>(TOURNAMENTS_KEY, []);
      const local: TournamentRecord = {
        ...record,
        id: Date.now(),
        finished_at: new Date().toISOString(),
        archive_details: archiveDetails ?? null,
      };
      saveLocal(TOURNAMENTS_KEY, [local, ...existing]);
      return;
    }

    let insertResult = await supabase
      .from('tournaments')
      .insert(record)
      .select('id, finished_at')
      .single();

    if (insertResult.error && hasMissingBonusColumns(insertResult.error)) {
      const { bonus_count, bonus_stack, ...legacyRecord } = record;
      void bonus_count;
      void bonus_stack;
      insertResult = await supabase
        .from('tournaments')
        .insert(legacyRecord)
        .select('id, finished_at')
        .single();
    }

    if (insertResult.error || !archiveDetails || !insertResult.data) {
      return;
    }

    await supabase.from(ARCHIVE_DETAILS_TABLE).upsert({
      id: archiveDetailsStorageId(Number(insertResult.data.id)),
      name: buildArchiveDetailsStorageName(insertResult.data.finished_at),
      levels: archiveDetails,
    });
  }, [isSupabaseConfigured]);

  const fetchTournaments = useCallback(async (): Promise<TournamentRecord[]> => {
    if (!isSupabaseConfigured) {
      return loadLocal<TournamentRecord[]>(TOURNAMENTS_KEY, []);
    }
    const { data } = await supabase
      .from('tournaments')
      .select('*')
      .order('finished_at', { ascending: false })
      .limit(50);
    return data ?? [];
  }, [isSupabaseConfigured]);

  const fetchTournamentArchiveDetails = useCallback(async (id: number): Promise<TournamentArchiveDetails | null> => {
    if (!isSupabaseConfigured) {
      const existing = loadLocal<TournamentRecord[]>(TOURNAMENTS_KEY, []);
      return existing.find(t => t.id === id)?.archive_details ?? null;
    }

    const { data, error } = await supabase
      .from(ARCHIVE_DETAILS_TABLE)
      .select('levels')
      .eq('id', archiveDetailsStorageId(id))
      .maybeSingle();

    if (error || !data?.levels || typeof data.levels !== 'object') {
      return null;
    }

    return parseArchiveDetailsPayload(data.levels);
  }, [isSupabaseConfigured]);

  const fetchTournamentArchiveDetailsBatch = useCallback(async (ids: number[]): Promise<Record<number, TournamentArchiveDetails | null>> => {
    const uniqueIds = Array.from(new Set(ids.filter(id => Number.isFinite(id))));
    if (uniqueIds.length === 0) return {};

    if (!isSupabaseConfigured) {
      const existing = loadLocal<TournamentRecord[]>(TOURNAMENTS_KEY, []);
      return uniqueIds.reduce<Record<number, TournamentArchiveDetails | null>>((acc, id) => {
        acc[id] = existing.find(t => t.id === id)?.archive_details ?? null;
        return acc;
      }, {});
    }

    const storageIds = uniqueIds.map(archiveDetailsStorageId);
    const { data, error } = await supabase
      .from(ARCHIVE_DETAILS_TABLE)
      .select('id, levels')
      .in('id', storageIds);

    const next = uniqueIds.reduce<Record<number, TournamentArchiveDetails | null>>((acc, id) => {
      acc[id] = null;
      return acc;
    }, {});

    if (error || !data) {
      return next;
    }

    for (const row of data) {
      const rawId = typeof row.id === 'string' ? row.id : '';
      const tournamentId = Number(rawId.slice(`${ARCHIVE_DETAILS_PREFIX}:`.length));
      if (!Number.isFinite(tournamentId)) continue;
      next[tournamentId] = parseArchiveDetailsPayload(row.levels);
    }

    return next;
  }, [isSupabaseConfigured]);

  const updateTournamentArchiveDetails = useCallback(async (
    tournamentId: number,
    finishedAt: string,
    details: TournamentArchiveDetails
  ): Promise<void> => {
    if (!isSupabaseConfigured) {
      const existing = loadLocal<TournamentRecord[]>(TOURNAMENTS_KEY, []);
      const updated = existing.map(t =>
        t.id === tournamentId ? { ...t, archive_details: details } : t
      );
      saveLocal(TOURNAMENTS_KEY, updated);
      return;
    }
    await supabase.from(ARCHIVE_DETAILS_TABLE).upsert({
      id: archiveDetailsStorageId(tournamentId),
      name: buildArchiveDetailsStorageName(finishedAt),
      levels: details,
    });
  }, [isSupabaseConfigured]);

  const deleteTournament = useCallback(async (id: number): Promise<void> => {
    if (!isSupabaseConfigured) {
      const existing = loadLocal<TournamentRecord[]>(TOURNAMENTS_KEY, []);
      saveLocal(TOURNAMENTS_KEY, existing.filter(t => t.id !== id));
      return;
    }
    await supabase.from('tournaments').delete().eq('id', id);
    await supabase.from(ARCHIVE_DETAILS_TABLE).delete().eq('id', archiveDetailsStorageId(id));
  }, [isSupabaseConfigured]);

  const updateCombinations = useCallback(async (combs: Combination[]) => {
    setCombinations(combs);
    if (!isSupabaseConfigured) {
      saveLocal(COMBINATIONS_KEY, combs);
      return;
    }
    skipCombinationsRealtime.current = true;
    if (skipCombinationsTimer.current) clearTimeout(skipCombinationsTimer.current);
    skipCombinationsTimer.current = setTimeout(() => { skipCombinationsRealtime.current = false; }, 4000);
    await supabase.from('combinations').delete().neq('id', '');
    if (combs.length > 0) await supabase.from('combinations').insert(combs);
  }, [isSupabaseConfigured]);

  const retrySync = useCallback(async () => {
    if (!isSupabaseConfigured) return true;

    setSyncError(null);
    setSyncReady(false);

    try {
      return await queueForegroundSync('manual-retry');
    } catch (error) {
      setSyncError(getErrorMessage(error, 'Повторная синхронизация с Supabase завершилась ошибкой.'));
      return false;
    } finally {
      setSyncReady(true);
    }
  }, [isSupabaseConfigured, queueForegroundSync]);

  return {
    gameState,
    blindLevels,
    combinations,
    syncReady,
    authoritativeReady,
    syncError,
    getAuthoritativeNow,
    retrySync,
    updateGameState,
    forceSyncDisplays,
    startTimer,
    pauseTimer,
    nextLevel,
    prevLevel,
    resetTournament,
    updateBlindLevels,
    updateCombinations,
    saveTournament,
    fetchTournaments,
    fetchTournamentArchiveDetails,
    fetchTournamentArchiveDetailsBatch,
    updateTournamentArchiveDetails,
    deleteTournament,
  };
}
