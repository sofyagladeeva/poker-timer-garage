import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  BOT_LIVE_SYNC_INTERVAL_MS,
  buildTournamentBotLiveSyncPayload,
  buildTournamentBotLiveSyncSignature,
  getTournamentBotLiveSyncUrl,
  pushTournamentBotLiveSync,
  type TournamentBotLiveSyncPayload,
} from '../tournamentBotLiveSync';
import type { BlindLevel, GameStatus } from '../types';

type UseTournamentBotLiveSyncOptions = {
  enabled: boolean;
  tournamentBotId: number | null;
  tournamentTitle: string;
  status: GameStatus;
  currentLevelIndex: number;
  currentTimeLeft: number;
  playersInGame: number;
  playersRegistered: number;
  playersOut: number;
  blindLevels: BlindLevel[];
  getAuthoritativeNow: () => number;
};

export function useTournamentBotLiveSync({
  enabled,
  tournamentBotId,
  tournamentTitle,
  status,
  currentLevelIndex,
  currentTimeLeft,
  playersInGame,
  playersRegistered,
  playersOut,
  blindLevels,
  getAuthoritativeNow,
}: UseTournamentBotLiveSyncOptions) {
  const syncUrl = useMemo(
    () => getTournamentBotLiveSyncUrl(tournamentBotId),
    [tournamentBotId]
  );
  const payload = useMemo(
    () => buildTournamentBotLiveSyncPayload({
      tournamentBotId,
      tournamentTitle,
      status,
      currentLevelIndex,
      currentTimeLeft,
      playersInGame,
      playersRegistered,
      playersOut,
      blindLevels,
      authoritativeNowMs: getAuthoritativeNow(),
    }),
    [
      blindLevels,
      currentLevelIndex,
      currentTimeLeft,
      getAuthoritativeNow,
      playersInGame,
      playersOut,
      playersRegistered,
      status,
      tournamentBotId,
      tournamentTitle,
    ]
  );
  const payloadSignature = useMemo(
    () => buildTournamentBotLiveSyncSignature(payload),
    [payload]
  );

  const latestPayloadRef = useRef<TournamentBotLiveSyncPayload | null>(payload);
  const latestUrlRef = useRef(syncUrl);
  const syncUnsupportedRef = useRef(false);

  useEffect(() => {
    latestPayloadRef.current = payload;
  }, [payload]);

  useEffect(() => {
    latestUrlRef.current = syncUrl;
    syncUnsupportedRef.current = false;
  }, [syncUrl]);

  const sendLiveSync = useCallback(async () => {
    if (!enabled || syncUnsupportedRef.current) return;

    const currentUrl = latestUrlRef.current;
    const currentPayload = latestPayloadRef.current;
    if (!currentUrl || !currentPayload) return;

    const result = await pushTournamentBotLiveSync(currentUrl, currentPayload);
    if (!result.ok && result.unsupported) {
      syncUnsupportedRef.current = true;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !payloadSignature) return;
    void sendLiveSync();
  }, [enabled, payloadSignature, sendLiveSync]);

  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      void sendLiveSync();
    }, BOT_LIVE_SYNC_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [enabled, sendLiveSync]);
}
