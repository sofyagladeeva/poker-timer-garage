import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, DEFAULT_BLIND_LEVELS, DEFAULT_GAME_STATE } from '../supabase';
import { hasMissingBonusColumns, hasMissingNextGameBotId, hasMissingResetAt, normalizeGameState, toLegacyGameState } from '../gameStateMath';
import type { GameState, BlindLevel, Combination, TournamentRecord } from '../types';

const STATE_KEY = 'poker_game_state';
const BLINDS_KEY = 'poker_blind_levels';
const COMBINATIONS_KEY = 'poker_combinations';
const TOURNAMENTS_KEY = 'poker_tournaments';
const TIMER_DEBUG_LIMIT = 30;

type TimerDebugEntry = {
  at: number;
  source: string;
  status: GameState['status'];
  timeLeft: number;
  lastTickAt: number | null;
  baseTimeLeft: number;
  baseTimestamp: number;
  note: string;
};

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
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeBlindNumber(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
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
  const [timerDebug, setTimerDebug] = useState<TimerDebugEntry[]>([]);

  const isSupabaseConfigured =
    import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_ANON_KEY;
  const [syncReady, setSyncReady] = useState(!isSupabaseConfigured);

  // ─── Refs to avoid stale closures in stable callbacks ───────────────────
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  const blindLevelsRef = useRef(blindLevels);
  blindLevelsRef.current = blindLevels;

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

  // Broadcast channel ref — for low-latency state push (<100ms)
  const broadcastChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Unique client ID to filter out own broadcasts
  const clientId = useRef(Math.random().toString(36).slice(2));

  // Time-based timer: all devices compute timeLeft from the same anchor point,
  // so they stay in sync as long as device clocks are NTP-synced (within ~100ms).
  // baseTimeLeft = canonical seconds remaining at the moment of last sync
  // baseTimestamp = wall-clock time when that sync happened
  const baseTimeLeft  = useRef(gameState.timeLeft);
  const baseTimestamp = useRef(gameState.lastTickAt ?? Date.now());

  // Track when WE last wrote to Supabase — polling won't override local state
  // for 20 seconds after any local write, breaking the multi-device fight cycle
  const lastLocalWriteAt = useRef(0);

  // Guard: don't allow auto-advance until authoritative state is loaded from
  // Supabase. Prevents stale localStorage from writing wrong level to the DB
  // when a second device opens the admin panel mid-tournament.
  const serverLoaded = useRef(!isSupabaseConfigured);

  const pushTimerDebug = useCallback((source: string, snapshot: Partial<GameState>, note = '') => {
    setTimerDebug(prev => {
      const entry: TimerDebugEntry = {
        at: Date.now(),
        source,
        status: snapshot.status ?? gameStateRef.current.status,
        timeLeft: snapshot.timeLeft ?? gameStateRef.current.timeLeft,
        lastTickAt: snapshot.lastTickAt ?? gameStateRef.current.lastTickAt,
        baseTimeLeft: baseTimeLeft.current,
        baseTimestamp: baseTimestamp.current,
        note,
      };

      return [...prev.slice(-(TIMER_DEBUG_LIMIT - 1)), entry];
    });
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
      const elapsed = Math.floor((Date.now() - persistedLastTickAt) / 1000);
      normalized.timeLeft = Math.max(0, persistedTimeLeft - elapsed);
    }

    return {
      persistedLastTickAt,
      persistedTimeLeft,
      persistedState: { ...normalized, timeLeft: persistedTimeLeft },
      liveState: normalized,
    };
  }, []);

  const applySync = useCallback((raw: Record<string, unknown>, source = 'sync') => {
    const { persistedLastTickAt, persistedTimeLeft, persistedState, liveState } = hydrateSyncedState(raw);
    if (persistedLastTickAt) {
      baseTimeLeft.current = persistedTimeLeft;
      baseTimestamp.current = persistedLastTickAt;
    }
    setGameState(liveState);
    saveLocal(STATE_KEY, persistedState);
    pushTimerDebug(
      `applySync:${source}`,
      liveState,
      `persisted=${persistedTimeLeft} tick=${persistedLastTickAt ?? 'null'}`
    );
  }, [hydrateSyncedState, pushTimerDebug]); // eslint-disable-line react-hooks/exhaustive-deps

  const persistGameState = useCallback(async (stateToSave: GameState, immediate = false) => {
    if (immediate && stateToSave.resetAt > 0) {
      const serverCheckResult = await Promise.resolve(
        supabase.from('game_state').select('resetAt').single()
      );
      if (serverCheckResult.data) {
        const serverResetAt = (serverCheckResult.data as Record<string, unknown>).resetAt;
        if (typeof serverResetAt === 'number' && serverResetAt > stateToSave.resetAt) {
          Promise.resolve(supabase.from('game_state').select('*').single())
            .then(({ data }) => { if (data) applySync(data as Record<string, unknown>, 'persist-stale-reset'); });
          return false;
        }
      }
    }

    skipGameStateRealtime.current = true;
    if (skipGameStateTimer.current) clearTimeout(skipGameStateTimer.current);
    skipGameStateTimer.current = setTimeout(() => { skipGameStateRealtime.current = false; }, immediate ? 8000 : 4000);
    lastLocalWriteAt.current = Date.now();

    let payload: Record<string, unknown> = { id: 1, ...stateToSave };
    let error: unknown = null;

    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await supabase.from('game_state').upsert(payload);
      error = result.error;
      if (!error) return true;

      if (hasMissingBonusColumns(error)) {
        payload = { id: 1, ...toLegacyGameState(stateToSave) };
        continue;
      }

      if (hasMissingNextGameBotId(error)) {
        const { nextGameBotId: _nextGameBotId, ...noNextGameBotId } = payload;
        payload = noNextGameBotId;
        continue;
      }

      if (hasMissingResetAt(error)) {
        const { resetAt: _resetAt, ...noReset } = payload;
        payload = noReset;
        continue;
      }

      break;
    }

    if (error) {
      console.error('Failed to persist game_state', error, payload);
      return false;
    }
  }, [applySync]);

  // ─── Supabase real-time subscriptions ───────────────────────────────────
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let cancelled = false;

    // Initial fetch
    Promise.all([
      supabase.from('game_state').select('*').single(),
      supabase.from('blind_levels').select('*').order('id'),
      supabase.from('combinations').select('*').order('created_at'),
    ]).then(async ([gs, bl, combs]) => {
      if (cancelled) return;
      // Mark state as authoritative — allow auto-advance from this point
      serverLoaded.current = true;

      if (gs.data) {
        applySync(gs.data as Record<string, unknown>, 'init');
      }

      if (bl.data && bl.data.length > 0) {
        const normalized = normalizeBlindLevels(bl.data);
        setBlindLevels(normalized);
        saveLocal(BLINDS_KEY, normalized);
      } else if (Array.isArray(bl.data) && bl.data.length === 0) {
        const defaults = normalizeBlindLevels(DEFAULT_BLIND_LEVELS);
        setBlindLevels(defaults);
        saveLocal(BLINDS_KEY, defaults);

        skipBlindRealtime.current = true;
        if (skipBlindTimer.current) clearTimeout(skipBlindTimer.current);
        skipBlindTimer.current = setTimeout(() => { skipBlindRealtime.current = false; }, 4000);

        await supabase.from('blind_levels').insert(defaults);
      }

      if (combs.data) setCombinations(combs.data);
    }).catch(() => {
      if (!cancelled) serverLoaded.current = true;
    }).finally(() => {
      if (!cancelled) setSyncReady(true);
    });

    // Broadcast channel — low-latency (<100ms) for pause/start/level commands
    const bc = supabase.channel('poker-broadcast')
      .on('broadcast', { event: 'game_state' }, (msg) => {
        if (!msg.payload || msg.payload._cid === clientId.current) return;
        const incoming = msg.payload as Record<string, unknown>;
        // Tournament generation check: if resetAt differs, a stale admin may be
        // broadcasting old tournament data. Handle based on which is newer.
        const incomingResetAt = typeof incoming.resetAt === 'number' ? incoming.resetAt : null;
        const localResetAt = gameStateRef.current.resetAt;
        if (incomingResetAt !== null && localResetAt > 0 && incomingResetAt !== localResetAt) {
          if (incomingResetAt > localResetAt) {
            // Newer reset from another device — this is a legitimate new tournament
            applySync(incoming, 'broadcast-newer-reset');
          } else {
            // Incoming is older tournament — stale device, fetch authoritative state
            Promise.resolve(supabase.from('game_state').select('*').single())
              .then(({ data }) => { if (data) applySync(data as Record<string, unknown>, 'broadcast-stale-fetch'); });
          }
          return;
        }
        applySync(incoming, 'broadcast');
      })
      .subscribe();
    broadcastChannelRef.current = bc;

    // Real-time (postgres_changes) — for persistence sync on connect/reconnect
    const channel = supabase
      .channel('poker-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, (payload) => {
        if (skipGameStateRealtime.current) return;
        if (!payload.new) return;
        const incoming = payload.new as Record<string, unknown>;
        // Reject if from an older tournament generation (stale admin write to DB)
        const incomingResetAt = typeof incoming.resetAt === 'number' ? incoming.resetAt : null;
        const localResetAt = gameStateRef.current.resetAt;
        if (incomingResetAt !== null && localResetAt > 0 && incomingResetAt < localResetAt) return;
        // Only apply if the incoming state is at least as recent as local.
        const incomingTick = typeof incoming.lastTickAt === 'number' ? incoming.lastTickAt : 0;
        const localTick = gameStateRef.current.lastTickAt ?? 0;
        if (incomingTick < localTick) return;
        applySync(incoming, 'realtime');
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blind_levels' }, () => {
        if (skipBlindRealtime.current) return;
        supabase.from('blind_levels').select('*').order('id').then(({ data }) => {
          if (data) setBlindLevels(normalizeBlindLevels(data));
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'combinations' }, () => {
        if (skipCombinationsRealtime.current) return;
        supabase.from('combinations').select('*').order('created_at').then(({ data }) => {
          if (data) setCombinations(data);
        });
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(bc);
      supabase.removeChannel(channel);
      broadcastChannelRef.current = null;
    };
  }, [isSupabaseConfigured, applySync]);

  // ─── Re-sync when page becomes visible (fixes fullscreen WebSocket drop) ─
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    // Helper: only apply Supabase state if it's at least as recent as local,
    // and from the same tournament generation (resetAt check).
    const applyIfNewer = (data: Record<string, unknown>) => {
      const incomingResetAt = typeof data.resetAt === 'number' ? data.resetAt : null;
      const localResetAt = gameStateRef.current.resetAt;
      if (incomingResetAt !== null && localResetAt > 0 && incomingResetAt < localResetAt) return;
      const incomingTick = typeof data.lastTickAt === 'number' ? data.lastTickAt : 0;
      const localTick = gameStateRef.current.lastTickAt ?? 0;
      if (incomingTick < localTick) return;
      applySync(data, 'poll');
    };

    const syncNow = () => {
      if (document.visibilityState !== 'visible') return;
      supabase.from('game_state').select('*').single().then(({ data }) => {
        if (!data || skipGameStateRealtime.current) return;
        applyIfNewer(data as Record<string, unknown>);
      });
    };

    document.addEventListener('visibilitychange', syncNow);

    // Polling every 2s as backup for realtime disconnects.
    const pollInterval = setInterval(() => {
      if (skipGameStateRealtime.current) return;
      supabase.from('game_state').select('*').single().then(({ data }) => {
        if (!data || skipGameStateRealtime.current) return;
        applyIfNewer(data as Record<string, unknown>);
      });
    }, 2000);

    return () => {
      document.removeEventListener('visibilitychange', syncNow);
      clearInterval(pollInterval);
    };
  }, [isSupabaseConfigured, applySync]);

  // ─── Local timer tick (time-based: all devices compute from same anchor) ─
  useEffect(() => {
    if (gameState.status !== 'running' && gameState.status !== 'break') return;

    const interval = setInterval(() => {
      setGameState(prev => {
        if (prev.status !== 'running' && prev.status !== 'break') return prev;
        const elapsed = Math.floor((Date.now() - baseTimestamp.current) / 1000);
        const newTimeLeft = Math.max(0, baseTimeLeft.current - elapsed);
        if (prev.timeLeft === newTimeLeft) return prev;
        const updated = { ...prev, timeLeft: newTimeLeft };
        if (prev.timeLeft - newTimeLeft > 1) {
          pushTimerDebug(
            'tick-jump',
            updated,
            `delta=${prev.timeLeft - newTimeLeft} base=${baseTimeLeft.current} anchor=${baseTimestamp.current}`
          );
        }
        if (!isSupabaseConfigured) saveLocal(STATE_KEY, updated);
        return updated;
      });
    }, 500);

    return () => clearInterval(interval);
  }, [gameState.status, isSupabaseConfigured]);

  // ─── Admin actions (stable — don't depend on gameState/blindLevels) ─────
  // immediate=true skips debounce — used for pause/start/level changes
  const updateGameState = useCallback((patch: Partial<GameState>, immediate = false) => {
    if (isSupabaseConfigured && !serverLoaded.current) return Promise.resolve(false);

    const nextPatch: Partial<GameState> = { ...patch };
    const nextStatus = nextPatch.status ?? gameStateRef.current.status;

    if (nextStatus === 'running' || nextStatus === 'break') {
      const now = Date.now();
      const elapsed = Math.floor((now - baseTimestamp.current) / 1000);
      const liveTimeLeft = Math.max(0, baseTimeLeft.current - elapsed);

      if (nextPatch.timeLeft === undefined) {
        nextPatch.timeLeft = liveTimeLeft;
      }

      if (nextPatch.lastTickAt === undefined) {
        nextPatch.lastTickAt = now;
      }
    }

    const updated = normalizeGameState({ ...gameStateRef.current, ...nextPatch }, gameStateRef.current);
    setGameState(updated);
    saveLocal(STATE_KEY, updated);
    if (!isSupabaseConfigured) {
      pushTimerDebug(
        immediate ? 'update:immediate' : 'update:debounced',
        updated,
        `patchStatus=${patch.status ?? 'none'} patchTime=${patch.timeLeft ?? 'none'}`
      );
      return Promise.resolve(true);
    }

    // Debounce Supabase writes to avoid a DB call on every counter click
    // Update local time anchor so this device also uses the new base
    if (updated.lastTickAt) {
      baseTimeLeft.current  = updated.timeLeft;
      baseTimestamp.current = updated.lastTickAt;
    }
    pushTimerDebug(
      immediate ? 'update:immediate' : 'update:debounced',
      updated,
      `patchStatus=${patch.status ?? 'none'} patchTime=${patch.timeLeft ?? 'none'}`
    );

    // For immediate actions: broadcast via fast channel first, then persist to DB
    if (immediate && broadcastChannelRef.current) {
      broadcastChannelRef.current.send({
        type: 'broadcast',
        event: 'game_state',
        payload: { ...updated, _cid: clientId.current },
      });
    }

    pendingUpsertState.current = updated;
    if (supabaseUpsertTimer.current) clearTimeout(supabaseUpsertTimer.current);
    if (immediate) {
      return persistGameState(updated, true);
    }

    supabaseUpsertTimer.current = setTimeout(() => {
      const stateToSave = pendingUpsertState.current;
      if (!stateToSave) return;
      void persistGameState(stateToSave, false);
    }, 300);

    return Promise.resolve(true);
  }, [isSupabaseConfigured, persistGameState]);

  const startTimer = useCallback(() => {
    pushTimerDebug(
      'start-click',
      {
        status: 'running',
        timeLeft: gameStateRef.current.timeLeft,
        lastTickAt: Date.now(),
      },
      `current=${gameStateRef.current.timeLeft}`
    );
    updateGameState({ status: 'running', lastTickAt: Date.now() }, true);
  }, [updateGameState]);

  const pauseTimer = useCallback(() => {
    // Capture the actual live time before pausing
    const elapsed = Math.floor((Date.now() - baseTimestamp.current) / 1000);
    const liveTimeLeft = Math.max(0, baseTimeLeft.current - elapsed);
    pushTimerDebug(
      'pause-click',
      {
        status: 'paused',
        timeLeft: liveTimeLeft,
        lastTickAt: Date.now(),
      },
      `elapsed=${elapsed} base=${baseTimeLeft.current} anchor=${baseTimestamp.current}`
    );
    updateGameState({ status: 'paused', timeLeft: liveTimeLeft }, true);
  }, [updateGameState]);

  const nextLevel = useCallback(() => {
    const gs = gameStateRef.current;
    const bl = blindLevelsRef.current;
    const nextIndex = gs.currentLevelIndex + 1;
    if (nextIndex >= bl.length) {
      updateGameState({ status: 'ended' }, true);
      return;
    }
    const nextLvl = bl[nextIndex];
    updateGameState({
      currentLevelIndex: nextIndex,
      timeLeft: nextLvl.duration,
      status: nextLvl.isBreak ? 'break' : 'running',
      lastTickAt: Date.now(),
    }, true);
  }, [updateGameState]);

  // ─── Авто-переход: таймер дошёл до 0 → следующий уровень ──────────────
  // Only the admin (readOnly=false) writes level transitions to Supabase.
  // Display screen is readOnly — it never writes, just follows admin state.
  // serverLoaded guard prevents stale localStorage from triggering nextLevel()
  // on a second device before authoritative server state is received.
  useEffect(() => {
    if (readOnly) return;
    if (!serverLoaded.current) return;
    if (gameState.timeLeft !== 0) return;
    if (gameState.status !== 'running' && gameState.status !== 'break') return;

    // Before advancing, check server state to ensure this device isn't stale.
    // If another admin already reset/advanced (server tick > local tick), sync
    // instead of writing a stale nextLevel() to Supabase.
    if (!isSupabaseConfigured) {
      nextLevel();
      return;
    }

    Promise.resolve(supabase.from('game_state').select('*').single()).then(({ data }) => {
      if (!data) { nextLevel(); return; }
      const serverTick = typeof data.lastTickAt === 'number' ? data.lastTickAt : 0;
      const localTick = gameStateRef.current.lastTickAt ?? 0;
      if (serverTick > localTick) {
        // Server is ahead — someone else already acted, just sync
        applySync(data as Record<string, unknown>, 'auto-advance-server-ahead');
      } else {
        nextLevel();
      }
    }).catch(() => nextLevel());
  }, [readOnly, gameState.timeLeft, gameState.status, nextLevel, isSupabaseConfigured, applySync]);

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
    const now = Date.now();
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
  }, [updateGameState]);

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

  const saveTournament = useCallback(async (gs: GameState, levelsPlayed: number) => {
    if (gs.players === 0 && gs.totalStack === 0) return;
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
      const local: TournamentRecord = { ...record, id: Date.now(), finished_at: new Date().toISOString() };
      saveLocal(TOURNAMENTS_KEY, [local, ...existing]);
      return;
    }

    let { error } = await supabase.from('tournaments').insert(record);
    if (error && hasMissingBonusColumns(error)) {
      const { bonus_count, bonus_stack, ...legacyRecord } = record;
      ({ error } = await supabase.from('tournaments').insert(legacyRecord));
    }
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

  const deleteTournament = useCallback(async (id: number): Promise<void> => {
    if (!isSupabaseConfigured) {
      const existing = loadLocal<TournamentRecord[]>(TOURNAMENTS_KEY, []);
      saveLocal(TOURNAMENTS_KEY, existing.filter(t => t.id !== id));
      return;
    }
    await supabase.from('tournaments').delete().eq('id', id);
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

  return {
    gameState,
    blindLevels,
    combinations,
    syncReady,
    updateGameState,
    startTimer,
    pauseTimer,
    nextLevel,
    prevLevel,
    resetTournament,
    updateBlindLevels,
    updateCombinations,
    saveTournament,
    fetchTournaments,
    deleteTournament,
    timerDebug,
  };
}
