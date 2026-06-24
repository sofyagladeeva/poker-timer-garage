import type { FloorNotification, LiveTournamentPlayer } from './types';

export type TournamentResultsUiState = {
  resultsAlreadyCurrent: boolean;
  resultsNeedResubmit: boolean;
  canSubmitTournamentResults: boolean;
};

export type FloorBustoutConfirmationEntry = {
  playerId: string;
  bounty: number;
  requestOrder: number;
  requireExistingOut?: boolean;
};

export function getDuplicatePlaces(places: Array<number | null | undefined>) {
  const counts = new Map<number, number>();

  places.forEach(place => {
    if (typeof place !== 'number' || !Number.isFinite(place)) return;
    counts.set(place, (counts.get(place) ?? 0) + 1);
  });

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([place]) => place)
    .sort((a, b) => a - b);
}

export function deriveTournamentResultsUiState({
  hasBotResultsTarget,
  playersMissingFinalPlace,
  duplicatePlacesCount,
  resultsSubmissionSignature,
  currentResultsSignature,
}: {
  hasBotResultsTarget: boolean;
  playersMissingFinalPlace: number;
  duplicatePlacesCount: number;
  resultsSubmissionSignature: string | null;
  currentResultsSignature: string | null;
}): TournamentResultsUiState {
  const resultsAlreadyCurrent = Boolean(
    resultsSubmissionSignature &&
    currentResultsSignature &&
    resultsSubmissionSignature === currentResultsSignature
  );

  const resultsNeedResubmit = Boolean(
    resultsSubmissionSignature &&
    currentResultsSignature &&
    resultsSubmissionSignature !== currentResultsSignature
  );

  return {
    resultsAlreadyCurrent,
    resultsNeedResubmit,
    canSubmitTournamentResults:
      hasBotResultsTarget &&
      playersMissingFinalPlace === 0 &&
      duplicatePlacesCount === 0 &&
      !resultsAlreadyCurrent,
  };
}

export function getTournamentResultsButtonLabel({
  resultsBusy,
  resultsAlreadyCurrent,
  resultsNeedResubmit,
}: {
  resultsBusy: boolean;
  resultsAlreadyCurrent: boolean;
  resultsNeedResubmit: boolean;
}) {
  if (resultsBusy) return 'Отправка...';
  if (resultsAlreadyCurrent) return '✓ Уже отправлено';
  if (resultsNeedResubmit) return '📤 Отправить обновление';
  return '📤 Отправить в бот';
}

export function shouldBlockNewTournamentForPendingBotResults({
  requiresBotResults,
  resultsAlreadyCurrent,
}: {
  requiresBotResults: boolean;
  resultsAlreadyCurrent: boolean;
}) {
  return requiresBotResults && !resultsAlreadyCurrent;
}

export function buildFloorBustoutConfirmationEntries({
  notifications,
  players,
  confirmingNotificationId,
  bounty,
}: {
  notifications: FloorNotification[];
  players: LiveTournamentPlayer[];
  confirmingNotificationId: string;
  bounty: number;
}): FloorBustoutConfirmationEntry[] {
  const confirmingNotification = notifications.find(notification => notification.id === confirmingNotificationId);
  if (confirmingNotification?.type !== 'bustout' || !confirmingNotification.playerId) return [];

  const confirmedNotificationByPlayerId = new Map(
    notifications
      .filter(notification => (
        notification.type === 'bustout' &&
        notification.status === 'confirmed' &&
        Boolean(notification.playerId)
      ))
      .map(notification => [notification.playerId!, notification])
  );

  const orderedExistingOut = players
    .filter(player => (
      player.status === 'out' &&
      player.arrivalStatus !== 'absent' &&
      player.id !== confirmingNotification.playerId
    ))
    .sort((a, b) => (
      (a.bustoutOrder ?? Number.MAX_SAFE_INTEGER) - (b.bustoutOrder ?? Number.MAX_SAFE_INTEGER) ||
      a.updatedAt.localeCompare(b.updatedAt) ||
      a.id.localeCompare(b.id)
    ));

  const confirmingCreatedAt = confirmingNotification.createdAt;
  let insertionIndex = orderedExistingOut.length;

  for (let index = 0; index < orderedExistingOut.length; index += 1) {
    const player = orderedExistingOut[index];
    const relatedNotification = confirmedNotificationByPlayerId.get(player.id);
    const existingEventAt = relatedNotification?.createdAt ?? player.updatedAt;
    if (existingEventAt > confirmingCreatedAt) {
      insertionIndex = index;
      break;
    }
  }

  const entries: FloorBustoutConfirmationEntry[] = [{
    playerId: confirmingNotification.playerId,
    bounty,
    requestOrder: insertionIndex + 1,
  }];

  orderedExistingOut.slice(insertionIndex).forEach((player, index) => {
    entries.push({
      playerId: player.id,
      bounty: player.bounty,
      requestOrder: insertionIndex + index + 2,
      requireExistingOut: true,
    });
  });

  return entries;
}
