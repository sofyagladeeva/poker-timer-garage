import { getKnockoutLabel, getNextKnockoutInfo } from './blindLevelMarkers.ts';
import type { BlindLevel, GameStatus } from './types';

const ENV = (import.meta as ImportMeta & {
  env?: {
    VITE_BOT_API_URL?: string;
    VITE_BOT_TOURNAMENT_LIVE_SYNC_URL_TEMPLATE?: string;
  };
}).env;
const BOT_API = ENV?.VITE_BOT_API_URL || 'https://garage-game-club-bot-production.up.railway.app';
const LIVE_SYNC_URL_TEMPLATE = ENV?.VITE_BOT_TOURNAMENT_LIVE_SYNC_URL_TEMPLATE || `${BOT_API}/api/games/{id}/live-state`;

export const BOT_LIVE_SYNC_INTERVAL_MS = 15_000;

export interface TournamentBotLiveSyncPayload {
  version: 1;
  source: 'poker-timer-garage';
  tournamentBotId: number;
  tournamentTitle: string;
  status: GameStatus;
  currentLevelIndex: number;
  currentLevelNumber: number | null;
  playersInGame: number;
  playersRegistered: number;
  playersOut: number;
  sentAt: string;
  knockout: {
    label: string;
    levelIndex: number;
    levelNumber: number;
    startsNow: boolean;
    secondsUntil: number;
    startsAt: string;
  } | null;
}

type BuildTournamentBotLiveSyncPayloadInput = {
  tournamentBotId: number | null;
  tournamentTitle: string;
  status: GameStatus;
  currentLevelIndex: number;
  currentTimeLeft: number;
  playersInGame: number;
  playersRegistered: number;
  playersOut: number;
  blindLevels: BlindLevel[];
  authoritativeNowMs: number;
};

function fillUrlTemplate(template: string, tournamentBotId: number | null) {
  if (!template.trim()) return null;
  if (!template.includes('{id}')) return template;
  if (tournamentBotId == null) return null;
  return template.replaceAll('{id}', String(tournamentBotId));
}

function clampWhole(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function roundToSecond(ms: number) {
  return clampWhole(ms / 1000) * 1000;
}

export function getTournamentBotLiveSyncUrl(tournamentBotId: number | null) {
  return fillUrlTemplate(LIVE_SYNC_URL_TEMPLATE, tournamentBotId);
}

export function buildTournamentBotLiveSyncPayload({
  tournamentBotId,
  tournamentTitle,
  status,
  currentLevelIndex,
  currentTimeLeft,
  playersInGame,
  playersRegistered,
  playersOut,
  blindLevels,
  authoritativeNowMs,
}: BuildTournamentBotLiveSyncPayloadInput): TournamentBotLiveSyncPayload | null {
  if (tournamentBotId == null) return null;

  const currentLevel = blindLevels[currentLevelIndex] ?? null;
  const nextKnockout = getNextKnockoutInfo(blindLevels, currentLevelIndex, currentTimeLeft);
  const roundedAuthoritativeNowMs = roundToSecond(authoritativeNowMs);

  return {
    version: 1,
    source: 'poker-timer-garage',
    tournamentBotId,
    tournamentTitle: tournamentTitle.trim(),
    status,
    currentLevelIndex,
    currentLevelNumber: currentLevel && !currentLevel.isBreak ? currentLevel.level : null,
    playersInGame: clampWhole(playersInGame),
    playersRegistered: clampWhole(playersRegistered),
    playersOut: clampWhole(playersOut),
    sentAt: new Date(roundedAuthoritativeNowMs).toISOString(),
    knockout: nextKnockout
      ? {
          label: getKnockoutLabel(nextKnockout.level) || 'Игра на вылет',
          levelIndex: nextKnockout.index,
          levelNumber: nextKnockout.level.level,
          startsNow: nextKnockout.startsNow,
          secondsUntil: clampWhole(nextKnockout.secondsUntil),
          startsAt: new Date(roundToSecond(authoritativeNowMs + nextKnockout.secondsUntil * 1000)).toISOString(),
        }
      : null,
  };
}

export function buildTournamentBotLiveSyncSignature(payload: TournamentBotLiveSyncPayload | null) {
  if (!payload) return '';

  return JSON.stringify({
    tournamentBotId: payload.tournamentBotId,
    tournamentTitle: payload.tournamentTitle,
    status: payload.status,
    currentLevelIndex: payload.currentLevelIndex,
    currentLevelNumber: payload.currentLevelNumber,
    playersInGame: payload.playersInGame,
    playersRegistered: payload.playersRegistered,
    playersOut: payload.playersOut,
    knockout: payload.knockout,
  });
}

export async function pushTournamentBotLiveSync(url: string, payload: TournamentBotLiveSyncPayload) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return {
        ok: false as const,
        unsupported: response.status === 404 || response.status === 405,
        status: response.status,
      };
    }

    return {
      ok: true as const,
    };
  } catch {
    return {
      ok: false as const,
      unsupported: false,
      status: null,
    };
  }
}
