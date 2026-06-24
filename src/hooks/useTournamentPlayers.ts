import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabase.ts';
import { calcTotalStack } from '../gameStateMath.ts';
import { isPromoUsername } from '../promoPlayerList.ts';
import {
  fetchBotTournamentRoster,
  submitBotTournamentFinance,
  submitBotTournamentResults,
  type ImportedTournamentPlayer,
} from '../tournamentBotApi.ts';
import type {
  GameState,
  LiveTournamentArrivalStatus,
  LiveTournamentPaymentMethod,
  LiveTournamentPlayer,
  LiveTournamentPlayerStatus,
  LiveTournamentRegistrationSource,
  TournamentArchiveDetails,
  TournamentFinancePayload,
  TournamentPlayersSummary,
  TournamentResultsPayload,
} from '../types.ts';

const PLAYERS_LOCAL_PREFIX = 'poker_live_tournament_players';
const PLAYERS_EMERGENCY_PREFIX = 'poker_live_tournament_players_emergency';
const SHARED_PLAYERS_PREFIX = '__live_players__';
const SHARED_PLAYERS_BACKUP_PREFIX = '__live_players_backup__';
const SHARED_PLAYERS_NAME_PREFIX = 'live_tournament_players';
const SHARED_PLAYERS_BACKUP_NAME_PREFIX = 'live_tournament_players_backup';
const SHARED_PLAYERS_TABLE = 'blind_templates';
const BOT_ROSTER_POLL_MS = 15_000;
const TOURNAMENT_UNIT_PRICE = 1000;
const PROMO_DISCOUNT_FACTOR = 0.5;
const SHARED_PLAYERS_BACKUP_KEEP_COUNT = 4;
const SHARED_PLAYERS_BACKUP_FETCH_COUNT = 16;

type UpdateGameState = (patch: Partial<GameState>, immediate?: boolean) => Promise<boolean | undefined>;

type UseTournamentPlayersOptions = {
  gameState: GameState;
  updateGameState: UpdateGameState;
  tournamentDate?: string | null;
  earlyBirdBonusEnabled?: boolean;
};

type PlayerSyncState = {
  loading: boolean;
  error: string | null;
  lastSyncedAt: string | null;
  shared: boolean;
};

type PlayerBackupInfo = {
  id: string;
  updatedAt: string | null;
  revision: number | null;
  playerCount: number;
  entrants: number;
  bustouts: number;
};

type SharedPlayersRow = {
  id: string;
  name: string;
  levels: unknown;
  created_at: string;
};

type StoredPlayersPayload = {
  version: 1;
  sessionId: number;
  tournamentBotId: number | null;
  tournamentTitle: string;
  updatedAt: string;
  revision?: number;
  resultsSentAt?: string | null;
  resultsSignature?: string | null;
  players: unknown;
};

type TournamentResultsSubmissionState = {
  sentAt: string | null;
  signature: string | null;
};

type PlayersSnapshotContext = {
  sessionId: number;
  tournamentBotId: number | null;
  tournamentTitle: string;
  storageKey: string;
  emergencyStorageKey: string;
  sharedStorageId: string;
  sharedBackupPrefix: string;
};

type LoadedPlayersSnapshot = {
  players: LiveTournamentPlayer[];
  updatedAt: string | null;
  revision: number | null;
  structured: boolean;
  resultsSubmission: TournamentResultsSubmissionState;
};

type QueuedSharedPlayersSnapshot = {
  players: LiveTournamentPlayer[];
  resultsSubmission: TournamentResultsSubmissionState;
  updatedAt: string;
  revision: number;
  context: PlayersSnapshotContext;
};

type HydratedPlayersSnapshotResolution = {
  snapshot: LoadedPlayersSnapshot | null;
  ignoredStaleLocal: boolean;
  recoveredFromEmergency: boolean;
};

function hasSharedPlayersStorage() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

function normalizeSessionId(resetAt: number) {
  return Math.max(1, Math.round(resetAt || 0));
}

function playersLocalKey(sessionId: number, tournamentBotId: number | null) {
  return `${PLAYERS_LOCAL_PREFIX}:${sessionId}:${tournamentBotId ?? 'manual'}`;
}

function playersEmergencyKey(tournamentBotId: number | null, tournamentTitle: string) {
  const normalizedTitle = normalizeTournamentTitle(tournamentTitle) || 'manual';
  return `${PLAYERS_EMERGENCY_PREFIX}:${tournamentBotId ?? normalizedTitle}`;
}

function playersSharedKey(sessionId: number, tournamentBotId: number | null) {
  return `${SHARED_PLAYERS_PREFIX}:${sessionId}:${tournamentBotId ?? 'manual'}`;
}

function playersSharedBackupPrefix(sessionId: number, tournamentBotId: number | null) {
  return `${SHARED_PLAYERS_BACKUP_PREFIX}:${sessionId}:${tournamentBotId ?? 'manual'}`;
}

function playersSharedBackupId(
  sessionId: number,
  tournamentBotId: number | null,
  revision: number,
  updatedAt: string
) {
  return `${playersSharedBackupPrefix(sessionId, tournamentBotId)}:${revision}:${updatedAt}`;
}

function buildPlayersSnapshotContext(
  sessionId: number,
  tournamentBotId: number | null,
  tournamentTitle: string
): PlayersSnapshotContext {
  return {
    sessionId,
    tournamentBotId,
    tournamentTitle,
    storageKey: playersLocalKey(sessionId, tournamentBotId),
    emergencyStorageKey: playersEmergencyKey(tournamentBotId, tournamentTitle),
    sharedStorageId: playersSharedKey(sessionId, tournamentBotId),
    sharedBackupPrefix: playersSharedBackupPrefix(sessionId, tournamentBotId),
  };
}

function buildSharedPlayersName(updatedAt = new Date().toISOString()) {
  return `${SHARED_PLAYERS_NAME_PREFIX}:${updatedAt}`;
}

function buildSharedPlayersBackupName(updatedAt = new Date().toISOString()) {
  return `${SHARED_PLAYERS_BACKUP_NAME_PREFIX}:${updatedAt}`;
}

function parseSharedPlayersUpdatedAt(name: string | null | undefined, fallback: string | null) {
  if (!name?.startsWith(`${SHARED_PLAYERS_NAME_PREFIX}:`)) return fallback;

  const value = name.slice(SHARED_PLAYERS_NAME_PREFIX.length + 1).trim();
  return value || fallback;
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

function normalizeTournamentTitle(value: string | null | undefined) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').toLowerCase()
    : '';
}

function normalizeResultsSubmission(
  sentAt: unknown,
  signature: unknown
): TournamentResultsSubmissionState {
  return {
    sentAt: typeof sentAt === 'string' && sentAt.trim() ? sentAt : null,
    signature: typeof signature === 'string' && signature.trim() ? signature : null,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function parseSnapshotUpdatedAt(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSnapshotRevision(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function getNextSnapshotRevision(currentRevision: number | null | undefined) {
  return (normalizeSnapshotRevision(currentRevision) ?? 0) + 1;
}

export function isIncomingPlayersSnapshotStale(
  currentUpdatedAt: string | null,
  incomingUpdatedAt: string | null,
  currentRevision: number | null = null,
  incomingRevision: number | null = null
) {
  const currentRev = normalizeSnapshotRevision(currentRevision);
  const incomingRev = normalizeSnapshotRevision(incomingRevision);

  if (currentRev !== null && incomingRev !== null) {
    if (incomingRev < currentRev) return true;
    if (incomingRev > currentRev) return false;
  } else if (currentRev === null && incomingRev !== null) {
    return false;
  }

  const currentTs = parseSnapshotUpdatedAt(currentUpdatedAt);
  const incomingTs = parseSnapshotUpdatedAt(incomingUpdatedAt);

  if (incomingTs === null) return currentTs !== null;
  if (currentTs === null) return false;
  return incomingTs < currentTs;
}

export function shouldIgnoreBotRosterResponse(
  requestedSessionId: number,
  requestedTournamentBotId: number | null,
  currentSessionId: number,
  currentTournamentBotId: number | null
) {
  return requestedSessionId !== currentSessionId || requestedTournamentBotId !== currentTournamentBotId;
}

function hasTournamentContextChanged(
  requestedContext: Pick<PlayersSnapshotContext, 'sessionId' | 'tournamentBotId' | 'tournamentTitle'>,
  currentContext: Pick<PlayersSnapshotContext, 'sessionId' | 'tournamentBotId' | 'tournamentTitle'>
) {
  if (requestedContext.sessionId !== currentContext.sessionId) return true;
  if (requestedContext.tournamentBotId !== currentContext.tournamentBotId) return true;
  if (requestedContext.tournamentBotId === null && currentContext.tournamentBotId === null) {
    return normalizeTournamentTitle(requestedContext.tournamentTitle) !== normalizeTournamentTitle(currentContext.tournamentTitle);
  }
  return false;
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isEarlyBird(registeredAt: string, tournamentDate?: string | null): boolean {
  const regDate = new Date(registeredAt);
  if (isNaN(regDate.getTime())) return false;
  if (!tournamentDate) return false;
  const tDate = new Date(tournamentDate);
  if (isNaN(tDate.getTime())) return false;
  const cutoff = new Date(tDate.getTime() - 3 * 60 * 60 * 1000);
  return regDate < cutoff;
}

function deriveBaseStatus(registrationSource: LiveTournamentRegistrationSource): LiveTournamentPlayerStatus {
  return registrationSource === 'waitlist' ? 'waitlist' : 'registered';
}

function normalizeArrivalStatus(value: unknown): LiveTournamentArrivalStatus {
  return value === 'paid' || value === 'free' || value === 'promo' || value === 'freePromo' || value === 'admin'
    ? value
    : 'absent';
}

function normalizeRegistrationSource(value: unknown): LiveTournamentRegistrationSource {
  return value === 'waitlist' ? 'waitlist' : 'registered';
}

function normalizePlayerStatus(value: unknown, fallback: LiveTournamentPlayerStatus): LiveTournamentPlayerStatus {
  return value === 'registered' || value === 'waitlist' || value === 'active' || value === 'out'
    ? value
    : fallback;
}

export function calcPaymentDue(
  arrivalStatus: LiveTournamentArrivalStatus,
  rebuyCount: number,
  addonCount: number,
  tournamentBuyIn: number | null = null
) {
  if (arrivalStatus === 'absent') return 0;

  // If buy_in is null — use hardcoded default for all actions.
  // If buy_in is 0 (free entry) — entry is free, rebuys/addons cost the default.
  // If buy_in > 0 — entry, rebuys and addons all cost buy_in.
  const entryPrice = tournamentBuyIn !== null ? tournamentBuyIn : TOURNAMENT_UNIT_PRICE;
  const rebuyAddonPrice = (tournamentBuyIn !== null && tournamentBuyIn > 0) ? tournamentBuyIn : TOURNAMENT_UNIT_PRICE;
  const actions = clampWhole(rebuyCount) + clampWhole(addonCount);

  if (arrivalStatus === 'freePromo') {
    // Free entry, 50% discount on all rebuys/addons
    return Math.round(actions * rebuyAddonPrice * PROMO_DISCOUNT_FACTOR);
  }

  if (arrivalStatus === 'admin') {
    // Free entry + 3 free rebuys/addons, then standard price per action
    const ADMIN_FREE_ACTIONS = 3;
    const paidActions = Math.max(0, actions - ADMIN_FREE_ACTIONS);
    return paidActions * TOURNAMENT_UNIT_PRICE;
  }

  const entryAmount = arrivalStatus === 'free' ? 0 : entryPrice;
  const total = entryAmount + actions * rebuyAddonPrice;
  return arrivalStatus === 'promo'
    ? Math.round(total * PROMO_DISCOUNT_FACTOR)
    : total;
}

function derivePaymentMethod(cashPaid: number, cardPaid: number): LiveTournamentPaymentMethod {
  if (cashPaid > 0 && cardPaid > 0) return 'split';
  if (cashPaid > 0) return 'cash';
  if (cardPaid > 0) return 'card';
  return 'unpaid';
}

function normalizePlayer(
  raw: Partial<LiveTournamentPlayer> & { paymentMethod?: string },
  sessionId: number,
  tournamentBotId: number | null,
  tournamentBuyIn: number | null = null
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
    realName: typeof raw.realName === 'string' && raw.realName.trim() ? raw.realName.trim() : null,
    phone: typeof raw.phone === 'string' && raw.phone.trim() ? raw.phone.trim() : null,
    instagram: typeof raw.instagram === 'string' && raw.instagram.trim() ? raw.instagram.trim() : null,
    source: raw.source === 'manual' ? 'manual' : 'bot',
    registrationSource,
    status,
    arrivalStatus,
    rebuyCount,
    addonCount,
    bonusCount,
    bounty: clampWhole(raw.bounty),
    bonusRcPoints: clampWhole(raw.bonusRcPoints),
    ...(() => {
      let cashPaid = clampWhole(raw.cashPaid);
      let cardPaid = clampWhole(raw.cardPaid);
      // Migrate legacy paymentMethod → cashPaid/cardPaid for old stored snapshots
      if (cashPaid === 0 && cardPaid === 0 && raw.paymentMethod) {
        const legacyDue = clampWhole(raw.paymentDue);
        if (raw.paymentMethod === 'cash') cashPaid = legacyDue;
        else if (raw.paymentMethod === 'card') cardPaid = legacyDue;
      }
      return { cashPaid, cardPaid };
    })(),
    paymentDue: (raw.paymentDueOverride === true && arrivalStatus !== 'absent')
      ? clampWhole(raw.paymentDue)
      : calcPaymentDue(arrivalStatus, rebuyCount, addonCount, tournamentBuyIn),
    paymentDueOverride: raw.paymentDueOverride === true && arrivalStatus !== 'absent',
    place: raw.place == null ? null : clampWhole(raw.place),
    placeOverride: raw.placeOverride === true,
    bustoutOrder: raw.bustoutOrder == null ? null : clampWhole(raw.bustoutOrder),
    sortOrder: clampWhole(raw.sortOrder),
    registeredAt: typeof raw.registeredAt === 'string' && raw.registeredAt ? raw.registeredAt : null,
    createdAt,
    updatedAt,
    tableNumber: typeof raw.tableNumber === 'number' && raw.tableNumber > 0 ? Math.round(raw.tableNumber) : null,
    seatNumber: typeof raw.seatNumber === 'number' && raw.seatNumber > 0 ? Math.round(raw.seatNumber) : null,
  };
}

function playerSort(a: LiveTournamentPlayer, b: LiveTournamentPlayer) {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name, 'ru');
}

function getNextPlayerSortOrder(players: LiveTournamentPlayer[]) {
  return players.reduce((max, player) => Math.max(max, player.sortOrder), -1) + 1;
}

export function rosterGroupSort(a: LiveTournamentPlayer, b: LiveTournamentPlayer) {
  return b.sortOrder - a.sortOrder || b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name, 'ru');
}

export function recalculatePlayers(players: LiveTournamentPlayer[], tournamentBuyIn: number | null = null) {
  const normalized = players.map(player => normalizePlayer(player, player.sessionId, player.tournamentBotId, tournamentBuyIn));
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

  const autoPlaceByPlayerId = new Map<string, number>();
  sortedOut.forEach(player => {
    const bustoutOrder = nextOutOrder.get(player.id) ?? 1;
    autoPlaceByPlayerId.set(player.id, Math.max(1, entrants - bustoutOrder + 1));
  });

  const candidatePlaceByPlayerId = new Map<string, number>();
  for (const player of sortedOut) {
    const autoPlace = autoPlaceByPlayerId.get(player.id) ?? 1;
    const candidatePlace = player.placeOverride && player.place !== null
      ? clampWhole(player.place)
      : autoPlace;
    candidatePlaceByPlayerId.set(player.id, candidatePlace);
  }

  const duplicateCandidatePlaces = new Set<number>();
  const seenCandidatePlaces = new Set<number>();
  for (const place of candidatePlaceByPlayerId.values()) {
    if (seenCandidatePlaces.has(place)) {
      duplicateCandidatePlaces.add(place);
    } else {
      seenCandidatePlaces.add(place);
    }
  }

  const finalPlaceByPlayerId = new Map<string, number>();
  const assignedFinalPlaces = new Set<number>();
  for (const player of sortedOut) {
    const candidatePlace = candidatePlaceByPlayerId.get(player.id) ?? 1;
    const autoPlace = autoPlaceByPlayerId.get(player.id) ?? 1;
    const preferredPlace = duplicateCandidatePlaces.has(candidatePlace) ? autoPlace : candidatePlace;
    const finalPlace = assignedFinalPlaces.has(preferredPlace) && !assignedFinalPlaces.has(autoPlace)
      ? autoPlace
      : preferredPlace;
    finalPlaceByPlayerId.set(player.id, finalPlace);
    assignedFinalPlaces.add(finalPlace);
  }

  const conflictedFinalPlaces = new Set<number>();
  const seenFinalPlaces = new Set<number>();
  for (const place of finalPlaceByPlayerId.values()) {
    if (seenFinalPlaces.has(place)) {
      conflictedFinalPlaces.add(place);
    } else {
      seenFinalPlaces.add(place);
    }
  }

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
      const autoPlace = autoPlaceByPlayerId.get(player.id) ?? Math.max(1, entrants - bustoutOrder + 1);
      const candidatePlace = candidatePlaceByPlayerId.get(player.id) ?? autoPlace;
      const duplicateCandidate = duplicateCandidatePlaces.has(candidatePlace);
      const finalPlace = finalPlaceByPlayerId.get(player.id) ?? autoPlace;
      const hasFinalPlaceConflict = conflictedFinalPlaces.has(finalPlace);
      return {
        ...player,
        status: 'out' as const,
        bustoutOrder,
        place: hasFinalPlaceConflict ? autoPlace : finalPlace,
        placeOverride: hasFinalPlaceConflict || duplicateCandidate ? false : player.placeOverride,
      };
    })
    .sort(playerSort);
}

function isTransientBotRosterPlayer(player: LiveTournamentPlayer) {
  return (
    player.source === 'bot' &&
    player.arrivalStatus === 'absent' &&
    player.status !== 'out' &&
    player.rebuyCount === 0 &&
    player.addonCount === 0 &&
    player.bonusCount === 0 &&
    player.bounty === 0 &&
    player.bonusRcPoints === 0 &&
    player.cashPaid === 0 &&
    player.cardPaid === 0 &&
    player.place === null &&
    !player.placeOverride &&
    player.bustoutOrder === null
  );
}

function normalizePlayersPayload(
  raw: unknown,
  sessionId: number,
  tournamentBotId: number | null
) {
  if (!Array.isArray(raw)) return [];

  return recalculatePlayers(
    raw.map(player => normalizePlayer(player as Partial<LiveTournamentPlayer>, sessionId, tournamentBotId))
  );
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
    a.bonusRcPoints === b.bonusRcPoints &&
    a.cashPaid === b.cashPaid &&
    a.cardPaid === b.cardPaid &&
    a.paymentDue === b.paymentDue &&
    a.place === b.place &&
    a.placeOverride === b.placeOverride &&
    a.bustoutOrder === b.bustoutOrder &&
    a.sortOrder === b.sortOrder &&
    a.registeredAt === b.registeredAt &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt &&
    a.tableNumber === b.tableNumber &&
    a.seatNumber === b.seatNumber
  );
}

function findImportedMatch(players: LiveTournamentPlayer[], importedPlayer: ImportedTournamentPlayer) {
  const normalizedName = importedPlayer.name.trim().toLowerCase();
  const normalizedUsername = importedPlayer.username?.trim().toLowerCase() ?? null;

  const exactMatch = players.find(player => (
    (importedPlayer.botRegistrationId && player.botRegistrationId === importedPlayer.botRegistrationId) ||
    (importedPlayer.telegramId !== null && player.telegramId === importedPlayer.telegramId) ||
    (
      player.source === 'bot' &&
      !player.botRegistrationId &&
      player.name.trim().toLowerCase() === normalizedName
    )
  ));

  if (exactMatch) return exactMatch;

  const botPlayers = players.filter(player => player.source === 'bot');

  if (normalizedUsername) {
    const usernameMatches = botPlayers.filter(player => player.username?.trim().toLowerCase() === normalizedUsername);
    if (usernameMatches.length === 1) {
      return usernameMatches[0];
    }
  }

  const nameMatches = botPlayers.filter(player => player.name.trim().toLowerCase() === normalizedName);
  if (nameMatches.length === 1) {
    return nameMatches[0];
  }

  return undefined;
}

function diffPlayers(previous: LiveTournamentPlayer[], next: LiveTournamentPlayer[]) {
  const previousById = new Map(previous.map(player => [player.id, player]));
  return next.filter(player => !playersEqual(previousById.get(player.id), player));
}

export function mergeChangedPlayersOntoSnapshot(
  currentPlayers: LiveTournamentPlayer[],
  changedPlayers: LiveTournamentPlayer[]
) {
  if (changedPlayers.length === 0) {
    return recalculatePlayers(currentPlayers);
  }

  const nextById = new Map(currentPlayers.map(player => [player.id, player]));
  changedPlayers.forEach(player => {
    nextById.set(player.id, player);
  });

  return recalculatePlayers(Array.from(nextById.values()));
}

export function mergeImportedRoster(
  previousPlayers: LiveTournamentPlayer[],
  importedPlayers: ImportedTournamentPlayer[],
  sessionId: number,
  tournamentBotId: number | null,
  tournamentDate?: string | null,
  earlyBirdBonusEnabled = true
) {
  let nextSortOrder = getNextPlayerSortOrder(previousPlayers);
  const mutable = previousPlayers.map(player => ({ ...player }));
  const matchedExistingIds = new Set<string>();
  const matchedExistingBotIds = new Set<string>();

  for (const imported of importedPlayers) {
    const existing = findImportedMatch(mutable, imported);

    if (existing) {
      matchedExistingIds.add(existing.id);
      if (existing.source === 'bot') {
        matchedExistingBotIds.add(existing.id);
      }
      const baseStatus = deriveBaseStatus(imported.registrationSource);
      // Auto-apply promo only if admin hasn't touched the arrival status yet
      const nextArrivalStatus: typeof existing.arrivalStatus =
        existing.arrivalStatus === 'absent' && isPromoUsername(imported.username)
          ? 'promo'
          : existing.arrivalStatus;
      const nextStatus = existing.status === 'out'
        ? 'out'
        : nextArrivalStatus === 'absent'
          ? baseStatus
          : 'active';
      const nextBotRegistrationId = imported.botRegistrationId ?? existing.botRegistrationId;
      const nextTelegramId = imported.telegramId ?? existing.telegramId;
      const nextRegisteredAt = imported.registeredAt ?? existing.registeredAt;
      const hasChanges =
        existing.tournamentBotId !== tournamentBotId ||
        existing.botRegistrationId !== nextBotRegistrationId ||
        existing.telegramId !== nextTelegramId ||
        existing.name !== imported.name ||
        existing.username !== imported.username ||
        existing.source !== 'bot' ||
        existing.registrationSource !== imported.registrationSource ||
        existing.status !== nextStatus ||
        existing.arrivalStatus !== nextArrivalStatus ||
        existing.registeredAt !== nextRegisteredAt;

      if (!hasChanges) {
        continue;
      }

      const nextBonusCount = earlyBirdBonusEnabled && existing.bonusCount === 0 && nextRegisteredAt && isEarlyBird(nextRegisteredAt, tournamentDate)
        ? 1
        : existing.bonusCount;

      Object.assign(existing, {
        ...existing,
        tournamentBotId,
        botRegistrationId: nextBotRegistrationId,
        telegramId: nextTelegramId,
        name: imported.name,
        username: imported.username,
        realName: imported.realName ?? existing.realName,
        phone: imported.phone ?? existing.phone,
        instagram: imported.instagram ?? existing.instagram,
        source: 'bot',
        registrationSource: imported.registrationSource,
        status: nextStatus,
        arrivalStatus: nextArrivalStatus,
        registeredAt: nextRegisteredAt,
        bonusCount: nextBonusCount,
        updatedAt: nowIso(),
      });
      continue;
    }

    const createdPlayer = normalizePlayer({
      id: createId(),
      sessionId,
      tournamentBotId,
      botRegistrationId: imported.botRegistrationId,
      telegramId: imported.telegramId,
      name: imported.name,
      username: imported.username,
      realName: imported.realName ?? null,
      phone: imported.phone ?? null,
      instagram: imported.instagram ?? null,
      source: 'bot',
      registrationSource: imported.registrationSource,
      status: deriveBaseStatus(imported.registrationSource),
      arrivalStatus: isPromoUsername(imported.username) ? 'promo' : 'absent',
      rebuyCount: 0,
      addonCount: 0,
      bonusCount: earlyBirdBonusEnabled && imported.registeredAt && isEarlyBird(imported.registeredAt, tournamentDate) ? 1 : 0,
      bounty: 0,
      cashPaid: 0,
      cardPaid: 0,
      paymentDue: 0,
      paymentDueOverride: false,
      place: null,
      placeOverride: false,
      bustoutOrder: null,
      sortOrder: nextSortOrder++,
      registeredAt: imported.registeredAt,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }, sessionId, tournamentBotId);
    matchedExistingIds.add(createdPlayer.id);
    mutable.push(createdPlayer);
  }

  const previousBotPlayers = previousPlayers.filter(player => player.source === 'bot');
  const staleBotRosterDetected = importedPlayers.length > 0 &&
    previousBotPlayers.length > 0 &&
    matchedExistingBotIds.size === 0;

  const nextPlayers = mutable.filter(player => !(
    (
      staleBotRosterDetected &&
      player.source === 'bot' &&
      !matchedExistingIds.has(player.id)
    ) ||
    (
      isTransientBotRosterPlayer(player) &&
      !matchedExistingIds.has(player.id)
    )
  ));

  const recalculated = recalculatePlayers(nextPlayers);
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
      if (player.arrivalStatus === 'free' || player.arrivalStatus === 'freePromo' || player.arrivalStatus === 'admin') summary.freeEntries += 1;

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

export function buildTournamentResultsPayload(params: {
  sessionId: number;
  tournamentBotId: number | null;
  tournamentTitle: string;
  finishedAt: string;
  levelsPlayed: number;
  totalStack: number;
  players: LiveTournamentPlayer[];
}): TournamentResultsPayload {
  const { sessionId, tournamentBotId, tournamentTitle, finishedAt, levelsPlayed, totalStack, players } = params;
  const eligiblePlayers = players.filter(player => player.arrivalStatus !== 'absent');
  const summary = summarizePlayers(eligiblePlayers);

  return {
    sessionId,
    tournamentBotId,
    tournamentTitle,
    tournamentMode: 'garage',
    finishedAt,
    levelsPlayed,
    gameStatus: 'completed',
    summary: {
      entrants: summary.entrants,
      active: summary.active,
      bustouts: summary.bustouts,
      pending: summary.pending,
      waitlist: summary.waitlist,
      rebuys: summary.rebuys,
      addons: summary.addons,
      bountyTotal: summary.bountyTotal,
      paidEntries: summary.paidEntries,
      freeEntries: summary.freeEntries,
      totalDue: summary.totalDue,
      bonusCount: summary.bonuses,
      totalStack,
      lateRegistrationPlayers: null,
      ratingPlayerCount: summary.entrants,
    },
    players: eligiblePlayers.map(player => ({
      id: player.id,
      botRegistrationId: player.botRegistrationId,
      telegramId: player.telegramId,
      name: player.name,
      username: player.username,
      source: player.source,
      registrationSource: player.registrationSource,
      arrivalStatus: player.arrivalStatus,
      paymentMethod: derivePaymentMethod(player.cashPaid, player.cardPaid),
      cashPaid: player.cashPaid,
      cardPaid: player.cardPaid,
      paymentDue: player.paymentDue,
      rebuyCount: player.rebuyCount,
      addonCount: player.addonCount,
      bounty: player.bounty,
      bonusRcPoints: player.bonusRcPoints,
      status: player.status,
      place: player.place,
      bustoutOrder: player.bustoutOrder,
    })),
  };
}

export function buildTournamentFinancePayload(params: {
  sessionId: number;
  tournamentBotId: number | null;
  tournamentTitle: string;
  finishedAt: string;
  levelsPlayed: number;
  players: LiveTournamentPlayer[];
}): TournamentFinancePayload {
  const { sessionId, tournamentBotId, tournamentTitle, finishedAt, levelsPlayed, players } = params;
  const eligiblePlayers = players.filter(player => player.arrivalStatus !== 'absent');
  const summary = summarizePlayers(eligiblePlayers);
  const cashTotal = eligiblePlayers.reduce((s, p) => s + p.cashPaid, 0);
  const cardTotal = eligiblePlayers.reduce((s, p) => s + p.cardPaid, 0);
  const totalPaid = cashTotal + cardTotal;
  const fullTotal = eligiblePlayers.reduce((s, p) => {
    if (p.arrivalStatus === 'promo' || p.arrivalStatus === 'freePromo') return s + p.paymentDue * 2;
    if (p.arrivalStatus === 'admin') {
      return s + (1 + clampWhole(p.rebuyCount) + clampWhole(p.addonCount)) * TOURNAMENT_UNIT_PRICE;
    }
    return s + p.paymentDue;
  }, 0);
  const discountTotal = fullTotal - summary.totalDue;

  return {
    sessionId,
    tournamentBotId,
    tournamentTitle,
    tournamentMode: 'garage',
    finishedAt,
    levelsPlayed,
    gameStatus: 'completed',
    summary: {
      entrants: summary.entrants,
      active: summary.active,
      bustouts: summary.bustouts,
      pending: summary.pending,
      waitlist: summary.waitlist,
      rebuys: summary.rebuys,
      addons: summary.addons,
      bonusCount: summary.bonuses,
      bountyTotal: summary.bountyTotal,
      paidEntries: summary.paidEntries,
      freeEntries: summary.freeEntries,
      totalDue: summary.totalDue,
      cashTotal,
      cardTotal,
      totalPaid,
      discountTotal,
    },
    players: eligiblePlayers.map(player => ({
      id: player.id,
      botRegistrationId: player.botRegistrationId,
      telegramId: player.telegramId,
      name: player.name,
      username: player.username,
      source: player.source,
      registrationSource: player.registrationSource,
      arrivalStatus: player.arrivalStatus,
      paymentMethod: derivePaymentMethod(player.cashPaid, player.cardPaid),
      cashPaid: player.cashPaid,
      cardPaid: player.cardPaid,
      paymentDue: player.paymentDue,
      rebuyCount: player.rebuyCount,
      addonCount: player.addonCount,
      bonusCount: player.bonusCount,
      bounty: player.bounty,
      status: player.status,
      place: player.place,
      bustoutOrder: player.bustoutOrder,
    })),
  };
}

function hasPlayerCounters(gameState: GameState) {
  return (
    gameState.players > 0 ||
    gameState.outs > 0 ||
    gameState.rebuys > 0 ||
    gameState.addonCount > 0 ||
    gameState.bonusCount > 0
  );
}

function matchesGameStateCounters(players: LiveTournamentPlayer[], gameState: GameState) {
  const summary = summarizePlayers(players);
  return (
    summary.entrants === gameState.players &&
    summary.bustouts === gameState.outs &&
    summary.rebuys === gameState.rebuys &&
    summary.addons === gameState.addonCount &&
    summary.bonuses === gameState.bonusCount
  );
}

export function buildStoredPlayersPayload(
  players: LiveTournamentPlayer[],
  sessionId: number,
  tournamentBotId: number | null,
  tournamentTitle: string,
  updatedAt = nowIso(),
  resultsSubmission: TournamentResultsSubmissionState = { sentAt: null, signature: null },
  revision: number | null = 1
): StoredPlayersPayload {
  return {
    version: 1,
    sessionId,
    tournamentBotId,
    tournamentTitle,
    updatedAt,
    revision: normalizeSnapshotRevision(revision) ?? 1,
    resultsSentAt: resultsSubmission.sentAt,
    resultsSignature: resultsSubmission.signature,
    players: recalculatePlayers(players),
  };
}

export function parseStoredPlayersPayload(
  raw: unknown,
  sessionId: number,
  tournamentBotId: number | null,
  tournamentTitle: string
): LoadedPlayersSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const payload = raw as Partial<StoredPlayersPayload>;
  if (payload.version !== 1 || !Array.isArray(payload.players)) return null;

  const payloadSessionId = typeof payload.sessionId === 'number' ? Math.max(1, Math.round(payload.sessionId)) : null;
  const payloadTournamentBotId = payload.tournamentBotId == null
    ? null
    : typeof payload.tournamentBotId === 'number' && Number.isFinite(payload.tournamentBotId)
      ? Math.round(payload.tournamentBotId)
      : null;
  const currentTitle = normalizeTournamentTitle(tournamentTitle);
  const payloadTitle = normalizeTournamentTitle(payload.tournamentTitle);

  if (payloadSessionId !== sessionId) return null;
  if (payloadTournamentBotId !== tournamentBotId) return null;
  if (tournamentBotId == null && currentTitle && payloadTitle && currentTitle !== payloadTitle) return null;

  return {
    players: normalizePlayersPayload(payload.players, sessionId, tournamentBotId),
    updatedAt: typeof payload.updatedAt === 'string' && payload.updatedAt ? payload.updatedAt : null,
    revision: normalizeSnapshotRevision(payload.revision),
    structured: true,
    resultsSubmission: normalizeResultsSubmission(payload.resultsSentAt, payload.resultsSignature),
  };
}

export function parseEmergencyPlayersPayload(
  raw: unknown,
  sessionId: number,
  tournamentBotId: number | null,
  tournamentTitle: string
): LoadedPlayersSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const payload = raw as Partial<StoredPlayersPayload>;
  if (payload.version !== 1 || !Array.isArray(payload.players)) return null;

  const payloadTournamentBotId = payload.tournamentBotId == null
    ? null
    : typeof payload.tournamentBotId === 'number' && Number.isFinite(payload.tournamentBotId)
      ? Math.round(payload.tournamentBotId)
      : null;
  const currentTitle = normalizeTournamentTitle(tournamentTitle);
  const payloadTitle = normalizeTournamentTitle(payload.tournamentTitle);

  if (payloadTournamentBotId !== tournamentBotId) return null;
  if (tournamentBotId == null && currentTitle && payloadTitle && currentTitle !== payloadTitle) return null;

  return {
    players: normalizePlayersPayload(payload.players, sessionId, tournamentBotId),
    updatedAt: typeof payload.updatedAt === 'string' && payload.updatedAt ? payload.updatedAt : null,
    revision: normalizeSnapshotRevision(payload.revision),
    structured: true,
    resultsSubmission: normalizeResultsSubmission(payload.resultsSentAt, payload.resultsSignature),
  };
}

function parseLegacyPlayersSnapshot(
  raw: unknown,
  sessionId: number,
  tournamentBotId: number | null
): LoadedPlayersSnapshot | null {
  if (!Array.isArray(raw)) return null;

  const inferredSessionIds = new Set(
    raw
      .map(item => (item && typeof item === 'object' && typeof (item as { sessionId?: unknown }).sessionId === 'number')
        ? Math.max(1, Math.round((item as { sessionId: number }).sessionId))
        : null)
      .filter((value): value is number => value !== null)
  );
  const inferredTournamentBotIds = new Set(
    raw
      .map(item => {
        if (!item || typeof item !== 'object') return undefined;
        const value = (item as { tournamentBotId?: unknown }).tournamentBotId;
        if (value === null) return null;
        return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
      })
      .filter((value): value is number | null => value !== undefined)
  );

  if (inferredSessionIds.size > 1 || inferredTournamentBotIds.size > 1) return null;

  const inferredSessionId = inferredSessionIds.size === 1 ? Array.from(inferredSessionIds)[0] : sessionId;
  const inferredTournamentBotId = inferredTournamentBotIds.size === 1
    ? Array.from(inferredTournamentBotIds)[0]
    : tournamentBotId;

  if (inferredSessionId !== sessionId) return null;
  if (inferredTournamentBotId !== tournamentBotId) return null;

  return {
    players: normalizePlayersPayload(raw, sessionId, tournamentBotId),
    updatedAt: null,
    revision: null,
    structured: false,
    resultsSubmission: { sentAt: null, signature: null },
  };
}

export function trustLoadedPlayersSnapshot(snapshot: LoadedPlayersSnapshot | null, gameState: GameState) {
  if (!snapshot) return null;
  if (snapshot.players.length === 0) return snapshot;

  if (snapshot.structured) {
    return snapshot;
  }

  if (!hasPlayerCounters(gameState)) {
    return null;
  }

  return matchesGameStateCounters(snapshot.players, gameState) ? snapshot : null;
}

export function resolveHydratedPlayersSnapshot(params: {
  primarySnapshot: LoadedPlayersSnapshot | null;
  emergencySnapshot: LoadedPlayersSnapshot | null;
  gameState: GameState;
}): HydratedPlayersSnapshotResolution {
  const trustedPrimary = trustLoadedPlayersSnapshot(params.primarySnapshot, params.gameState);
  const trustedEmergency = trustLoadedPlayersSnapshot(params.emergencySnapshot, params.gameState);
  const canRecoverFromEmergency = params.gameState.status !== 'idle' && Boolean(trustedEmergency?.players.length);
  const shouldPreferEmergency = canRecoverFromEmergency && (
    !trustedPrimary ||
    trustedPrimary.players.length === 0
  );

  return {
    snapshot: shouldPreferEmergency ? trustedEmergency : trustedPrimary,
    ignoredStaleLocal: Boolean(params.primarySnapshot?.players.length) && !trustedPrimary && !shouldPreferEmergency,
    recoveredFromEmergency: shouldPreferEmergency,
  };
}

export function sortPlayersForResults(players: LiveTournamentPlayer[]) {
  return [...players].sort((a, b) => {
    if (a.place !== null && b.place !== null) return a.place - b.place;
    if (a.place !== null) return -1;
    if (b.place !== null) return 1;
    return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru');
  });
}

export function findPlayerWithPlaceConflict(
  players: LiveTournamentPlayer[],
  playerId: string,
  place: number | null
) {
  if (place == null) return null;

  return players.find(player => (
    player.id !== playerId &&
    player.arrivalStatus !== 'absent' &&
    player.place === place
  )) ?? null;
}

export function buildTournamentResultsSignature(payload: TournamentResultsPayload) {
  const { finishedAt, ...stablePayload } = payload;
  void finishedAt;
  return JSON.stringify(stablePayload);
}

function formatSharedPlayersError(action: string, error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  if (code === '42P01') {
    return `Общий список игроков недоступен: в Supabase нет таблицы ${SHARED_PLAYERS_TABLE}.`;
  }

  if (code === '42501') {
    return `Supabase не разрешает ${action} общий список игроков.`;
  }

  return `Не удалось ${action} общий список игроков.`;
}

export function useTournamentPlayers({ gameState, updateGameState, tournamentDate, earlyBirdBonusEnabled = true }: UseTournamentPlayersOptions) {
  const sharedEnabled = hasSharedPlayersStorage();
  const sessionId = normalizeSessionId(gameState.resetAt);
  const tournamentBotId = gameState.tournamentBotId;
  const tournamentTitle = gameState.tournamentTitle;
  const storageKey = playersLocalKey(sessionId, tournamentBotId);
  const emergencyStorageKey = playersEmergencyKey(tournamentBotId, tournamentTitle);
  const sharedStorageId = playersSharedKey(sessionId, tournamentBotId);

  const [players, setPlayers] = useState<LiveTournamentPlayer[]>([]);
  const [botSyncState, setBotSyncState] = useState({
    loading: false,
    error: null as string | null,
    lastSyncedAt: null as string | null,
    disabled: false,
  });
  const [playerSyncState, setPlayerSyncState] = useState<PlayerSyncState>({
    loading: sharedEnabled,
    error: null,
    lastSyncedAt: null,
    shared: false,
  });
  const [playerBackups, setPlayerBackups] = useState<PlayerBackupInfo[]>([]);
  const [resultsSubmission, setResultsSubmission] = useState<TournamentResultsSubmissionState>({
    sentAt: null,
    signature: null,
  });

  const playersRef = useRef(players);
  const gameStateRef = useRef(gameState);
  const sessionIdRef = useRef(sessionId);
  const tournamentBotIdRef = useRef(tournamentBotId);
  const tournamentDateRef = useRef(tournamentDate);
  const earlyBirdBonusEnabledRef = useRef(earlyBirdBonusEnabled);
  const tournamentTitleRef = useRef(tournamentTitle);
  const storageKeyRef = useRef(storageKey);
  const emergencyStorageKeyRef = useRef(emergencyStorageKey);
  const sharedStorageIdRef = useRef(sharedStorageId);
  const sharedBackupPrefixRef = useRef(playersSharedBackupPrefix(sessionId, tournamentBotId));
  const botSyncUnsupported = useRef(false);
  const playersHydratedRef = useRef(!sharedEnabled);
  const resultsSubmissionRef = useRef(resultsSubmission);
  const snapshotUpdatedAtRef = useRef<string | null>(null);
  const snapshotRevisionRef = useRef<number | null>(null);
  const sharedPersistInFlightRef = useRef(false);
  const queuedSharedPersistRef = useRef<QueuedSharedPlayersSnapshot | null>(null);

  const getCurrentSnapshotContext = useCallback((): PlayersSnapshotContext => ({
    sessionId: sessionIdRef.current,
    tournamentBotId: tournamentBotIdRef.current,
    tournamentTitle: tournamentTitleRef.current,
    storageKey: storageKeyRef.current,
    emergencyStorageKey: emergencyStorageKeyRef.current,
    sharedStorageId: sharedStorageIdRef.current,
    sharedBackupPrefix: sharedBackupPrefixRef.current,
  }), []);

  const summary = useMemo(() => summarizePlayers(players), [players]);
  const currentResultsSignature = useMemo(() => {
    if (players.length === 0 || gameState.tournamentBotId == null) return null;

    const orderedPlayers = sortPlayersForResults(players);
    const payload = buildTournamentResultsPayload({
      sessionId,
      tournamentBotId: gameState.tournamentBotId,
      tournamentTitle: gameState.tournamentTitle,
      finishedAt: '',
      levelsPlayed: gameState.currentLevelIndex + 1,
      totalStack: gameState.totalStack,
      players: orderedPlayers,
    });

    return buildTournamentResultsSignature(payload);
  }, [
    gameState.currentLevelIndex,
    gameState.totalStack,
    gameState.tournamentBotId,
    gameState.tournamentTitle,
    players,
    sessionId,
  ]);

  const groupedPlayers = useMemo(() => ({
    active: players.filter(player => player.status === 'active').sort(rosterGroupSort),
    pending: players.filter(player => player.status === 'registered').sort(rosterGroupSort),
    waitlist: players.filter(player => player.status === 'waitlist').sort(rosterGroupSort),
    out: [...players.filter(player => player.status === 'out')].sort((a, b) => {
      if (a.place !== null && b.place !== null) return a.place - b.place;
      if (a.place !== null) return -1;
      if (b.place !== null) return 1;
      return rosterGroupSort(a, b);
    }),
  }), [players]);

  const applyPlayersSnapshot = useCallback((
    nextPlayers: LiveTournamentPlayer[],
    nextResultsSubmission: TournamentResultsSubmissionState = resultsSubmissionRef.current,
    updatedAt = nowIso(),
    revision = snapshotRevisionRef.current,
    context: PlayersSnapshotContext = getCurrentSnapshotContext()
  ) => {
    if (hasTournamentContextChanged(context, getCurrentSnapshotContext())) {
      return playersRef.current;
    }

    const normalized = recalculatePlayers(nextPlayers, gameStateRef.current.tournamentBuyIn);
    const normalizedRevision = normalizeSnapshotRevision(revision);
    playersRef.current = normalized;
    resultsSubmissionRef.current = nextResultsSubmission;
    snapshotUpdatedAtRef.current = updatedAt;
    snapshotRevisionRef.current = normalizedRevision;
    setPlayers(normalized);
    setResultsSubmission(nextResultsSubmission);
    const payload = buildStoredPlayersPayload(
      normalized,
      context.sessionId,
      context.tournamentBotId,
      context.tournamentTitle,
      updatedAt,
      nextResultsSubmission,
      normalizedRevision
    );
    saveLocal(context.storageKey, payload);
    saveLocal(context.emergencyStorageKey, payload);
    return normalized;
  }, [getCurrentSnapshotContext, setPlayers, setResultsSubmission]);

  const loadSharedPlayersSnapshot = useCallback(async () => {
    if (!sharedEnabled) return null;

    const { data, error } = await supabase
      .from(SHARED_PLAYERS_TABLE)
      .select('id, name, levels, created_at')
      .eq('id', sharedStorageIdRef.current)
      .maybeSingle();

    if (error) {
      setPlayerSyncState(prev => ({
        ...prev,
        loading: false,
        error: formatSharedPlayersError('загрузить', error),
        shared: false,
      }));
      return null;
    }

    if (!data) {
      return {
        found: false as const,
        players: [] as LiveTournamentPlayer[],
        lastSyncedAt: null as string | null,
        revision: null as number | null,
        resultsSubmission: { sentAt: null, signature: null },
      };
    }

    const row = data as SharedPlayersRow;
    const parsedSnapshot = parseStoredPlayersPayload(
      row.levels,
      sessionIdRef.current,
      tournamentBotIdRef.current,
      tournamentTitleRef.current
    );

    if (!parsedSnapshot) {
      return {
        found: false as const,
        players: [] as LiveTournamentPlayer[],
        lastSyncedAt: null as string | null,
        revision: null as number | null,
        resultsSubmission: { sentAt: null, signature: null },
      };
    }

    return {
      found: true as const,
      players: parsedSnapshot.players,
      lastSyncedAt: parsedSnapshot.updatedAt ?? parseSharedPlayersUpdatedAt(row.name, row.created_at),
      revision: parsedSnapshot.revision,
      resultsSubmission: parsedSnapshot.resultsSubmission,
    };
  }, [sharedEnabled]);

  const loadSharedPlayersBackups = useCallback(async () => {
    if (!sharedEnabled) {
      setPlayerBackups([]);
      return [];
    }

    const { data, error } = await supabase
      .from(SHARED_PLAYERS_TABLE)
      .select('id, name, levels, created_at')
      .like('id', `${sharedBackupPrefixRef.current}:%`)
      .order('created_at', { ascending: false })
      .limit(SHARED_PLAYERS_BACKUP_FETCH_COUNT);

    if (error) {
      return [];
    }

    const backups = (data ?? [])
      .map(row => {
        const typedRow = row as SharedPlayersRow;
        const parsedSnapshot = parseStoredPlayersPayload(
          typedRow.levels,
          sessionIdRef.current,
          tournamentBotIdRef.current,
          tournamentTitleRef.current
        );
        if (!parsedSnapshot) return null;

        const snapshotSummary = summarizePlayers(parsedSnapshot.players);
        return {
          id: typedRow.id,
          updatedAt: parsedSnapshot.updatedAt ?? parseSharedPlayersUpdatedAt(typedRow.name, typedRow.created_at),
          revision: parsedSnapshot.revision,
          playerCount: parsedSnapshot.players.length,
          entrants: snapshotSummary.entrants,
          bustouts: snapshotSummary.bustouts,
        } satisfies PlayerBackupInfo;
      })
      .filter((backup): backup is PlayerBackupInfo => Boolean(backup));

    setPlayerBackups(backups.slice(0, SHARED_PLAYERS_BACKUP_KEEP_COUNT));
    return backups;
  }, [sharedEnabled]);

  const persistSharedPlayersBackup = useCallback(async (
    nextPlayers: LiveTournamentPlayer[],
    nextResultsSubmission: TournamentResultsSubmissionState,
    updatedAt: string,
    revision: number,
    context: PlayersSnapshotContext
  ) => {
    if (!sharedEnabled) return false;

    const backupId = playersSharedBackupId(
      context.sessionId,
      context.tournamentBotId,
      revision,
      updatedAt
    );

    const payload = {
      id: backupId,
      name: buildSharedPlayersBackupName(updatedAt),
      levels: buildStoredPlayersPayload(
        nextPlayers,
        context.sessionId,
        context.tournamentBotId,
        context.tournamentTitle,
        updatedAt,
        nextResultsSubmission,
        revision
      ),
    };

    const { error } = await supabase.from(SHARED_PLAYERS_TABLE).upsert(payload);
    if (error) return false;

    const backups = await loadSharedPlayersBackups();
    const staleIds = backups.slice(SHARED_PLAYERS_BACKUP_KEEP_COUNT).map(backup => backup.id);
    if (staleIds.length > 0) {
      await supabase.from(SHARED_PLAYERS_TABLE).delete().in('id', staleIds);
      await loadSharedPlayersBackups();
    }

    return true;
  }, [loadSharedPlayersBackups, sharedEnabled]);

  const syncLatestSharedPlayersSnapshot = useCallback(async () => {
    if (!sharedEnabled) {
      return {
        players: playersRef.current,
        resultsSubmission: resultsSubmissionRef.current,
        updatedAt: snapshotUpdatedAtRef.current,
        revision: snapshotRevisionRef.current,
      };
    }

    const sharedSnapshot = await loadSharedPlayersSnapshot();
    if (!sharedSnapshot?.found) {
      return {
        players: playersRef.current,
        resultsSubmission: resultsSubmissionRef.current,
        updatedAt: snapshotUpdatedAtRef.current,
        revision: snapshotRevisionRef.current,
      };
    }

    const trustedSharedSnapshot = trustLoadedPlayersSnapshot({
      players: sharedSnapshot.players,
      updatedAt: sharedSnapshot.lastSyncedAt,
      revision: sharedSnapshot.revision,
      structured: true,
      resultsSubmission: sharedSnapshot.resultsSubmission,
    }, gameStateRef.current);

    if (!trustedSharedSnapshot) {
      return {
        players: playersRef.current,
        resultsSubmission: resultsSubmissionRef.current,
        updatedAt: snapshotUpdatedAtRef.current,
        revision: snapshotRevisionRef.current,
      };
    }

    if (isIncomingPlayersSnapshotStale(
      snapshotUpdatedAtRef.current,
      trustedSharedSnapshot.updatedAt,
      snapshotRevisionRef.current,
      trustedSharedSnapshot.revision
    )) {
      return {
        players: playersRef.current,
        resultsSubmission: resultsSubmissionRef.current,
        updatedAt: snapshotUpdatedAtRef.current,
        revision: snapshotRevisionRef.current,
      };
    }

    applyPlayersSnapshot(
      trustedSharedSnapshot.players,
      trustedSharedSnapshot.resultsSubmission,
      trustedSharedSnapshot.updatedAt ?? nowIso(),
      trustedSharedSnapshot.revision
    );
    setPlayerSyncState(prev => ({
      ...prev,
      loading: false,
      error: null,
      lastSyncedAt: trustedSharedSnapshot.updatedAt,
      shared: true,
    }));

    return {
      players: trustedSharedSnapshot.players,
      resultsSubmission: trustedSharedSnapshot.resultsSubmission,
      updatedAt: trustedSharedSnapshot.updatedAt,
      revision: trustedSharedSnapshot.revision,
    };
  }, [applyPlayersSnapshot, loadSharedPlayersSnapshot, setPlayerSyncState, sharedEnabled]);

  const persistSharedPlayersSnapshot = useCallback(async (
    nextPlayers: LiveTournamentPlayer[],
    nextResultsSubmission: TournamentResultsSubmissionState = resultsSubmissionRef.current,
    updatedAt = nowIso(),
    revision = getNextSnapshotRevision(snapshotRevisionRef.current),
    context: PlayersSnapshotContext = getCurrentSnapshotContext()
  ) => {
    if (!sharedEnabled) return false;

    queuedSharedPersistRef.current = {
      players: nextPlayers,
      resultsSubmission: nextResultsSubmission,
      updatedAt,
      revision,
      context,
    };

    if (sharedPersistInFlightRef.current) return true;

    sharedPersistInFlightRef.current = true;
    let lastPersistedAt: string | null = null;

    try {
      while (queuedSharedPersistRef.current) {
        const pending = queuedSharedPersistRef.current;
        queuedSharedPersistRef.current = null;

        const payload = {
          id: pending.context.sharedStorageId,
          name: buildSharedPlayersName(pending.updatedAt),
          levels: buildStoredPlayersPayload(
            pending.players,
            pending.context.sessionId,
            pending.context.tournamentBotId,
            pending.context.tournamentTitle,
            pending.updatedAt,
            pending.resultsSubmission,
            pending.revision
          ),
        };

        const { error } = await supabase.from(SHARED_PLAYERS_TABLE).upsert(payload);
        if (error) {
          setPlayerSyncState(prev => ({
            ...prev,
            loading: false,
            error: formatSharedPlayersError('сохранить', error),
            shared: false,
          }));
          return false;
        }

        lastPersistedAt = pending.updatedAt;
        void persistSharedPlayersBackup(
          pending.players,
          pending.resultsSubmission,
          pending.updatedAt,
          pending.revision,
          pending.context
        );
      }
    } finally {
      sharedPersistInFlightRef.current = false;
    }

    if (!lastPersistedAt) return true;

    setPlayerSyncState(prev => ({
      ...prev,
      loading: false,
      error: null,
      lastSyncedAt: isIncomingPlayersSnapshotStale(prev.lastSyncedAt, lastPersistedAt)
        ? prev.lastSyncedAt
        : lastPersistedAt,
      shared: true,
    }));
    return true;
  }, [getCurrentSnapshotContext, persistSharedPlayersBackup, sharedEnabled]);

  const commitPlayersSnapshot = useCallback(async (
    nextPlayers: LiveTournamentPlayer[],
    nextResultsSubmission: TournamentResultsSubmissionState = resultsSubmissionRef.current,
    nextRevision = getNextSnapshotRevision(snapshotRevisionRef.current),
    context: PlayersSnapshotContext = getCurrentSnapshotContext()
  ) => {
    const updatedAt = nowIso();
    const normalized = applyPlayersSnapshot(nextPlayers, nextResultsSubmission, updatedAt, nextRevision, context);
    void persistSharedPlayersSnapshot(normalized, nextResultsSubmission, updatedAt, nextRevision, context);
    return normalized;
  }, [applyPlayersSnapshot, getCurrentSnapshotContext, persistSharedPlayersSnapshot]);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    tournamentBotIdRef.current = tournamentBotId;
  }, [tournamentBotId]);

  useEffect(() => {
    tournamentDateRef.current = tournamentDate;
  }, [tournamentDate]);

  useEffect(() => {
    earlyBirdBonusEnabledRef.current = earlyBirdBonusEnabled;
  }, [earlyBirdBonusEnabled]);

  useEffect(() => {
    tournamentTitleRef.current = tournamentTitle;
  }, [tournamentTitle]);

  useEffect(() => {
    sharedStorageIdRef.current = sharedStorageId;
  }, [sharedStorageId]);

  useEffect(() => {
    sharedBackupPrefixRef.current = playersSharedBackupPrefix(sessionId, tournamentBotId);
  }, [sessionId, tournamentBotId]);

  useEffect(() => {
    emergencyStorageKeyRef.current = emergencyStorageKey;
  }, [emergencyStorageKey]);

  useEffect(() => {
    storageKeyRef.current = storageKey;
    playersHydratedRef.current = !sharedEnabled;

    const storedPrimarySnapshot = loadLocal<unknown>(storageKey, null);
    const parsedLocalSnapshot = parseStoredPlayersPayload(
      storedPrimarySnapshot,
      sessionId,
      tournamentBotId,
      tournamentTitle
    );
    const legacyLocalSnapshot = parsedLocalSnapshot
      ? null
      : parseLegacyPlayersSnapshot(storedPrimarySnapshot, sessionId, tournamentBotId);
    const parsedEmergencySnapshot = parseEmergencyPlayersPayload(
      loadLocal<unknown>(emergencyStorageKey, null),
      sessionId,
      tournamentBotId,
      tournamentTitle
    );
    const localSnapshotResolution = resolveHydratedPlayersSnapshot({
      primarySnapshot: parsedLocalSnapshot ?? legacyLocalSnapshot,
      emergencySnapshot: parsedEmergencySnapshot,
      gameState: gameStateRef.current,
    });
    const trustedLocalSnapshot = localSnapshotResolution.snapshot;
    const trustedLocalPlayers = trustedLocalSnapshot?.players ?? [];
    const trustedLocalResultsSubmission = trustedLocalSnapshot?.resultsSubmission ?? { sentAt: null, signature: null };

    playersRef.current = trustedLocalPlayers;
    resultsSubmissionRef.current = trustedLocalResultsSubmission;
    snapshotUpdatedAtRef.current = trustedLocalSnapshot?.updatedAt ?? null;
    snapshotRevisionRef.current = trustedLocalSnapshot?.revision ?? null;
    botSyncUnsupported.current = false;

    startTransition(() => {
      setPlayers(trustedLocalPlayers);
      setResultsSubmission(trustedLocalResultsSubmission);
      setPlayerBackups([]);
      setBotSyncState({
        loading: false,
        error: null,
        lastSyncedAt: null,
        disabled: false,
      });
      setPlayerSyncState({
        loading: sharedEnabled,
        error: localSnapshotResolution.ignoredStaleLocal
          ? 'На этом устройстве был старый локальный список игроков. Он не совпал с текущим турниром и был скрыт.'
          : null,
        lastSyncedAt: trustedLocalSnapshot?.updatedAt ?? null,
        shared: false,
      });
    });

    let cancelled = false;

    if (!sharedEnabled) return () => { cancelled = true; };

    const hydrateSharedPlayers = async () => {
      void loadSharedPlayersBackups();
      const sharedSnapshot = await loadSharedPlayersSnapshot();
      if (cancelled || !sharedSnapshot) return;

      if (sharedSnapshot.found) {
        const trustedSharedSnapshot = trustLoadedPlayersSnapshot({
          players: sharedSnapshot.players,
          updatedAt: sharedSnapshot.lastSyncedAt,
          revision: sharedSnapshot.revision,
          structured: true,
          resultsSubmission: sharedSnapshot.resultsSubmission,
        }, gameStateRef.current);

        if (trustedSharedSnapshot) {
          if (isIncomingPlayersSnapshotStale(
            snapshotUpdatedAtRef.current,
            trustedSharedSnapshot.updatedAt,
            snapshotRevisionRef.current,
            trustedSharedSnapshot.revision
          )) {
            setPlayerSyncState(prev => ({
              ...prev,
              loading: false,
              shared: true,
            }));
            playersHydratedRef.current = true;
            return;
          }

          applyPlayersSnapshot(
            trustedSharedSnapshot.players,
            trustedSharedSnapshot.resultsSubmission,
            trustedSharedSnapshot.updatedAt ?? nowIso(),
            trustedSharedSnapshot.revision
          );
          setPlayerSyncState(prev => ({
            ...prev,
            loading: false,
            error: null,
            lastSyncedAt: trustedSharedSnapshot.updatedAt,
            shared: true,
          }));
          playersHydratedRef.current = true;
          return;
        }
      }

      if (trustedLocalPlayers.length > 0) {
        await persistSharedPlayersSnapshot(
          trustedLocalPlayers,
          trustedLocalResultsSubmission,
          trustedLocalSnapshot?.updatedAt ?? nowIso(),
          trustedLocalSnapshot?.revision ?? getNextSnapshotRevision(null)
        );
      } else if (!cancelled) {
        setPlayerSyncState(prev => ({
          ...prev,
          loading: false,
        }));
      }

      if (!cancelled) {
        playersHydratedRef.current = true;
      }
    };

    void hydrateSharedPlayers();

    return () => {
      cancelled = true;
    };
  }, [
    applyPlayersSnapshot,
    loadSharedPlayersBackups,
    loadSharedPlayersSnapshot,
    persistSharedPlayersSnapshot,
    emergencyStorageKey,
    sessionId,
    sharedEnabled,
    storageKey,
    tournamentTitle,
    tournamentBotId,
  ]);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    resultsSubmissionRef.current = resultsSubmission;
  }, [resultsSubmission]);

  useEffect(() => {
    if (!sharedEnabled) return;

    const channel = supabase
      .channel(`live-players-sync:${sharedStorageId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: SHARED_PLAYERS_TABLE }, (payload) => {
        const nextRow = payload.new as { id?: unknown } | null;
        const prevRow = payload.old as { id?: unknown } | null;
        const payloadId = typeof nextRow?.id === 'string'
          ? nextRow.id
          : typeof prevRow?.id === 'string'
            ? prevRow.id
            : null;

        if (payloadId !== sharedStorageIdRef.current) return;

        void loadSharedPlayersSnapshot().then(sharedSnapshot => {
          if (!sharedSnapshot?.found) return;
          void loadSharedPlayersBackups();

          if (isIncomingPlayersSnapshotStale(
            snapshotUpdatedAtRef.current,
            sharedSnapshot.lastSyncedAt,
            snapshotRevisionRef.current,
            sharedSnapshot.revision
          )) {
            return;
          }

          applyPlayersSnapshot(
            sharedSnapshot.players,
            sharedSnapshot.resultsSubmission,
            sharedSnapshot.lastSyncedAt ?? nowIso(),
            sharedSnapshot.revision
          );
          setPlayerSyncState(prev => ({
            ...prev,
            loading: false,
            error: null,
            lastSyncedAt: sharedSnapshot.lastSyncedAt,
            shared: true,
          }));
        });
      })
      .subscribe();

    const pollInterval = window.setInterval(() => {
      void loadSharedPlayersSnapshot().then(sharedSnapshot => {
        if (!sharedSnapshot?.found) return;
        if (isIncomingPlayersSnapshotStale(
          snapshotUpdatedAtRef.current,
          sharedSnapshot.lastSyncedAt,
          snapshotRevisionRef.current,
          sharedSnapshot.revision
        )) return;
        applyPlayersSnapshot(
          sharedSnapshot.players,
          sharedSnapshot.resultsSubmission,
          sharedSnapshot.lastSyncedAt ?? nowIso(),
          sharedSnapshot.revision
        );
      });
    }, 10_000);

    return () => {
      window.clearInterval(pollInterval);
      void supabase.removeChannel(channel);
    };
  }, [applyPlayersSnapshot, loadSharedPlayersBackups, loadSharedPlayersSnapshot, sharedEnabled, sharedStorageId]);

  const applyPlayerMutation = useCallback(async (
    mutate: (current: LiveTournamentPlayer[]) => LiveTournamentPlayer[]
  ) => {
    const requestedContext = getCurrentSnapshotContext();
    const baseSnapshot = await syncLatestSharedPlayersSnapshot();
    if (hasTournamentContextChanged(requestedContext, getCurrentSnapshotContext())) {
      return playersRef.current;
    }
    const mutated = recalculatePlayers(mutate(baseSnapshot.players).map(player => ({
      ...player,
      updatedAt: player.updatedAt || nowIso(),
    })), gameStateRef.current.tournamentBuyIn);
    const changedPlayers = diffPlayers(baseSnapshot.players, mutated);

    if (changedPlayers.length === 0 && mutated.length === baseSnapshot.players.length) {
      return baseSnapshot.players;
    }

    const latestSnapshot = await syncLatestSharedPlayersSnapshot();
    if (hasTournamentContextChanged(requestedContext, getCurrentSnapshotContext())) {
      return playersRef.current;
    }
    const rebasedPlayers = mergeChangedPlayersOntoSnapshot(latestSnapshot.players, changedPlayers);
    await commitPlayersSnapshot(
      rebasedPlayers,
      latestSnapshot.resultsSubmission,
      getNextSnapshotRevision(latestSnapshot.revision),
      requestedContext
    );
    return rebasedPlayers;
  }, [commitPlayersSnapshot, getCurrentSnapshotContext, syncLatestSharedPlayersSnapshot]);

  const refreshFromBot = useCallback(async (force = false) => {
    if (tournamentBotId == null) return false;
    if (!playersHydratedRef.current) return false;
    const requestedSessionId = sessionIdRef.current;
    const requestedTournamentBotId = tournamentBotId;

    if (force) {
      botSyncUnsupported.current = false;
      setBotSyncState(prev => ({ ...prev, disabled: false }));
    }
    if (botSyncUnsupported.current) return false;

    setBotSyncState(prev => ({ ...prev, loading: true, error: null }));
    const result = await fetchBotTournamentRoster(requestedTournamentBotId);

    if (shouldIgnoreBotRosterResponse(
      requestedSessionId,
      requestedTournamentBotId,
      sessionIdRef.current,
      tournamentBotIdRef.current
    )) {
      return false;
    }

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
    const baseSnapshot = await syncLatestSharedPlayersSnapshot();

    if (shouldIgnoreBotRosterResponse(
      requestedSessionId,
      requestedTournamentBotId,
      sessionIdRef.current,
      tournamentBotIdRef.current
    )) {
      return false;
    }

    const merged = mergeImportedRoster(
      baseSnapshot.players,
      imported,
      sessionIdRef.current,
      tournamentBotIdRef.current,
      tournamentDateRef.current,
      earlyBirdBonusEnabledRef.current
    );
    if (merged.changedRows.length > 0 || merged.players.length !== baseSnapshot.players.length) {
      const latestSnapshot = await syncLatestSharedPlayersSnapshot();

      if (shouldIgnoreBotRosterResponse(
        requestedSessionId,
        requestedTournamentBotId,
        sessionIdRef.current,
        tournamentBotIdRef.current
      )) {
        return false;
      }

      // Re-merge the bot import onto the latest snapshot rather than applying
      // changedRows from a potentially stale base. This prevents a race condition
      // where two concurrent refreshes (e.g. regular poll + sanitization) both
      // start from an empty base, each create N players with different IDs, and
      // then mergeChangedPlayersOntoSnapshot combines both sets → 2N players.
      // Re-merging uses name/username matching to find already-committed players
      // and update rather than duplicate them.
      const latestMerge = mergeImportedRoster(
        latestSnapshot.players,
        imported,
        sessionIdRef.current,
        tournamentBotIdRef.current,
        tournamentDateRef.current,
        earlyBirdBonusEnabledRef.current
      );
      if (latestMerge.changedRows.length > 0 || latestMerge.players.length !== latestSnapshot.players.length) {
        await commitPlayersSnapshot(
          latestMerge.players,
          latestSnapshot.resultsSubmission,
          getNextSnapshotRevision(latestSnapshot.revision)
        );
      }
    }
    setBotSyncState({
      loading: false,
      error: null,
      lastSyncedAt: nowIso(),
      disabled: false,
    });
    return true;
  }, [commitPlayersSnapshot, syncLatestSharedPlayersSnapshot, tournamentBotId]);

  useEffect(() => {
    if (tournamentBotId == null) return;
    if (sharedEnabled && playerSyncState.loading) return;

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
  }, [playerSyncState.loading, refreshFromBot, sharedEnabled, tournamentBotId]);

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
      const nextSortOrder = getNextPlayerSortOrder(current);
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
          cashPaid: 0,
          cardPaid: 0,
          paymentDue: TOURNAMENT_UNIT_PRICE,
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
    const currentPlayer = playersRef.current.find(player => player.id === playerId);
    if (!currentPlayer) return false;

    const nextPlayer = normalizePlayer({
      ...currentPlayer,
      ...patch,
      updatedAt: nowIso(),
    }, sessionId, tournamentBotId);

    const conflictingPlayer = nextPlayer.arrivalStatus !== 'absent'
      ? findPlayerWithPlaceConflict(playersRef.current, playerId, nextPlayer.place)
      : null;

    if (conflictingPlayer) {
      return false;
    }

    await applyPlayerMutation(current => current.map(player => {
      if (player.id !== playerId) return player;

      return nextPlayer;
    }));
    return true;
  }, [applyPlayerMutation, sessionId, tournamentBotId]);

  const setPlayerArrival = useCallback(async (playerId: string, arrivalStatus: LiveTournamentArrivalStatus) => {
    await applyPlayerMutation(current => current.map(player => {
      if (player.id !== playerId) return player;

      const nextStatus = arrivalStatus === 'absent'
        ? deriveBaseStatus(player.registrationSource)
        : 'active';
      const becameActive = player.arrivalStatus === 'absent' && arrivalStatus !== 'absent';
      const nextSortOrder = becameActive ? getNextPlayerSortOrder(current) : player.sortOrder;

      return normalizePlayer({
        ...player,
        arrivalStatus,
        status: nextStatus,
        cashPaid: (arrivalStatus === 'free' || arrivalStatus === 'freePromo' || arrivalStatus === 'admin') ? 0 : player.cashPaid,
        cardPaid: (arrivalStatus === 'free' || arrivalStatus === 'freePromo' || arrivalStatus === 'admin') ? 0 : player.cardPaid,
        place: arrivalStatus === 'absent' ? null : player.place,
        placeOverride: arrivalStatus === 'absent' ? false : player.placeOverride,
        bustoutOrder: arrivalStatus === 'absent' ? null : player.bustoutOrder,
        sortOrder: nextSortOrder,
        updatedAt: nowIso(),
      }, sessionId, tournamentBotId);
    }));
  }, [applyPlayerMutation, sessionId, tournamentBotId]);

  const markPlayerOut = useCallback(async (
    playerId: string,
    options?: { bounty?: number }
  ) => {
    await applyPlayerMutation(current => {
      const entrants = current.filter(player => player.arrivalStatus !== 'absent').length;
      const nextBustoutOrder = current.filter(player => player.status === 'out').length + 1;
      return current.map(player => {
        if (player.id !== playerId) return player;
        if (player.arrivalStatus === 'absent') return player;
        const bustoutOrder = player.bustoutOrder ?? nextBustoutOrder;

        return normalizePlayer({
          ...player,
          status: 'out',
          bounty: options?.bounty != null ? Math.max(0, Math.round(options.bounty)) : player.bounty,
          place: player.place ?? Math.max(1, entrants - bustoutOrder + 1),
          bustoutOrder,
          updatedAt: nowIso(),
        }, sessionId, tournamentBotId);
      });
    });
  }, [applyPlayerMutation, sessionId, tournamentBotId]);

  const markPlayersOutInOrder = useCallback(async (
    entries: Array<{ playerId: string; bounty: number; requestOrder: number; requireExistingOut?: boolean }>
  ) => {
    if (entries.length === 0) return;

    await applyPlayerMutation(current => {
      const entrants = current.filter(player => player.arrivalStatus !== 'absent').length;
      const entryByPlayerId = new Map(entries.map(entry => [entry.playerId, entry]));

      return current.map(player => {
        const entry = entryByPlayerId.get(player.id);
        if (!entry) return player;
        if (player.arrivalStatus === 'absent') return player;
        if (entry.requireExistingOut && player.status !== 'out') return player;

        return normalizePlayer({
          ...player,
          status: 'out',
          bounty: Math.max(0, Math.round(entry.bounty)),
          place: Math.max(1, entrants - Math.max(1, Math.round(entry.requestOrder)) + 1),
          placeOverride: true,
          bustoutOrder: Math.max(1, Math.round(entry.requestOrder)),
          updatedAt: nowIso(),
        }, sessionId, tournamentBotId);
      });
    });
  }, [applyPlayerMutation, sessionId, tournamentBotId]);

  const assignPlayerSeat = useCallback(async (
    playerId: string,
    tableNumber: number | null,
    seatNumber: number | null
  ) => {
    await applyPlayerMutation(current => current.map(player => {
      if (player.id !== playerId) return player;
      return { ...player, tableNumber, seatNumber, updatedAt: nowIso() };
    }));
  }, [applyPlayerMutation]);

  const restorePlayer = useCallback(async (playerId: string) => {
    await applyPlayerMutation(current => {
      const nextSortOrder = getNextPlayerSortOrder(current);
      return current.map(player => {
        if (player.id !== playerId) return player;

        return normalizePlayer({
          ...player,
          status: player.arrivalStatus === 'absent' ? deriveBaseStatus(player.registrationSource) : 'active',
          place: null,
          placeOverride: false,
          bustoutOrder: null,
          sortOrder: player.arrivalStatus === 'absent' ? player.sortOrder : nextSortOrder,
          updatedAt: nowIso(),
        }, sessionId, tournamentBotId);
      });
    });
  }, [applyPlayerMutation, sessionId, tournamentBotId]);

  const restorePlayersFromBackup = useCallback(async (backupId: string) => {
    if (!sharedEnabled) return false;

    const { data, error } = await supabase
      .from(SHARED_PLAYERS_TABLE)
      .select('id, name, levels, created_at')
      .eq('id', backupId)
      .maybeSingle();

    if (error || !data) return false;

    const row = data as SharedPlayersRow;
    const parsedSnapshot = parseStoredPlayersPayload(
      row.levels,
      sessionIdRef.current,
      tournamentBotIdRef.current,
      tournamentTitleRef.current
    );
    if (!parsedSnapshot) return false;

    await commitPlayersSnapshot(
      parsedSnapshot.players,
      parsedSnapshot.resultsSubmission,
      getNextSnapshotRevision(snapshotRevisionRef.current)
    );
    await loadSharedPlayersBackups();
    return true;
  }, [commitPlayersSnapshot, loadSharedPlayersBackups, sharedEnabled]);

  const prepareTournamentPlayersContext = useCallback(async (
    nextTournamentBotId: number | null,
    nextTournamentTitle: string
  ) => {
    const context = buildPlayersSnapshotContext(
      sessionIdRef.current,
      nextTournamentBotId,
      nextTournamentTitle
    );
    const updatedAt = nowIso();
    const emptyResultsSubmission = { sentAt: null, signature: null } satisfies TournamentResultsSubmissionState;
    const payload = buildStoredPlayersPayload(
      [],
      context.sessionId,
      context.tournamentBotId,
      context.tournamentTitle,
      updatedAt,
      emptyResultsSubmission,
      1
    );

    saveLocal(context.storageKey, payload);
    saveLocal(context.emergencyStorageKey, payload);

    if (!sharedEnabled) return true;

    const { error } = await supabase.from(SHARED_PLAYERS_TABLE).upsert({
      id: context.sharedStorageId,
      name: buildSharedPlayersName(updatedAt),
      levels: payload,
    });
    if (error) return false;

    await supabase
      .from(SHARED_PLAYERS_TABLE)
      .delete()
      .like('id', `${context.sharedBackupPrefix}:%`);

    return true;
  }, [sharedEnabled]);

  const getLatestTournamentArchiveDetails = useCallback(async (): Promise<TournamentArchiveDetails | null> => {
    const latestSnapshot = await syncLatestSharedPlayersSnapshot();
    const latestPlayers = latestSnapshot.players.length > 0 ? latestSnapshot.players : playersRef.current;
    if (latestPlayers.length === 0) return null;

    return {
      tournamentBotId: gameStateRef.current.tournamentBotId,
      tournamentTitle: gameStateRef.current.tournamentTitle,
      resultsSentAt: latestSnapshot.resultsSubmission.sentAt,
      resultsSignature: latestSnapshot.resultsSubmission.signature,
      players: latestPlayers.map(player => ({
        id: player.id,
        telegramId: player.telegramId,
        botRegistrationId: player.botRegistrationId,
        name: player.name,
        username: player.username,
        source: player.source,
        registrationSource: player.registrationSource,
        status: player.status,
        arrivalStatus: player.arrivalStatus,
        rebuyCount: player.rebuyCount,
        addonCount: player.addonCount,
        bonusCount: player.bonusCount,
        bounty: player.bounty,
        bonusRcPoints: player.bonusRcPoints,
        cashPaid: player.cashPaid,
        cardPaid: player.cardPaid,
        paymentDue: player.paymentDue,
        place: player.place,
        bustoutOrder: player.bustoutOrder,
        createdAt: player.createdAt,
        updatedAt: player.updatedAt,
      })),
      summary: summarizePlayers(latestPlayers),
      savedAt: nowIso(),
    };
  }, [syncLatestSharedPlayersSnapshot]);

  const exportTournamentResults = useCallback(async (levelsPlayed: number) => {
    if (playersRef.current.length === 0 || gameState.tournamentBotId == null) {
      return {
        ok: true as const,
        skipped: true as const,
        error: null,
        signature: null,
        sentAt: null,
        financeError: null,
        financeSkipped: true as const,
      };
    }

    const orderedPlayers = sortPlayersForResults(playersRef.current);
    const finishedAt = new Date().toISOString();
    const resultsPayload = buildTournamentResultsPayload({
      sessionId: sessionIdRef.current,
      tournamentBotId: gameState.tournamentBotId,
      tournamentTitle: gameState.tournamentTitle,
      finishedAt,
      levelsPlayed,
      totalStack: gameState.totalStack,
      players: orderedPlayers,
    });
    const financePayload = buildTournamentFinancePayload({
      sessionId: sessionIdRef.current,
      tournamentBotId: gameState.tournamentBotId,
      tournamentTitle: gameState.tournamentTitle,
      finishedAt,
      levelsPlayed,
      players: orderedPlayers,
    });
    const signature = buildTournamentResultsSignature(resultsPayload);

    const result = await submitBotTournamentResults(resultsPayload);
    if (result.ok) {
      const financeResult = await submitBotTournamentFinance(financePayload);
      const baseSnapshot = await syncLatestSharedPlayersSnapshot();
      await commitPlayersSnapshot(
        baseSnapshot.players,
        {
          sentAt: finishedAt,
          signature,
        },
        getNextSnapshotRevision(baseSnapshot.revision)
      );

      return {
        ok: true as const,
        skipped: false as const,
        error: null,
        signature,
        sentAt: finishedAt,
        financeError: financeResult.ok ? null : financeResult.error,
        financeSkipped: financeResult.skipped,
      };
    }

    return {
      ok: result.ok,
      skipped: false as const,
      error: result.ok ? null : result.error,
      signature,
      sentAt: result.ok ? finishedAt : null,
      financeError: null,
      financeSkipped: true as const,
    };
  }, [commitPlayersSnapshot, gameState.totalStack, gameState.tournamentBotId, gameState.tournamentTitle, syncLatestSharedPlayersSnapshot]);

  return {
    players,
    groupedPlayers,
    summary,
    playerSyncState,
    playerBackups,
    botSyncState,
    resultsSubmission,
    currentResultsSignature,
    managedCountersEnabled: players.length > 0,
    refreshFromBot,
    addManualPlayer,
    updatePlayerField,
    setPlayerArrival,
    markPlayerOut,
    markPlayersOutInOrder,
    restorePlayer,
    assignPlayerSeat,
    restorePlayersFromBackup,
    getLatestTournamentArchiveDetails,
    prepareTournamentPlayersContext,
    exportTournamentResults,
  };
}
