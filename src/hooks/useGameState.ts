import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, DEFAULT_BLIND_LEVELS, DEFAULT_GAME_STATE } from '../supabase';
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

function roundToHundreds(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value / 100) * 100);
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

    const sb = Math.max(100, roundToHundreds(level.sb));
    const rawBb = Math.max(100, roundToHundreds(level.bb));
    const bb = Math.max(rawBb, sb);

    return {
      ...level,
      id: `${String(idx).padStart(5, '0')}_${baseId}`,
      level: currentLevelNumber++,
      sb,
      bb,
      ante: bb,
      duration: Math.max(60, Math.round(level.duration || 1200)),
      isBreak: false,
    };
  });
}

// ─── Hook ──────────────────────────────────────────────────────────────────
export function useGameState() {
  const [gameState, setGameState] = useState<GameState>(() =>
    loadLocal(STATE_KEY, DEFAULT_GAME_STATE)
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
      if (bl.data && bl.data.length > 0) setBlindLevels(normalizeBlindLevels(bl.data));
      if (combs.data) setCombinations(combs.data);
    }).catch(() => {});

    // Real-time
    const channel = supabase
      .channel('poker-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, (payload) => {
        if (payload.new) setGameState(payload.new as GameState);
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

  // ─── Admin actions (stable — don't depend on gameState/blindLevels) ─────
  const updateGameState = useCallback(async (patch: Partial<GameState>) => {
    const updated = { ...gameStateRef.current, ...patch };
    setGameState(updated);
    if (!isSupabaseConfigured) {
      saveLocal(STATE_KEY, updated);
      return;
    }
    await supabase.from('game_state').upsert({ id: 1, ...updated });
  }, [isSupabaseConfigured]);

  const startTimer = useCallback(() => {
    updateGameState({ status: 'running', lastTickAt: Date.now() });
  }, [updateGameState]);

  const pauseTimer = useCallback(() => {
    updateGameState({ status: 'paused' });
  }, [updateGameState]);

  const nextLevel = useCallback(() => {
    const gs = gameStateRef.current;
    const bl = blindLevelsRef.current;
    const nextIndex = gs.currentLevelIndex + 1;
    if (nextIndex >= bl.length) {
      updateGameState({ status: 'ended' });
      return;
    }
    const nextLvl = bl[nextIndex];
    updateGameState({
      currentLevelIndex: nextIndex,
      timeLeft: nextLvl.duration,
      status: nextLvl.isBreak ? 'break' : 'running',
    });
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
    });
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
      total_stack: gs.totalStack,
      levels_played: levelsPlayed,
    };
    if (!isSupabaseConfigured) {
      const existing = loadLocal<TournamentRecord[]>(TOURNAMENTS_KEY, []);
      const local: TournamentRecord = { ...record, id: Date.now(), finished_at: new Date().toISOString() };
      saveLocal(TOURNAMENTS_KEY, [local, ...existing]);
      return;
    }
    await supabase.from('tournaments').insert(record);
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
