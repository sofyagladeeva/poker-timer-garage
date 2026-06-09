export type TournamentResultsUiState = {
  resultsAlreadyCurrent: boolean;
  resultsNeedResubmit: boolean;
  canSubmitTournamentResults: boolean;
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
