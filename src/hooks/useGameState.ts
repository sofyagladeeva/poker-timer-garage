import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, DEFAULT_BLIND_LEVELS, DEFAULT_GAME_STATE } from '../supabase';
import type { GameState, BlindLevel, Combination } from '../types';

const STATE_KEY = 'poker_game_state';
const BLINDS_KEY = 'poker_blind_levels';
const COMBINATIONS_KEY = 'poker_combinations';

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

// ─── Hook ──────────────────────────────────────────────────────────────────
export function useGameState() {
  const [gameState, setGameState] = useState<GameState>(() =>
    loadLocal(STATE_KEY, DEFAULT_GAME_STATE)
  );
  const [blindLevels, setBlindLevels] = useState<BlindLevel[]>(() =>
    loadLocal(BLINDS_KEY, DEFAULT_BLIND_LEVELS)
  );
  const [combinations, setCombinations] = useState<Combination[]>(() =>
    loadLocal(COMBINATIONS_KEY, [])
  );

  const isSupabaseConfigured =
    import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_ANON_KEY;

  // Skip realtime blind_levels updates for a short window after we write
  // (prevents overwriting local optimistic state with stale DB order)
  const skipBlindRealtime = useRef(false);
  const skipBlindTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Supabase real-time subscriptions ───────────────────────────────────
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    // Initial fetch
    Promise.all([
      supabase.from('game_state').select('*').single(),
      supabase.from('blind_levels').select('*').order('id'),
      supabase.from('combinations').select('*').order('created_at'),
    ]).then(([gs, bl, combs]) => {
      if (gs.data) setGameState(gs.data);
      if (bl.data && bl.data.length > 0) setBlindLevels(bl.data);
      if (combs.data) setCombinations(combs.data);
    });

    // Real-time
    const channel = supabase
      .channel('poker-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, (payload) => {
        if (payload.new) setGameState(payload.new as GameState);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blind_levels' }, () => {
        if (skipBlindRealtime.current) return;
        supabase.from('blind_levels').select('*').order('id').then(({ data }) => {
          if (data) setBlindLevels(data);
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'combinations' }, () => {
        supabase.from('combinations').select('*').order('created_at').then(({ data }) => {
          if (data) setCombinations(data);
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
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

  // ─── Admin actions ──────────────────────────────────────────────────────
  const updateGameState = useCallback(async (patch: Partial<GameState>) => {
    const updated = { ...gameState, ...patch };
    setGameState(updated);
    if (!isSupabaseConfigured) {
      saveLocal(STATE_KEY, updated);
      return;
    }
    await supabase.from('game_state').upsert({ id: 1, ...updated });
  }, [gameState, isSupabaseConfigured]);

  const startTimer = useCallback(() => {
    updateGameState({ status: 'running', lastTickAt: Date.now() });
  }, [updateGameState]);

  const pauseTimer = useCallback(() => {
    updateGameState({ status: 'paused' });
  }, [updateGameState]);

  const nextLevel = useCallback(() => {
    const nextIndex = gameState.currentLevelIndex + 1;
    if (nextIndex >= blindLevels.length) {
      updateGameState({ status: 'ended' });
      return;
    }
    const nextLvl = blindLevels[nextIndex];
    updateGameState({
      currentLevelIndex: nextIndex,
      timeLeft: nextLvl.duration,
      status: nextLvl.isBreak ? 'break' : 'running',
    });
  }, [gameState.currentLevelIndex, blindLevels, updateGameState]);

  // Держим актуальную ссылку на nextLevel, чтобы не было stale closure
  const nextLevelRef = useRef(nextLevel);
  useEffect(() => { nextLevelRef.current = nextLevel; }, [nextLevel]);

  // ─── Авто-переход: таймер дошёл до 0 → 2 сек паузы → следующий уровень ──
  useEffect(() => {
    if (gameState.timeLeft !== 0) return;
    if (gameState.status !== 'running' && gameState.status !== 'break') return;

    nextLevelRef.current();
  }, [gameState.timeLeft, gameState.status]);

  const prevLevel = useCallback(() => {
    const prevIndex = Math.max(0, gameState.currentLevelIndex - 1);
    const level = blindLevels[prevIndex];
    updateGameState({
      currentLevelIndex: prevIndex,
      timeLeft: level.duration,
      status: 'paused',
    });
  }, [gameState.currentLevelIndex, blindLevels, updateGameState]);

  const resetTournament = useCallback(() => {
    const first = blindLevels[0];
    updateGameState({
      ...DEFAULT_GAME_STATE,
      timeLeft: first?.duration ?? 1200,
    });
  }, [blindLevels, updateGameState]);

  const updateBlindLevels = useCallback(async (levels: BlindLevel[]) => {
    // Assign sortable IDs so ORDER BY id always returns rows in our desired order
    const ordered = levels.map((l, idx) => ({
      ...l,
      id: `${String(idx).padStart(5, '0')}_${l.id.replace(/^\d{5}_/, '')}`,
    }));
    setBlindLevels(ordered);
    if (!isSupabaseConfigured) {
      saveLocal(BLINDS_KEY, ordered);
      return;
    }
    // Suppress realtime echo for 4s so our optimistic update isn't overwritten
    skipBlindRealtime.current = true;
    if (skipBlindTimer.current) clearTimeout(skipBlindTimer.current);
    skipBlindTimer.current = setTimeout(() => { skipBlindRealtime.current = false; }, 4000);
    await supabase.from('blind_levels').delete().neq('id', '');
    await supabase.from('blind_levels').insert(ordered);
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
  };
}
