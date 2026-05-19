import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { calcTotalStack } from '../gameStateMath';
import { fetchBotTournamentRoster, type ImportedTournamentPlayer } from '../tournamentBotApi';
import type {
  GameState,
  LiveTournamentArrivalStatus,
  LiveTournamentPlayer,
  LiveTournamentPlayerStatus,
  LiveTournamentRegistrationSource,
  TournamentPlayersSummary,
} from '../types';

const PLAYERS_LOCAL_PREFIX = 'poker_live_tournament_players';
const BOT_ROSTER_POLL_MS = 15_000;
const TOURNAMENT_UNIT_PRICE = 1000;
const PROMO_DISCOUNT_FACTOR = 0.5;

type UpdateGameState = (patch: Partial<GameState>, immediate?: boolean) => Promise<boolean | undefined>;

type UseTournamentPlayersOptions = {
  gameState: GameState;
  updateGameState: UpdateGameState;
};

function normalizeSessionId(resetAt: number) {
  return Math.max(1, Math.round(resetAt || 0));
}

function playersLocalKey(sessionId: number, tournamentBotId: number | null) {
  return `${PLAYERS_LOCAL_PREFIX}:${sessionId}:${tournamentBotId ?? 'manual'}`;
}

function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function saveLocal<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota/storage issues in local-only mode.
  }
}

function clampWhole(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function nowIso() {
  return new Date().toISOString();
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function deriveBaseStatus(registrationSource: LiveTournamentRegistrationSource): LiveTournamentPlayerStatus {
  return registrationSource === 'waitlist' ? 'waitlist' : 'registered';
}

function normalizeArrivalStatus(value: unknown): LiveTournamentArrivalStatus {
  return value === 'paid' || value === 'free' || value === 'promo' ? value : 'absent';
}

function normalizeRegistrationSource(value: unknown): LiveTournamentRegistrationSource {
  return value === 'waitlist' ? 'waitlist' : 'registered';
}

function normalizePlayerStatus(value: unknown, fallback: LiveTournamentPlayerStatus): LiveTournamentPlayerStatus {
  return value === 'registered' || value === 'waitlist' || value === 'active' || value === 'out'
    ? value
    : fallback;
}

function calcPaymentDue(arrivalStatus: LiveTournamentArrivalStatus, rebuyCount: number, addonCount: number) {
  if (arrivalStatus === 'absent') return 0;

  const entryUnits = arrivalStatus === 'free' ? 0 : 1;
  const totalUnits = entryUnits + clampWhole(rebuyCount) + clampWhole(addonCount);
  const fullPrice = totalUnits * TOURNAMENT_UNIT_PRICE;
  return arrivalStatus === 'promo'
    ? Math.round(fullPrice * PROMO_DISCOUNT_FACTOR)
    : fullPrice;
}

function normalizePlayer(
  raw: Partial<LiveTournamentPlayer>,
  sessionId: number,
  tournamentBotId: number | null
): LiveTournamentPlayer {
  const registrationSource = normalizeRegistrationSource(raw.registrationSource);
  const arrivalStatus = normalizeArrivalStatus(raw.arrivalStatus);
  let status = normalizePlayerStatus(raw.status, deriveBaseStatus(registrationSource));

  if (arrivalStatus === 'absent') {
    if (status === 'active' || status === 'out') {
      status = deriveBaseStatus(registrationSource);
    }
  } else if (status !== 'out') {
    status = 'active';
  }

  const createdAt = typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : nowIso();
  const updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : createdAt;
  const rebuyCount = clampWhole(raw.rebuyCount);
  const addonCount = clampWhole(raw.addonCount);
  const bonusCount = clampWhole(raw.bonusCount);

  return {
    id: raw.id || createId(),
    sessionId,
    tournamentBotId: raw.tournamentBotId ?? tournamentBotId ?? null,
    botRegistrationId: raw.botRegistrationId ?? null,
    telegramId: typeof raw.telegramId === 'number' && Number.isFinite(raw.telegramId) ? Math.round(raw.telegramId) : null,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Игрок',
    username: typeof raw.username === 'string' && raw.username.trim() ? raw.username.trim() : null,
    source: raw.source === 'manual' ? 'manual' : 'bot',
    registrationSource,
    status,
    arrivalStatus,
    rebuyCount,
    addonCount,
    bonusCount,
    bounty: clampWhole(raw.bounty),
    paymentDue: calcPaymentDue(arrivalStatus, rebuyCount, addonCount),
    paymentMethod: raw.paymentMethod === 'cash' || raw.paymentMethod === 'card' ? raw.paymentMethod : 'unpaid',
    place: raw.place == null ? null : clampWhole(raw.place),
    placeOverride: raw.placeOverride === true,
    bustoutOrder: raw.bustoutOrder == null ? null : clampWhole(raw.bustoutOrder),
    sortOrder: clampWhole(raw.sortOrder),
    createdAt,
    updatedAt,
  };
}

function playerSort(a: LiveTournamentPlayer, b: LiveTournamentPlayer) {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name, 'ru');
}

function recalculatePlayers(players: LiveTournamentPlayer[]) {
  const normalized = players.map(player => normalizePlayer(player, player.sessionId, player.tournamentBotId));
  const entrants = normalized.filter(player => player.arrivalStatus !== 'absent').length;
  const sortedOut = normalized
    .filter(player => player.status === 'out')
    .sort((a, b) => {
      const orderA = a.bustoutOrder ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.bustoutOrder ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB || a.updatedAt.localeCompare(b.updatedAt) || playerSort(a, b);
    });

  const nextOutOrder = new Map<string, number>();
  sortedOut.forEach((player, index) => {
    nextOutOrder.set(player.id, index + 1);
  });

  return normalized
    .map(player => {
      const baseStatus = deriveBaseStatus(player.registrationSource);
      if (player.arrivalStatus === 'absent') {
        return {
          ...player,
          status: baseStatus,
          bustoutOrder: null,
          place: null,
          placeOverride: false,
        };
      }

      if (player.status !== 'out') {
        return {
          ...player,
          status: 'active' as const,
          bustoutOrder: null,
          place: null,
          placeOverride: false,
        };
      }

      const bustoutOrder = nextOutOrder.get(player.id) ?? 1;
      const autoPlace = Math.max(1, entrants - bustoutOrder + 1);
      return {
        ...player,
        status: 'out' as const,
        bustoutOrder,
        place: player.placeOverride && player.place !== null ? clampWhole(player.place) : autoPlace,
      };
    })
    .sort(playerSort);
}

function playersEqual(a: LiveTournamentPlayer | undefined, b: LiveTournamentPlayer) {
  if (!a) return false;

  return (
    a.sessionId === b.sessionId &&
    a.tournamentBotId === b.tournamentBotId &&
    a.botRegistrationId === b.botRegistrationId &&
    a.telegramId === b.telegramId &&
    a.name === b.name &&
    a.username === b.username &&
    a.source === b.source &&
    a.registrationSource === b.registrationSource &&
    a.status === b.status &&
    a.arrivalStatus === b.arrivalStatus &&
    a.rebuyCount === b.rebuyCount &&
    a.addonCount === b.addonCount &&
    a.bonusCount === b.bonusCount &&
    a.bounty === b.bounty &&
    a.paymentDue === b.paymentDue &&
    a.paymentMethod === b.paymentMethod &&
    a.place === b.place &&
    a.placeOverride === b.placeOverride &&
    a.bustoutOrder === b.bustoutOrder &&
    a.sortOrder === b.sortOrder &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt
  );
}

function findImportedMatch(players: LiveTournamentPlayer[], importedPlayer: ImportedTournamentPlayer) {
  const normalizedName = importedPlayer.name.trim().toLowerCase();

  return players.find(player => (
    (importedPlayer.botRegistrationId && player.botRegistrationId === importedPlayer.botRegistrationId) ||
    (importedPlayer.telegramId !== null && player.telegramId === importedPlayer.telegramId) ||
    (
      player.source === 'bot' &&
      !player.botRegistrationId &&
      player.name.trim().toLowerCase() === normalizedName
    )
  ));
}

function diffPlayers(previous: LiveTournamentPlayer[], next: LiveTournamentPlayer[]) {
  const previousById = new Map(previous.map(player => [player.id, player]));
  return next.filter(player => !playersEqual(previousById.get(player.id), player));
}

function mergeImportedRoster(
  previousPlayers: LiveTournamentPlayer[],
  importedPlayers: ImportedTournamentPlayer[],
  sessionId: number,
  tournamentBotId: number | null
) {
  let nextSortOrder = previousPlayers.reduce((max, player) => Math.max(max, player.sortOrder), -1) + 1;
  const mutable = previousPlayers.map(player => ({ ...player }));

  for (const imported of importedPlayers) {
    const existing = findImportedMatch(mutable, imported);

    if (existing) {
      const baseStatus = deriveBaseStatus(imported.registrationSource);
      const nextStatus = existing.status === 'out'
        ? 'out'
        : existing.arrivalStatus === 'absent'
          ? baseStatus
          : 'active';

      Object.assign(existing, {
        ...existing,
        tournamentBotId,
        botRegistrationId: imported.botRegistrationId ?? existing.botRegistrationId,
        telegramId: imported.telegramId ?? existing.telegramId,
        name: imported.name,
        username: imported.username,
        source: 'bot',
        registrationSource: imported.registrationSource,
        status: nextStatus,
        updatedAt: nowIso(),
      });
      continue;
    }

    mutable.push(normalizePlayer({
      id: createId(),
      sessionId,
      tournamentBotId,
      botRegistrationId: imported.botRegistrationId,
      telegramId: imported.telegramId,
      name: imported.name,
      username: imported.username,
      source: 'bot',
      registrationSource: imported.registrationSource,
      status: deriveBaseStatus(imported.registrationSource),
      arrivalStatus: 'absent',
      rebuyCount: 0,
      addonCount: 0,
      bonusCount: 0,
      bounty: 0,
      paymentDue: 0,
      paymentMethod: 'unpaid',
      place: null,
      placeOverride: false,
      bustoutOrder: null,
      sortOrder: nextSortOrder++,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }, sessionId, tournamentBotId));
  }

  const recalculated = recalculatePlayers(mutable);
  return {
    players: recalculated,
    changedRows: diffPlayers(previousPlayers, recalculated),
  };
}

function summarizePlayers(players: LiveTournamentPlayer[]): TournamentPlayersSummary {
  return players.reduce<TournamentPlayersSummary>((summary, player) => {
    if (player.arrivalStatus !== 'absent') {
      summary.entrants += 1;
      summary.rebuys += clampWhole(player.rebuyCount);
      summary.addons += clampWhole(player.addonCount);
      summary.bonuses += clampWhole(player.bonusCount);
      summary.bountyTotal += clampWhole(player.bounty);
      summary.totalDue += clampWhole(player.paymentDue);

      if (player.arrivalStatus === 'paid' || player.arrivalStatus === 'promo') summary.paidEntries += 1;
      if (player.arrivalStatus === 'free') summary.freeEntries += 1;

      if (player.status === 'out') {
        summary.bustouts += 1;
      } else {
        summary.active += 1;
      }
    } else if (player.status === 'waitlist') {
      summary.waitlist += 1;
    } else {
      summary.pending += 1;
    }

    return summary;
  }, {
    entrants: 0,
    active: 0,
    bustouts: 0,
    pending: 0,
    waitlist: 0,
    rebuys: 0,
    addons: 0,
    bonuses: 0,
    bountyTotal: 0,
    paidEntries: 0,
    freeEntries: 0,
    totalDue: 0,
  });
}

export function useTournamentPlayers({ gameState, updateGameState }: UseTournamentPlayersOptions) {
  const sessionId = normalizeSessionId(gameState.resetAt);
  const tournamentBotId = gameState.tournamentBotId;
  const storageKey = playersLocalKey(sessionId, tournamentBotId);

  const [players, setPlayers] = useState<LiveTournamentPlayer[]>([]);
  const [botSyncState, setBotSyncState] = useState({
    loading: false,
    error: null as string | null,
    lastSyncedAt: null as string | null,
    disabled: false,
  });

  const playersRef = useRef(players);
  const sessionIdRef = useRef(sessionId);
  const tournamentBotIdRef = useRef(tournamentBotId);
  const storageKeyRef = useRef(storageKey);
  const botSyncUnsupported = useRef(false);

  const summary = useMemo(() => summarizePlayers(players), [players]);

  const groupedPlayers = useMemo(() => ({
    active: players.filter(player => player.status === 'active').sort(playerSort),
    pending: players.filter(player => player.status === 'registered').sort(playerSort),
    waitlist: players.filter(player => player.status === 'waitlist').sort(playerSort),
    out: [...players.filter(player => player.status === 'out')].sort((a, b) => {
      if (a.place !== null && b.place !== null) return a.place - b.place;
      if (a.place !== null) return -1;
      if (b.place !== null) return 1;
      return playerSort(a, b);
    }),
  }), [players]);

  const replacePlayersState = useCallback((nextPlayers: LiveTournamentPlayer[]) => {
    const normalized = recalculatePlayers(nextPlayers);
    playersRef.current = normalized;
    setPlayers(normalized);
    saveLocal(storageKeyRef.current, normalized);
  }, []);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    tournamentBotIdRef.current = tournamentBotId;
  }, [tournamentBotId]);

  useEffect(() => {
    storageKeyRef.current = storageKey;
    const localPlayers = loadLocal(storageKey, [] as LiveTournamentPlayer[])
      .map(player => normalizePlayer(player, sessionId, tournamentBotId));
    const normalizedPlayers = recalculatePlayers(localPlayers);
    playersRef.current = normalizedPlayers;
    botSyncUnsupported.current = false;
    startTransition(() => {
      setPlayers(normalizedPlayers);
      setBotSyncState({
        loading: false,
        error: null,
        lastSyncedAt: null,
        disabled: false,
      });
    });
  }, [replacePlayersState, sessionId, storageKey, tournamentBotId]);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  const applyPlayerMutation = useCallback(async (
    mutate: (current: LiveTournamentPlayer[]) => LiveTournamentPlayer[]
  ) => {
    const mutated = recalculatePlayers(mutate(playersRef.current).map(player => ({
      ...player,
      updatedAt: player.updatedAt || nowIso(),
    })));
    replacePlayersState(mutated);
    return mutated;
  }, [replacePlayersState]);

  const refreshFromBot = useCallback(async (force = false) => {
    if (tournamentBotId == null) return false;
    if (force) {
      botSyncUnsupported.current = false;
      setBotSyncState(prev => ({ ...prev, disabled: false }));
    }
    if (botSyncUnsupported.current) return false;

    setBotSyncState(prev => ({ ...prev, loading: true, error: null }));
    const result = await fetchBotTournamentRoster(tournamentBotId);

    if (!result.ok) {
      if (result.unsupported) {
        botSyncUnsupported.current = true;
      }
      setBotSyncState({
        loading: false,
        error: result.error,
        lastSyncedAt: null,
        disabled: result.unsupported,
      });
      return false;
    }

    const imported = [
      ...result.players.map(player => ({ ...player, registrationSource: 'registered' as const })),
      ...result.waitlist.map(player => ({ ...player, registrationSource: 'waitlist' as const })),
    ];
    const merged = mergeImportedRoster(playersRef.current, imported, sessionIdRef.current, tournamentBotIdRef.current);
    replacePlayersState(merged.players);
    setBotSyncState({
      loading: false,
      error: null,
      lastSyncedAt: nowIso(),
      disabled: false,
    });
    return true;
  }, [replacePlayersState, tournamentBotId]);

  useEffect(() => {
    if (tournamentBotId == null) return;

    const initialTimer = setTimeout(() => {
      void refreshFromBot();
    }, 0);
    const interval = setInterval(() => {
      void refreshFromBot();
    }, BOT_ROSTER_POLL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [refreshFromBot, tournamentBotId]);

  useEffect(() => {
    const hasPlayers = players.length > 0;
    if (!hasPlayers) return;

    const nextCounters = {
      players: summary.entrants,
      outs: summary.bustouts,
      rebuys: summary.rebuys,
      addonCount: summary.addons,
      bonusCount: summary.bonuses,
      totalStack: calcTotalStack({
        players: summary.entrants,
        rebuys: summary.rebuys,
        addonCount: summary.addons,
        bonusCount: summary.bonuses,
        startStack: gameState.startStack,
        addonStack: gameState.addonStack,
        bonusStack: gameState.bonusStack,
      }),
    };

    if (
      gameState.players === nextCounters.players &&
      gameState.outs === nextCounters.outs &&
      gameState.rebuys === nextCounters.rebuys &&
      gameState.addonCount === nextCounters.addonCount &&
      gameState.bonusCount === nextCounters.bonusCount &&
      gameState.totalStack === nextCounters.totalStack
    ) {
      return;
    }

    void updateGameState(nextCounters);
  }, [
    gameState.addonCount,
    gameState.addonStack,
    gameState.bonusCount,
    gameState.bonusStack,
    gameState.outs,
    gameState.players,
    gameState.rebuys,
    gameState.startStack,
    gameState.totalStack,
    players.length,
    summary.addons,
    summary.bonuses,
    summary.bustouts,
    summary.entrants,
    summary.rebuys,
    updateGameState,
  ]);

  const addManualPlayer = useCallback(async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return false;

    await applyPlayerMutation(current => {
      const nextSortOrder = current.reduce((max, player) => Math.max(max, player.sortOrder), -1) + 1;
      const createdAt = nowIso();
      return [
        ...current,
        normalizePlayer({
          id: createId(),
          sessionId,
          tournamentBotId,
          name: trimmedName,
          username: null,
          source: 'manual',
          registrationSource: 'registered',
          status: 'active',
          arrivalStatus: 'paid',
          rebuyCount: 0,
          addonCount: 0,
          bonusCount: 0,
          bounty: 0,
          paymentDue: TOURNAMENT_UNIT_PRICE,
          paymentMethod: 'unpaid',
          place: null,
          placeOverride: false,
          bustoutOrder: null,
          sortOrder: nextSortOrder,
          createdAt,
          updatedAt: createdAt,
        }, sessionId, tournamentBotId),
      ];
    });

    return true;
  }, [applyPlayerMutation, sessionId, tournamentBotId]);

  const updatePlayerField = useCallback(async (playerId: string, patch: Partial<LiveTournamentPlayer>) => {
    await applyPlayerMutation(current => current.map(player => {
      if (player.id !== playerId) return player;

      return normalizePlayer({
        ...player,
        ...patch,
        updatedAt: nowIso(),
      }, sessionId, tournamentBotId);
    }));
  }, [applyPlayerMutation, sessionId, tournamentBotId]);

  const setPlayerArrival = useCallback(async (playerId: string, arrivalStatus: LiveTournamentArrivalStatus) => {
    await applyPlayerMutation(current => current.map(player => {
      if (player.id !== playerId) return player;

      const nextStatus = arrivalStatus === 'absent'
        ? deriveBaseStatus(player.registrationSource)
        : 'active';

      return normalizePlayer({
        ...player,
        arrivalStatus,
        status: nextStatus,
        paymentMethod: arrivalStatus === 'free' ? 'unpaid' : player.paymentMethod,
        place: arrivalStatus === 'absent' ? null : player.place,
        placeOverride: arrivalStatus === 'absent' ? false : player.placeOverride,
        bustoutOrder: arrivalStatus === 'absent' ? null : player.bustoutOrder,
        updatedAt: nowIso(),
      }, sessionId, tournamentBotId);
    }));
  }, [applyPlayerMutation, sessionId, tournamentBotId]);

  const markPlayerOut = useCallback(async (playerId: string) => {
    await applyPlayerMutation(current => {
      const maxOutOrder = current.reduce((max, player) => Math.max(max, player.bustoutOrder ?? 0), 0);
      return current.map(player => {
        if (player.id !== playerId) return player;
        if (player.arrivalStatus === 'absent') return player;

        return normalizePlayer({
          ...player,
          status: 'out',
          bustoutOrder: player.bustoutOrder ?? maxOutOrder + 1,
          updatedAt: nowIso(),
        }, sessionId, tournamentBotId);
      });
    });
  }, [applyPlayerMutation, sessionId, tournamentBotId]);

  const restorePlayer = useCallback(async (playerId: string) => {
    await applyPlayerMutation(current => current.map(player => {
      if (player.id !== playerId) return player;

      return normalizePlayer({
        ...player,
        status: player.arrivalStatus === 'absent' ? deriveBaseStatus(player.registrationSource) : 'active',
        place: null,
        placeOverride: false,
        bustoutOrder: null,
        updatedAt: nowIso(),
      }, sessionId, tournamentBotId);
    }));
  }, [applyPlayerMutation, sessionId, tournamentBotId]);

  return {
    players,
    groupedPlayers,
    summary,
    playerSyncState: {
      loading: false,
      error: null,
    },
    botSyncState,
    managedCountersEnabled: players.length > 0,
    refreshFromBot,
    addManualPlayer,
    updatePlayerField,
    setPlayerArrival,
    markPlayerOut,
    restorePlayer,
  };
}
