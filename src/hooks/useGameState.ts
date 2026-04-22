import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, DEFAULT_BLIND_LEVELS, DEFAULT_GAME_STATE } from '../supabase';
import { hasMissingBonusColumns, normalizeGameState, toLegacyGameState } from '../gameStateMath';
import type { GameState, BlindLevel, Combination, TournamentRecord } from '../types';

const STATE_KEY = 'poker_game_state';
const BLINDS_KEY = 'poker_blind_levels';
const COMBINATIONS_KEY = 'poker_combinations';
const TOURNAMENTS_KEY = 'poker_tournaments';

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
export function useGameState() {
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

  // ─── Refs to avoid stale closures in stable callbacks ───────────────────
  // Updated synchronously on every render so callbacks always see fresh state
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

  // Debounce Supabase upsert for rapid counter updates
  const supabaseUpsertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUpsertState = useRef<GameState | null>(null);

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

      if (gs.data) {
        const normalizedState = normalizeGameState(gs.data, gameStateRef.current);
        setGameState(normalizedState);
        saveLocal(STATE_KEY, normalizedState);
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
    }).catch(() => {});

    // Real-time
    const channel = supabase
      .channel('poker-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, (payload) => {
        if (skipGameStateRealtime.current) return;
        if (payload.new) {
          let normalizedState = normalizeGameState(payload.new, gameStateRef.current);
          // Drift correction: compensate for Supabase propagation delay
          const raw = payload.new as { lastTickAt?: number };
          if (normalizedState.status === 'running' && raw.lastTickAt) {
            const elapsed = Math.floor((Date.now() - raw.lastTickAt) / 1000);
            if (elapsed < 10) {
              normalizedState = { ...normalizedState, timeLeft: Math.max(0, normalizedState.timeLeft - elapsed) };
            }
          }
          setGameState(normalizedState);
          saveLocal(STATE_KEY, normalizedState);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blind_levels' }, () => {
        if (skipBlindRealtime.current) return;
        supabase.from('blind_levels').select('*').order('id').then(({ data }) => {
          if (data) setBlindLevels(normalizeBlindLevels(data));
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'combinations' }, () => {
        supabase.from('combinations').select('*').order('created_at').then(({ data }) => {
          if (data) setCombinations(data);
        });
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [isSupabaseConfigured]);

  // ─── Re-sync when page becomes visible (fixes fullscreen WebSocket drop) ─
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const syncNow = () => {
      if (document.visibilityState !== 'visible') return;
      supabase.from('game_state').select('*').single().then(({ data }) => {
        if (!data || skipGameStateRealtime.current) return;
        let normalized = normalizeGameState(data as GameState, gameStateRef.current);
        // Drift correction: if running and lastTickAt is fresh (< 10s ago), adjust timeLeft
        const raw = data as { lastTickAt?: number };
        if (normalized.status === 'running' && raw.lastTickAt) {
          const elapsed = Math.floor((Date.now() - raw.lastTickAt) / 1000);
          if (elapsed < 10) {
            normalized = { ...normalized, timeLeft: Math.max(0, normalized.timeLeft - elapsed) };
          }
        }
        setGameState(normalized);
        saveLocal(STATE_KEY, normalized);
      });
    };

    document.addEventListener('visibilitychange', syncNow);

    // Polling every 10s as backup for realtime disconnects
    const pollInterval = setInterval(() => {
      if (skipGameStateRealtime.current) return;
      supabase.from('game_state').select('*').single().then(({ data }) => {
        if (!data || skipGameStateRealtime.current) return;
        const normalized = normalizeGameState(data as GameState, gameStateRef.current);
        const curr = gameStateRef.current;
        // Only apply if status or level changed (don't override local running timer)
        if (normalized.status !== curr.status ||
            normalized.currentLevelIndex !== curr.currentLevelIndex) {
          setGameState(normalized);
          saveLocal(STATE_KEY, normalized);
        }
      });
    }, 10000);

    return () => {
      document.removeEventListener('visibilitychange', syncNow);
      clearInterval(pollInterval);
    };
  }, [isSupabaseConfigured]);

  // ─── Local timer tick ───────────────────────────────────────────────────
  useEffect(() => {
    if (gameState.status !== 'running' && gameState.status !== 'break') return;

    const interval = setInterval(() => {
      setGameState(prev => {
        if (prev.status !== 'running' && prev.status !== 'break') return prev;
        const newTimeLeft = Math.max(0, prev.timeLeft - 1);
        const updated = { ...prev, timeLeft: newTimeLeft };
        if (!isSupabaseConfigured) saveLocal(STATE_KEY, updated);
        return updated;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [gameState.status, isSupabaseConfigured]);

  // ─── Admin actions (stable — don't depend on gameState/blindLevels) ─────
  // immediate=true skips debounce — used for pause/start/level changes
  const updateGameState = useCallback((patch: Partial<GameState>, immediate = false) => {
    const updated = normalizeGameState({ ...gameStateRef.current, ...patch }, gameStateRef.current);
    setGameState(updated);
    saveLocal(STATE_KEY, updated);
    if (!isSupabaseConfigured) return;

    // Debounce Supabase writes to avoid a DB call on every counter click
    pendingUpsertState.current = updated;
    if (supabaseUpsertTimer.current) clearTimeout(supabaseUpsertTimer.current);
    supabaseUpsertTimer.current = setTimeout(async () => {
      const stateToSave = pendingUpsertState.current;
      if (!stateToSave) return;
      skipGameStateRealtime.current = true;
      if (skipGameStateTimer.current) clearTimeout(skipGameStateTimer.current);
      skipGameStateTimer.current = setTimeout(() => { skipGameStateRealtime.current = false; }, 4000);
      let { error } = await supabase.from('game_state').upsert({ id: 1, ...stateToSave });
      if (error && hasMissingBonusColumns(error)) {
        await supabase.from('game_state').upsert({ id: 1, ...toLegacyGameState(stateToSave) });
      }
    }, immediate ? 0 : 300);
  }, [isSupabaseConfigured]);

  const startTimer = useCallback(() => {
    updateGameState({ status: 'running', lastTickAt: Date.now() }, true);
  }, [updateGameState]);

  const pauseTimer = useCallback(() => {
    updateGameState({ status: 'paused' }, true);
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
  useEffect(() => {
    if (gameState.timeLeft !== 0) return;
    if (gameState.status !== 'running' && gameState.status !== 'break') return;

    nextLevel();
  }, [gameState.timeLeft, gameState.status, nextLevel]);

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
    updateGameState({
      ...DEFAULT_GAME_STATE,
      timeLeft: first?.duration ?? 1200,
    });
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

  const updateCombinations = useCallback(async (combs: Combination[]) => {
    setCombinations(combs);
    if (!isSupabaseConfigured) {
      saveLocal(COMBINATIONS_KEY, combs);
      return;
    }
    await supabase.from('combinations').delete().neq('id', '');
    if (combs.length > 0) await supabase.from('combinations').insert(combs);
  }, [isSupabaseConfigured]);

  return {
    gameState,
    blindLevels,
    combinations,
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
  };
}
