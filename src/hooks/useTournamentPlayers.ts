import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { calcTotalStack } from '../gameStateMath';
import { supabase } from '../supabase';
import { fetchBotTournamentRoster, type ImportedTournamentPlayer, submitBotTournamentResults } from '../tournamentBotApi';
import type {
  GameState,
  LiveTournamentArrivalStatus,
  LiveTournamentPlayer,
  LiveTournamentPlayerStatus,
  LiveTournamentRegistrationSource,
  TournamentPlayersSummary,
  TournamentResultsPayload,
} from '../types';

const PLAYERS_TABLE = 'live_tournament_players';
const RESULTS_TABLE = 'tournament_result_exports';
const PLAYERS_LOCAL_PREFIX = 'poker_live_tournament_players';
const RESULTS_LOCAL_KEY = 'poker_live_tournament_results';
const PLAYER_SYNC_POLL_MS = 5_000;
const BOT_ROSTER_POLL_MS = 15_000;
const LOCAL_WRITE_GRACE_MS = 2_500;

type PlayerSyncState = {
  loading: boolean;
  error: string | null;
};

type BotSyncState = {
  loading: boolean;
  error: string | null;
  lastSyncedAt: string | null;
  disabled: boolean;
};

type ExportState = {
  sending: boolean;
  status: 'idle' | 'sent' | 'failed';
  error: string | null;
  lastAttemptAt: string | null;
  queued: boolean;
};

type UpdateGameState = (patch: Partial<GameState>, immediate?: boolean) => Promise<boolean | undefined>;

export type ExportTournamentResultsResult = {
  ok: boolean;
  skipped: boolean;
  queued: boolean;
  error: string | null;
  queueError?: string | null;
};

type UseTournamentPlayersOptions = {
  gameState: GameState;
  updateGameState: UpdateGameState;
  defaultBuyIn: number | null;
};

type PlayersTableRow = {
  id: string;
  session_id: number;
  tournament_bot_id: number | null;
  bot_registration_id: string | null;
  telegram_id: number | null;
  name: string;
  username: string | null;
  source: 'bot' | 'manual';
  registration_source: 'registered' | 'waitlist';
  status: 'registered' | 'waitlist' | 'active' | 'out';
  arrival_status: 'absent' | 'paid' | 'free';
  rebuy_count: number;
  addon_count: number;
  bounty: number;
  payment_due: number;
  payment_method: 'unpaid' | 'cash' | 'card';
  place: number | null;
  place_override: boolean;
  bustout_order: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

function normalizeSessionId(resetAt: number) {
  return Math.max(1, Math.round(resetAt || 0));
}

function playersLocalKey(sessionId: number) {
  return `${PLAYERS_LOCAL_PREFIX}:${sessionId}`;
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
  localStorage.setItem(key, JSON.stringify(value));
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
  return value === 'paid' || value === 'free' ? value : 'absent';
}

function normalizeRegistrationSource(value: unknown): LiveTournamentRegistrationSource {
  return value === 'waitlist' ? 'waitlist' : 'registered';
}

function normalizePlayerStatus(value: unknown, fallback: LiveTournamentPlayerStatus): LiveTournamentPlayerStatus {
  return value === 'registered' || value === 'waitlist' || value === 'active' || value === 'out'
    ? value
    : fallback;
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
    rebuyCount: clampWhole(raw.rebuyCount),
    addonCount: clampWhole(raw.addonCount),
    bounty: clampWhole(raw.bounty),
    paymentDue: clampWhole(raw.paymentDue),
    paymentMethod: raw.paymentMethod === 'cash' || raw.paymentMethod === 'card' ? raw.paymentMethod : 'unpaid',
    place: raw.place == null ? null : clampWhole(raw.place),
    placeOverride: raw.placeOverride === true,
    bustoutOrder: raw.bustoutOrder == null ? null : clampWhole(raw.bustoutOrder),
    sortOrder: clampWhole(raw.sortOrder),
    createdAt,
    updatedAt,
  };
}

function fromRow(row: PlayersTableRow, sessionId: number, tournamentBotId: number | null): LiveTournamentPlayer {
  return normalizePlayer({
    id: row.id,
    sessionId: row.session_id,
    tournamentBotId: row.tournament_bot_id,
    botRegistrationId: row.bot_registration_id,
    telegramId: row.telegram_id,
    name: row.name,
    username: row.username,
    source: row.source,
    registrationSource: row.registration_source,
    status: row.status,
    arrivalStatus: row.arrival_status,
    rebuyCount: row.rebuy_count,
    addonCount: row.addon_count,
    bounty: row.bounty,
    paymentDue: row.payment_due,
    paymentMethod: row.payment_method,
    place: row.place,
    placeOverride: row.place_override,
    bustoutOrder: row.bustout_order,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }, sessionId, tournamentBotId);
}

function toRow(player: LiveTournamentPlayer): PlayersTableRow {
  return {
    id: player.id,
    session_id: player.sessionId,
    tournament_bot_id: player.tournamentBotId,
    bot_registration_id: player.botRegistrationId,
    telegram_id: player.telegramId,
    name: player.name,
    username: player.username,
    source: player.source,
    registration_source: player.registrationSource,
    status: player.status,
    arrival_status: player.arrivalStatus,
    rebuy_count: clampWhole(player.rebuyCount),
    addon_count: clampWhole(player.addonCount),
    bounty: clampWhole(player.bounty),
    payment_due: clampWhole(player.paymentDue),
    payment_method: player.paymentMethod,
    place: player.place,
    place_override: player.placeOverride,
    bustout_order: player.bustoutOrder,
    sort_order: clampWhole(player.sortOrder),
    created_at: player.createdAt,
    updated_at: player.updatedAt,
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

function diffPlayers(previous: LiveTournamentPlayer[], next: LiveTournamentPlayer[]) {
  const previousById = new Map(previous.map(player => [player.id, player]));
  return next.filter(player => !playersEqual(previousById.get(player.id), player));
}

function formatPlayersSyncError(error: unknown, entity = 'игроков') {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : '';

  if (code === '42P01') {
    return `В Supabase еще нет таблицы ${PLAYERS_TABLE}. Выполните SQL из supabase/live_tournament_players.sql.`;
  }

  if (code === '42501') {
    return `Supabase не разрешает синхронизацию ${entity}. Проверьте доступ к таблице ${PLAYERS_TABLE}.`;
  }

  if (message.includes('exceed_egress_quota') || message.includes('Service for this project is restricted')) {
    return `Supabase временно ограничил проект, поэтому список ${entity} сейчас не синхронизируется.`;
  }

  return `Не удалось синхронизировать список ${entity}.`;
}

function formatResultsOutboxError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  if (code === '42P01') {
    return `В Supabase еще нет таблицы ${RESULTS_TABLE}. Выполните SQL из supabase/live_tournament_players.sql.`;
  }
  return 'Не удалось сохранить итоги турнира в очередь отправки.';
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

      const merged: LiveTournamentPlayer = {
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
      };

      Object.assign(existing, merged);
      continue;
    }

    const created = normalizePlayer({
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
      bounty: 0,
      paymentDue: 0,
      paymentMethod: 'unpaid',
      place: null,
      placeOverride: false,
      bustoutOrder: null,
      sortOrder: nextSortOrder++,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }, sessionId, tournamentBotId);

    mutable.push(created);
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
      summary.bountyTotal += clampWhole(player.bounty);
      summary.totalDue += clampWhole(player.paymentDue);

      if (player.arrivalStatus === 'paid') summary.paidEntries += 1;
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
    bountyTotal: 0,
    paidEntries: 0,
    freeEntries: 0,
    totalDue: 0,
  });
}

function getRatingPlayerCount(gameState: GameState, summary: TournamentPlayersSummary) {
  if (gameState.tournamentMode === 'phoenix') {
    return gameState.lateRegistrationPlayers ?? 0;
  }
  return summary.entrants;
}

function buildResultsPayload(
  gameState: GameState,
  sessionId: number,
  players: LiveTournamentPlayer[],
  summary: TournamentPlayersSummary,
  levelsPlayed: number
): TournamentResultsPayload {
  const orderedPlayers = [...players].sort((a, b) => {
    if (a.place !== null && b.place !== null) return a.place - b.place;
    if (a.place !== null) return -1;
    if (b.place !== null) return 1;
    return playerSort(a, b);
  });

  return {
    sessionId,
    tournamentBotId: gameState.tournamentBotId,
    tournamentTitle: gameState.tournamentTitle,
    tournamentMode: gameState.tournamentMode,
    finishedAt: nowIso(),
    levelsPlayed,
    gameStatus: gameState.status,
    summary: {
      ...summary,
      bonusCount: gameState.bonusCount ?? 0,
      totalStack: gameState.totalStack ?? 0,
      lateRegistrationPlayers: gameState.lateRegistrationPlayers,
      ratingPlayerCount: getRatingPlayerCount(gameState, summary),
    },
    players: orderedPlayers.map(player => ({
      id: player.id,
      botRegistrationId: player.botRegistrationId,
      telegramId: player.telegramId,
      name: player.name,
      username: player.username,
      source: player.source,
      registrationSource: player.registrationSource,
      arrivalStatus: player.arrivalStatus,
      paymentMethod: player.paymentMethod,
      paymentDue: player.paymentDue,
      rebuyCount: player.rebuyCount,
      addonCount: player.addonCount,
      bounty: player.bounty,
      status: player.status,
      place: player.place,
      bustoutOrder: player.bustoutOrder,
    })),
  };
}

export function useTournamentPlayers({ gameState, updateGameState, defaultBuyIn }: UseTournamentPlayersOptions) {
  const isSupabaseConfigured =
    import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_ANON_KEY;
  const sessionId = normalizeSessionId(gameState.resetAt);
  const tournamentBotId = gameState.tournamentBotId;
  const managedCountersEnabled = true;

  const [players, setPlayers] = useState<LiveTournamentPlayer[]>(() =>
    recalculatePlayers(loadLocal(playersLocalKey(sessionId), [] as LiveTournamentPlayer[]).map((player: LiveTournamentPlayer) => normalizePlayer(player, sessionId, tournamentBotId)))
  );
  const [playerSyncState, setPlayerSyncState] = useState<PlayerSyncState>({ loading: false, error: null });
  const [botSyncState, setBotSyncState] = useState<BotSyncState>({
    loading: false,
    error: null,
    lastSyncedAt: null,
    disabled: false,
  });
  const [exportState, setExportState] = useState<ExportState>({
    sending: false,
    status: 'idle',
    error: null,
    lastAttemptAt: null,
    queued: false,
  });

  const playersRef = useRef(players);
  const sessionIdRef = useRef(sessionId);
  const tournamentBotIdRef = useRef(tournamentBotId);

  const skipRealtime = useRef(false);
  const skipRealtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    saveLocal(playersLocalKey(sessionIdRef.current), normalized);
  }, []);

  const persistPlayerRows = useCallback(async (changedRows: LiveTournamentPlayer[], deletedIds: string[] = []) => {
    if (!isSupabaseConfigured) return true;
    if (changedRows.length === 0 && deletedIds.length === 0) return true;

    skipRealtime.current = true;
    if (skipRealtimeTimer.current) clearTimeout(skipRealtimeTimer.current);
    skipRealtimeTimer.current = setTimeout(() => {
      skipRealtime.current = false;
    }, LOCAL_WRITE_GRACE_MS);

    if (deletedIds.length > 0) {
      const { error } = await supabase
        .from(PLAYERS_TABLE)
        .delete()
        .eq('session_id', sessionIdRef.current)
        .in('id', deletedIds);

      if (error) {
        setPlayerSyncState(prev => ({ ...prev, error: formatPlayersSyncError(error) }));
        return false;
      }
    }

    if (changedRows.length > 0) {
      const { error } = await supabase
        .from(PLAYERS_TABLE)
        .upsert(changedRows.map(toRow));

      if (error) {
        setPlayerSyncState(prev => ({ ...prev, error: formatPlayersSyncError(error) }));
        return false;
      }
    }

    setPlayerSyncState(prev => ({ ...prev, error: null }));
    return true;
  }, [isSupabaseConfigured]);

  const syncPlayersFromServer = useCallback(async () => {
    if (!isSupabaseConfigured || skipRealtime.current) return false;
    setPlayerSyncState(prev => ({ ...prev, loading: true }));

    const { data, error } = await supabase
      .from(PLAYERS_TABLE)
      .select('*')
      .eq('session_id', sessionIdRef.current)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (skipRealtime.current) {
      setPlayerSyncState(prev => ({ ...prev, loading: false }));
      return false;
    }

    if (error) {
      setPlayerSyncState({
        loading: false,
        error: formatPlayersSyncError(error),
      });
      return false;
    }

    const nextPlayers = (data ?? []).map(row => fromRow(row as PlayersTableRow, sessionIdRef.current, tournamentBotIdRef.current));
    replacePlayersState(nextPlayers);
    setPlayerSyncState({
      loading: false,
      error: null,
    });
    return true;
  }, [isSupabaseConfigured, replacePlayersState]);

  const applyPlayerMutation = useCallback(async (
    mutate: (current: LiveTournamentPlayer[]) => LiveTournamentPlayer[],
    deletedIds: string[] = []
  ) => {
    const previous = playersRef.current;
    const mutated = recalculatePlayers(mutate(previous).map(player => ({
      ...player,
      updatedAt: player.updatedAt || nowIso(),
    })));
    const changedRows = diffPlayers(previous, mutated);
    replacePlayersState(mutated);
    await persistPlayerRows(changedRows, deletedIds);
    return mutated;
  }, [persistPlayerRows, replacePlayersState]);

  const loadSessionPlayers = useCallback(async () => {
    const localPlayers = loadLocal(playersLocalKey(sessionId), [] as LiveTournamentPlayer[])
      .map(player => normalizePlayer(player, sessionId, tournamentBotId));
    replacePlayersState(localPlayers);
    botSyncUnsupported.current = false;
    setBotSyncState({
      loading: false,
      error: null,
      lastSyncedAt: null,
      disabled: false,
    });

    if (isSupabaseConfigured) {
      await syncPlayersFromServer();
    } else {
      setPlayerSyncState({ loading: false, error: null });
    }
  }, [isSupabaseConfigured, replacePlayersState, sessionId, syncPlayersFromServer, tournamentBotId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadSessionPlayers();
    }, 0);

    return () => clearTimeout(timer);
  }, [loadSessionPlayers]);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    tournamentBotIdRef.current = tournamentBotId;
  }, [tournamentBotId]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const channel = supabase
      .channel(`live-tournament-players-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: PLAYERS_TABLE, filter: `session_id=eq.${sessionId}` },
        () => {
          if (skipRealtime.current) return;
          void syncPlayersFromServer();
        }
      )
      .subscribe();

    const interval = setInterval(() => {
      void syncPlayersFromServer();
    }, PLAYER_SYNC_POLL_MS);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [isSupabaseConfigured, sessionId, syncPlayersFromServer]);

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
    const merged = mergeImportedRoster(playersRef.current, imported, sessionIdRef.current, tournamentBotId);

    replacePlayersState(merged.players);
    await persistPlayerRows(merged.changedRows);
    setBotSyncState({
      loading: false,
      error: null,
      lastSyncedAt: nowIso(),
      disabled: false,
    });
    return true;
  }, [persistPlayerRows, replacePlayersState, tournamentBotId]);

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
    if (!managedCountersEnabled || !hasPlayers) return;

    const nextCounters = {
      players: summary.entrants,
      outs: summary.bustouts,
      rebuys: summary.rebuys,
      addonCount: summary.addons,
      totalStack: calcTotalStack({
        players: summary.entrants,
        rebuys: summary.rebuys,
        addonCount: summary.addons,
        bonusCount: gameState.bonusCount,
        burnedChips: gameState.burnedChips,
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
    managedCountersEnabled,
    players.length,
    summary.addons,
    summary.bustouts,
    summary.entrants,
    summary.rebuys,
    updateGameState,
  ]);

  const addManualPlayer = useCallback(async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return false;

    const paymentDue = defaultBuyIn && defaultBuyIn > 0 ? defaultBuyIn : 0;
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
          bounty: 0,
          paymentDue,
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
  }, [applyPlayerMutation, defaultBuyIn, sessionId, tournamentBotId]);

  const updatePlayerField = useCallback(async (playerId: string, patch: Partial<LiveTournamentPlayer>) => {
    await applyPlayerMutation(current => current.map(player => {
      if (player.id !== playerId) return player;

      const next = normalizePlayer({
        ...player,
        ...patch,
        updatedAt: nowIso(),
      }, sessionId, tournamentBotId);

      return next;
    }));
  }, [applyPlayerMutation, sessionId, tournamentBotId]);

  const setPlayerArrival = useCallback(async (playerId: string, arrivalStatus: LiveTournamentArrivalStatus) => {
    await applyPlayerMutation(current => current.map(player => {
      if (player.id !== playerId) return player;

      const paymentDue = arrivalStatus === 'paid' && player.paymentDue === 0 && defaultBuyIn && defaultBuyIn > 0
        ? defaultBuyIn
        : arrivalStatus === 'free'
          ? 0
          : player.paymentDue;

      const nextStatus = arrivalStatus === 'absent'
        ? deriveBaseStatus(player.registrationSource)
        : player.status === 'out'
          ? 'out'
          : 'active';

      return normalizePlayer({
        ...player,
        arrivalStatus,
        status: nextStatus,
        paymentDue,
        paymentMethod: arrivalStatus === 'free' ? 'unpaid' : player.paymentMethod,
        place: arrivalStatus === 'absent' ? null : player.place,
        placeOverride: arrivalStatus === 'absent' ? false : player.placeOverride,
        bustoutOrder: arrivalStatus === 'absent' ? null : player.bustoutOrder,
        updatedAt: nowIso(),
      }, sessionId, tournamentBotId);
    }));
  }, [applyPlayerMutation, defaultBuyIn, sessionId, tournamentBotId]);

  const markPlayerOut = useCallback(async (playerId: string) => {
    await applyPlayerMutation(current => {
      const maxOutOrder = current.reduce((max, player) => Math.max(max, player.bustoutOrder ?? 0), 0);
      return current.map(player => {
        if (player.id !== playerId) return player;
        if (player.arrivalStatus === 'absent') return player;

        return normalizePlayer({
          ...player,
          status: 'out',
          bustoutOrder: (player.bustoutOrder ?? maxOutOrder + 1),
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

  const removeManualPlayer = useCallback(async (playerId: string) => {
    const previous = playersRef.current;
    const next = previous.filter(player => player.id !== playerId);
    const changedRows = diffPlayers(previous, recalculatePlayers(next));
    const deletedIds = previous.filter(player => player.id === playerId && player.source === 'manual').map(player => player.id);
    if (deletedIds.length === 0) return false;
    replacePlayersState(next);
    await persistPlayerRows(changedRows, deletedIds);
    return true;
  }, [persistPlayerRows, replacePlayersState]);

  const setPlayerPlace = useCallback(async (playerId: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') {
      await applyPlayerMutation(current => current.map(player => (
        player.id === playerId
          ? normalizePlayer({
              ...player,
              place: null,
              placeOverride: false,
              updatedAt: nowIso(),
            }, sessionId, tournamentBotId)
          : player
      )));
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;

    await updatePlayerField(playerId, {
      place: Math.max(1, Math.round(parsed)),
      placeOverride: true,
    });
  }, [applyPlayerMutation, sessionId, tournamentBotId, updatePlayerField]);

  const queueResultsPayload = useCallback(async (
    payload: TournamentResultsPayload,
    status: 'sent' | 'failed',
    error: string | null
  ) => {
    const entry = {
      session_id: payload.sessionId,
      tournament_bot_id: payload.tournamentBotId,
      tournament_title: payload.tournamentTitle,
      tournament_mode: payload.tournamentMode,
      payload,
      status,
      last_error: error,
      last_attempt_at: nowIso(),
      sent_at: status === 'sent' ? nowIso() : null,
    };

    if (!isSupabaseConfigured) {
      const existing = loadLocal(RESULTS_LOCAL_KEY, [] as Record<string, unknown>[]);
      saveLocal(RESULTS_LOCAL_KEY, [entry, ...existing]);
      return { ok: true as const };
    }

    const { error: insertError } = await supabase.from(RESULTS_TABLE).insert(entry);
    if (insertError) {
      const fallback = loadLocal(RESULTS_LOCAL_KEY, [] as Record<string, unknown>[]);
      saveLocal(RESULTS_LOCAL_KEY, [entry, ...fallback]);
      return {
        ok: true as const,
        localOnly: true as const,
        error: formatResultsOutboxError(insertError),
      };
    }

    return { ok: true as const };
  }, [isSupabaseConfigured]);

  const exportTournamentResults = useCallback(async (levelsPlayed: number): Promise<ExportTournamentResultsResult> => {
    if (playersRef.current.length === 0) {
      return {
        ok: true as const,
        skipped: true as const,
        queued: false,
        error: null,
        queueError: null,
      };
    }

    const nextSummary = summarizePlayers(playersRef.current);

    if (gameState.tournamentMode === 'phoenix') {
      const lateRegistrationPlayers = gameState.lateRegistrationPlayers ?? 0;
      if (lateRegistrationPlayers <= 0) {
        const error = 'Для Phoenix сначала зафиксируйте late reg: сколько игроков оставалось в игре на момент закрытия поздней регистрации.';
        setExportState({
          sending: false,
          status: 'failed',
          error,
          lastAttemptAt: nowIso(),
          queued: false,
        });
        return {
          ok: false,
          skipped: false as const,
          queued: false,
          error,
          queueError: null,
        };
      }

      if (lateRegistrationPlayers > nextSummary.entrants) {
        const error = 'Число игроков на late reg не может быть больше общего числа пришедших игроков.';
        setExportState({
          sending: false,
          status: 'failed',
          error,
          lastAttemptAt: nowIso(),
          queued: false,
        });
        return {
          ok: false,
          skipped: false as const,
          queued: false,
          error,
          queueError: null,
        };
      }
    }

    setExportState({
      sending: true,
      status: exportState.status,
      error: null,
      lastAttemptAt: nowIso(),
      queued: false,
    });

    const payload = buildResultsPayload(gameState, sessionIdRef.current, playersRef.current, nextSummary, levelsPlayed);
    const sendResult = await submitBotTournamentResults(payload);
    const queuedResult = await queueResultsPayload(payload, sendResult.ok ? 'sent' : 'failed', sendResult.ok ? null : sendResult.error);

    const queued = queuedResult.ok;
    const nextState: ExportState = {
      sending: false,
      status: sendResult.ok ? 'sent' : 'failed',
      error: sendResult.ok ? null : sendResult.error,
      lastAttemptAt: nowIso(),
      queued,
    };
    setExportState(nextState);

    return {
      ok: sendResult.ok,
      skipped: false as const,
      queued,
      error: sendResult.ok ? null : sendResult.error,
      queueError: queuedResult.ok ? null : queuedResult.error,
    };
  }, [exportState.status, gameState, queueResultsPayload]);

  return {
    players,
    groupedPlayers,
    summary,
    playerSyncState,
    botSyncState,
    exportState,
    managedCountersEnabled,
    refreshFromBot,
    addManualPlayer,
    updatePlayerField,
    setPlayerArrival,
    markPlayerOut,
    restorePlayer,
    removeManualPlayer,
    setPlayerPlace,
    exportTournamentResults,
  };
}
