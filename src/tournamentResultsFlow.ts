export type TournamentResultsUiState = {
  resultsAlreadyCurrent: boolean;
  resultsNeedResubmit: boolean;
  canSubmitTournamentResults: boolean;
};

export function deriveTournamentResultsUiState({
  hasBotResultsTarget,
  playersMissingFinalPlace,
  resultsSubmissionSignature,
  currentResultsSignature,
}: {
  hasBotResultsTarget: boolean;
  playersMissingFinalPlace: number;
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
    canSubmitTournamentResults: hasBotResultsTarget && playersMissingFinalPlace === 0 && !resultsAlreadyCurrent,
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
