import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase.ts';
import type { LiveTournamentPlayer } from '../types.ts';
import {
  buildStoredPlayersPayload,
  mergeChangedPlayersOntoSnapshot,
  parseStoredPlayersPayload,
  recalculatePlayers,
} from './useTournamentPlayers.ts';
import { useFloorNotifications } from './useFloorNotifications.ts';
import { getNextBustoutProjectedPlace } from '../tournamentResultsFlow.ts';

const SEATS_PER_TABLE = 9;

function nowIso() {
  return new Date().toISOString();
}

function clampWhole(v: number) {
  return Math.max(0, Math.round(v));
}

function sharedPlayersKey(sessionId: number, tournamentBotId: number | null) {
  return `__live_players__:${sessionId}:${tournamentBotId ?? 'manual'}`;
}

type SharedRow = { id: string; name: string; levels: unknown; created_at: string };

async function loadSharedSnapshot(
  sessionId: number,
  tournamentBotId: number | null
): Promise<{ players: LiveTournamentPlayer[]; revision: number }> {
  const id = sharedPlayersKey(sessionId, tournamentBotId);
  const { data, error } = await supabase
    .from('blind_templates')
    .select('id, name, levels, created_at')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return { players: [], revision: 0 };

  const row = data as SharedRow;
  const snapshot = parseStoredPlayersPayload(row.levels, sessionId, tournamentBotId, '');
  return { players: snapshot?.players ?? [], revision: snapshot?.revision ?? 0 };
}

async function loadSharedPlayers(
  sessionId: number,
  tournamentBotId: number | null
): Promise<LiveTournamentPlayer[]> {
  return (await loadSharedSnapshot(sessionId, tournamentBotId)).players;
}

async function saveSharedPlayers(
  players: LiveTournamentPlayer[],
  sessionId: number,
  tournamentBotId: number | null,
  revision: number
) {
  const id = sharedPlayersKey(sessionId, tournamentBotId);
  const payload = buildStoredPlayersPayload(players, sessionId, tournamentBotId, '', nowIso(), { sentAt: null, signature: null }, revision);
  await supabase.from('blind_templates').upsert({ id, name: `live_tournament_players:${nowIso()}`, levels: payload });
}

type GameContext = { sessionId: number; tournamentBotId: number | null; addonOpen: boolean };

export function useDealerTable(tableNumber: number) {
  const [players, setPlayers] = useState<LiveTournamentPlayer[]>([]);
  const [gameContext, setGameContext] = useState<GameContext>({ sessionId: 1, tournamentBotId: null, addonOpen: false });
  const [loading, setLoading] = useState(true);
  const gameContextRef = useRef(gameContext);
  const playersRef = useRef(players);

  useEffect(() => { gameContextRef.current = gameContext; }, [gameContext]);
  useEffect(() => { playersRef.current = players; }, [players]);

  const { createNotification } = useFloorNotifications(gameContext.sessionId);

  const applyMutation = useCallback(async (
    mutate: (current: LiveTournamentPlayer[]) => LiveTournamentPlayer[]
  ) => {
    const { sessionId, tournamentBotId } = gameContextRef.current;
    const { players: latest, revision } = await loadSharedSnapshot(sessionId, tournamentBotId);
    const mutated = recalculatePlayers(mutate(latest).map(p => ({ ...p, updatedAt: nowIso() })));
    const changed = mutated.filter((next: LiveTournamentPlayer) => {
      const prev = latest.find(p => p.id === next.id);
      return !prev || prev.rebuyCount !== next.rebuyCount || prev.status !== next.status || prev.bustoutOrder !== next.bustoutOrder || prev.addonCount !== next.addonCount || prev.realName !== next.realName;
    });
    if (changed.length === 0) return;
    const rebased = mergeChangedPlayersOntoSnapshot(latest, changed);
    await saveSharedPlayers(rebased, sessionId, tournamentBotId, revision + 1);
    setPlayers(rebased);
  }, []);

  const doRebuy = useCallback(async (playerId: string) => {
    let totalRebuys = 0;
    await applyMutation(current => {
      const result = current.map(p => {
        if (p.id !== playerId) return p;
        return { ...p, rebuyCount: clampWhole(p.rebuyCount) + 1 };
      });
      totalRebuys = result.reduce((sum, p) => sum + (p.rebuyCount ?? 0), 0);
      return result;
    });
    await supabase.from('game_state').update({ rebuys: totalRebuys }).eq('id', 1);
  }, [applyMutation]);

  const doBustOut = useCallback(async (playerId: string, bounty = 0) => {
    const { sessionId } = gameContextRef.current;
    const latest = await loadSharedPlayers(sessionId, gameContextRef.current.tournamentBotId);
    const bustPlayer = latest.find(p => p.id === playerId) ?? playersRef.current.find(p => p.id === playerId) ?? null;
    if (!bustPlayer || bustPlayer.status === 'out' || bustPlayer.arrivalStatus === 'absent') return;

    const projectedPlace = getNextBustoutProjectedPlace(latest);

    const ok = await createNotification({
      type: 'bustout',
      tableNumber,
      sessionId,
      playerId,
      playerName: bustPlayer.name,
      projectedPlace,
      bounty,
    });
    if (!ok) console.error('[dealer] createNotification failed', { sessionId, tableNumber, playerId });
  }, [createNotification, tableNumber]);

  const callFloor = useCallback(async () => {
    const { sessionId } = gameContextRef.current;
    await createNotification({ type: 'floor_call', tableNumber, sessionId });
  }, [createNotification, tableNumber]);

  const doUpdateRealName = useCallback(async (playerId: string, realName: string) => {
    await applyMutation(current => current.map(p =>
      p.id !== playerId ? p : { ...p, realName: realName.trim() || null }
    ));
  }, [applyMutation]);

  const doAddon = useCallback(async (playerId: string, count: 1 | 2) => {
    let totalAddons = 0;
    await applyMutation(current => {
      const mutated = current.map(p => {
        if (p.id !== playerId) return p;
        const current_ = p.addonCount ?? 0;
        const next = Math.min(2, current_ + count);
        return { ...p, addonCount: next };
      });
      totalAddons = mutated.reduce((sum, p) => sum + (p.addonCount ?? 0), 0);
      return mutated;
    });
    await supabase.from('game_state').update({ addonCount: totalAddons }).eq('id', 1);
  }, [applyMutation]);

  useEffect(() => {
    let cancelled = false;

    const loadGameContext = async () => {
      const { data } = await supabase
        .from('game_state')
        .select('resetAt, tournamentBotId, addonOpen')
        .eq('id', 1)
        .maybeSingle();

      if (cancelled || !data) return;

      const raw = data as Record<string, unknown>;
      const sessionId = Math.max(1, Math.round((raw.resetAt as number) || 0));
      const tournamentBotId = typeof raw.tournamentBotId === 'number' ? raw.tournamentBotId : null;
      const addonOpen = raw.addonOpen === true;
      const ctx = { sessionId, tournamentBotId, addonOpen };
      setGameContext(ctx);
      gameContextRef.current = ctx;

      const fetched = await loadSharedPlayers(sessionId, tournamentBotId);
      if (!cancelled) {
        setPlayers(fetched);
        playersRef.current = fetched;
        setLoading(false);
      }
    };

    void loadGameContext();

    const gsChan = supabase
      .channel('dealer-game-state')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, () => {
        void loadGameContext();
      })
      .subscribe();

    const pollInterval = window.setInterval(() => { void loadGameContext(); }, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(pollInterval);
      void supabase.removeChannel(gsChan);
    };
  }, []);

  useEffect(() => {
    const { sessionId, tournamentBotId } = gameContext;
    const id = sharedPlayersKey(sessionId, tournamentBotId);

    const refreshPlayers = async () => {
      const fetched = await loadSharedPlayers(sessionId, tournamentBotId);
      setPlayers(fetched);
      playersRef.current = fetched;
    };

    const chan = supabase
      .channel(`dealer-players:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blind_templates' }, async payload => {
        const row = (payload.new ?? payload.old) as { id?: unknown } | null;
        if (typeof row?.id !== 'string' || row.id !== id) return;
        await refreshPlayers();
      })
      .subscribe();

    const pollInterval = window.setInterval(() => { void refreshPlayers(); }, 10000);

    return () => {
      window.clearInterval(pollInterval);
      void supabase.removeChannel(chan);
    };
  }, [gameContext]);

  const tablePlayers = players.filter(p => p.tableNumber === tableNumber && p.arrivalStatus !== 'absent' && p.status !== 'out');

  const seats = Array.from({ length: SEATS_PER_TABLE }, (_, i) => {
    const seatNumber = i + 1;
    const player = tablePlayers.find(p => p.seatNumber === seatNumber) ?? null;
    return { seatNumber, player };
  });

  const addonOpen = gameContext.addonOpen;

  return { seats, loading, addonOpen, doRebuy, doBustOut, callFloor, doUpdateRealName, doAddon };
}
