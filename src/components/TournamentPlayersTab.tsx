import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  LiveTournamentArrivalStatus,
  LiveTournamentPlayer,
} from '../types';
import { findPlayerWithPlaceConflict } from '../hooks/useTournamentPlayers';

type Props = {
  groupedPlayers: {
    active: LiveTournamentPlayer[];
    pending: LiveTournamentPlayer[];
    waitlist: LiveTournamentPlayer[];
    out: LiveTournamentPlayer[];
  };
  playerSyncState: {
    loading: boolean;
    error: string | null;
    lastSyncedAt: string | null;
    shared: boolean;
  };
  playerBackups: {
    id: string;
    updatedAt: string | null;
    revision: number | null;
    playerCount: number;
    entrants: number;
    bustouts: number;
  }[];
  botSyncState: {
    loading: boolean;
    error: string | null;
    lastSyncedAt: string | null;
    disabled: boolean;
  };
  tournamentBotId: number | null;
  isTournamentEnded: boolean;
  preferMobileCards?: boolean;
  reviewPlayers: LiveTournamentPlayer[];
  onOpenControlTab: () => void;
  onRefreshFromBot: (force?: boolean) => Promise<boolean>;
  onAddManualPlayer: (name: string) => Promise<boolean>;
  onUpdatePlayerField: (playerId: string, patch: Partial<LiveTournamentPlayer>) => Promise<boolean>;
  onSetPlayerArrival: (playerId: string, arrivalStatus: LiveTournamentArrivalStatus) => Promise<void>;
  onMarkPlayerOut: (playerId: string, options?: { bounty?: number }) => Promise<void>;
  onRestorePlayer: (playerId: string) => Promise<void>;
  onRestorePlayersFromBackup: (backupId: string) => Promise<boolean>;
};

export function TournamentPlayersTab({
  groupedPlayers,
  playerSyncState,
  playerBackups,
  botSyncState,
  tournamentBotId,
  isTournamentEnded,
  preferMobileCards = false,
  reviewPlayers,
  onOpenControlTab,
  onRefreshFromBot,
  onAddManualPlayer,
  onUpdatePlayerField,
  onSetPlayerArrival,
  onMarkPlayerOut,
  onRestorePlayer,
  onRestorePlayersFromBackup,
}: Props) {
  const [manualPlayerName, setManualPlayerName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewFilter, setViewFilter] = useState<'all' | 'active' | 'pending' | 'waitlist' | 'out' | 'unpaid'>('all');
  const [placeConflictNotice, setPlaceConflictNotice] = useState<string | null>(null);
  const [backupRestoreBusyId, setBackupRestoreBusyId] = useState<string | null>(null);
  const [backupRestoreNotice, setBackupRestoreNotice] = useState<string | null>(null);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [outDialogPlayerId, setOutDialogPlayerId] = useState<string | null>(null);
  const [outDialogBountyDraft, setOutDialogBountyDraft] = useState('0');
  const [outDialogBusy, setOutDialogBusy] = useState(false);
  const totalPlayers = groupedPlayers.active.length + groupedPlayers.pending.length + groupedPlayers.waitlist.length + groupedPlayers.out.length;
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const rosterPlayers = [
    ...groupedPlayers.active,
    ...groupedPlayers.pending,
    ...groupedPlayers.waitlist,
    ...groupedPlayers.out,
  ];
  const outDialogPlayer = outDialogPlayerId
    ? rosterPlayers.find(player => player.id === outDialogPlayerId) ?? null
    : null;

  const matchesSearch = (player: LiveTournamentPlayer) => {
    if (!normalizedQuery) return true;
    return player.name.toLowerCase().includes(normalizedQuery);
  };

  const matchesViewFilter = (player: LiveTournamentPlayer) => {
    switch (viewFilter) {
      case 'active':
        return player.status === 'active';
      case 'pending':
        return player.arrivalStatus === 'absent' && player.status !== 'out';
      case 'waitlist':
        return player.registrationSource === 'waitlist';
      case 'out':
        return player.status === 'out';
      case 'unpaid':
        return player.paymentMethod === 'unpaid';
      default:
        return true;
    }
  };

  const filterPlayers = (players: LiveTournamentPlayer[]) => players.filter(player => matchesSearch(player) && matchesViewFilter(player));
  const filteredCounts = {
    active: groupedPlayers.active.filter(matchesSearch).length,
    pending: groupedPlayers.pending.filter(matchesSearch).length,
    waitlist: groupedPlayers.waitlist.filter(matchesSearch).length,
    out: groupedPlayers.out.filter(matchesSearch).length,
  };
  const playersWithoutFinalPlace = reviewPlayers.filter(player => (
    player.arrivalStatus !== 'absent' && player.status !== 'out'
  )).length;

  const handleAddManualPlayer = async () => {
    const ok = await onAddManualPlayer(manualPlayerName);
    if (ok) setManualPlayerName('');
  };

  const handleRestoreBackup = async (backupId: string) => {
    if (!confirm('Восстановить список игроков из этой резервной копии? Текущее состояние игроков будет заменено выбранным снимком.')) {
      return;
    }

    setBackupRestoreBusyId(backupId);
    setBackupRestoreNotice(null);
    try {
      const ok = await onRestorePlayersFromBackup(backupId);
      setBackupRestoreNotice(ok
        ? 'Резервная копия восстановлена. Проверьте список игроков и продолжайте вести турнир.'
        : 'Не удалось восстановить резервную копию. Попробуйте ещё раз.'
      );
    } finally {
      setBackupRestoreBusyId(null);
    }
  };

  const openOutDialog = (player: LiveTournamentPlayer) => {
    setPlaceConflictNotice(null);
    setOutDialogPlayerId(player.id);
    setOutDialogBountyDraft(String(player.bounty || 0));
  };

  const closeOutDialog = () => {
    if (outDialogBusy) return;
    setOutDialogPlayerId(null);
    setOutDialogBountyDraft('0');
  };

  const handleConfirmOut = async () => {
    if (!outDialogPlayer) return;

    const bounty = Math.max(0, Number(outDialogBountyDraft) || 0);
    setOutDialogBusy(true);
    try {
      await onMarkPlayerOut(outDialogPlayer.id, { bounty });
      setOutDialogPlayerId(null);
      setOutDialogBountyDraft('0');
    } finally {
      setOutDialogBusy(false);
    }
  };

  const allPlayers = viewFilter === 'active'
    ? filterPlayers(groupedPlayers.active)
    : viewFilter === 'pending'
      ? filterPlayers(groupedPlayers.pending)
      : viewFilter === 'waitlist'
        ? filterPlayers(groupedPlayers.waitlist)
        : viewFilter === 'out'
      ? filterPlayers(groupedPlayers.out)
      : [
          ...filterPlayers(groupedPlayers.active),
          ...filterPlayers(groupedPlayers.pending),
          ...filterPlayers(groupedPlayers.waitlist),
          ...filterPlayers(groupedPlayers.out),
        ];
  const projectedOutPlace = outDialogPlayer
    ? getProjectedOutPlace(rosterPlayers, outDialogPlayer)
    : null;

  return (
    <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4 flex flex-col gap-4">
      {isTournamentEnded && (
        <div className="rounded-2xl border border-[#5A3920] bg-[#1A130D] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-white font-black text-sm uppercase tracking-[0.18em]">Проверка итогов</div>
              <div className="text-[#C9B39A] text-sm mt-1">
                Турнир остановлен без автоотправки. Проверьте результаты ниже, при необходимости поправьте статусы, места, bounty и счётчики, затем отправьте итоги в бота из вкладки `Управление`.
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenControlTab}
              className="admin-btn-secondary px-4 py-2 text-sm whitespace-nowrap"
            >
              ← К отправке
            </button>
          </div>

          {playersWithoutFinalPlace > 0 && (
            <div className="mt-3 rounded-xl border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
              Без итогового места: {playersWithoutFinalPlace}. Перед отправкой переведите их в `Выбыл`, чтобы система зафиксировала финиш.
            </div>
          )}

          <div className="mt-4 rounded-2xl border border-[#2D2D2D] bg-[#0A0A0A] p-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[#777]">Результаты на текущий момент</div>

            {reviewPlayers.length === 0 ? (
              <div className="mt-3 rounded-xl border border-[#1D1D1D] bg-[#111] px-4 py-4 text-sm text-[#666]">
                Список результатов пока пуст.
              </div>
            ) : (
              <div className="mt-3 flex max-h-[280px] flex-col gap-2 overflow-y-auto">
                {reviewPlayers.map(player => {
                  const meta = [
                    player.status === 'out'
                      ? 'Выбыл'
                      : player.arrivalStatus === 'absent'
                        ? 'Не в игре'
                        : 'Без места',
                    player.rebuyCount > 0 ? `R ${player.rebuyCount}` : null,
                    player.addonCount > 0 ? `A ${player.addonCount}` : null,
                    player.bounty > 0 ? `Bounty ${player.bounty}` : null,
                  ].filter(Boolean).join(' · ');
                  const hasFinalPlace = player.place !== null;

                  return (
                    <div
                      key={player.id}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
                        hasFinalPlace
                          ? 'border-[#2D2D2D] bg-[#111]'
                          : 'border-amber-900/50 bg-amber-950/20'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-white">{player.name}</div>
                        <div className={`mt-1 text-xs ${hasFinalPlace ? 'text-[#777]' : 'text-amber-200'}`}>
                          {meta}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={`text-lg font-black ${hasFinalPlace ? 'text-white' : 'text-amber-200'}`}>
                          {hasFinalPlace ? `#${player.place}` : '—'}
                        </div>
                        <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Место</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <input
            type="text"
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder="Поиск по никнейму"
            className="admin-input"
          />

          <div className="flex flex-wrap gap-2">
            <FilterButton active={viewFilter === 'all'} onClick={() => setViewFilter('all')}>
              Все <span className="text-[10px] opacity-70">{totalPlayers}</span>
            </FilterButton>
            <FilterButton active={viewFilter === 'active'} onClick={() => setViewFilter('active')}>
              В игре <span className="text-[10px] opacity-70">{filteredCounts.active}</span>
            </FilterButton>
            <FilterButton active={viewFilter === 'pending'} onClick={() => setViewFilter('pending')}>
              Не в игре <span className="text-[10px] opacity-70">{filteredCounts.pending}</span>
            </FilterButton>
            <FilterButton active={viewFilter === 'waitlist'} onClick={() => setViewFilter('waitlist')}>
              Waitlist <span className="text-[10px] opacity-70">{filteredCounts.waitlist}</span>
            </FilterButton>
            <FilterButton active={viewFilter === 'out'} onClick={() => setViewFilter('out')}>
              Выбыли <span className="text-[10px] opacity-70">{filteredCounts.out}</span>
            </FilterButton>
            <FilterButton active={viewFilter === 'unpaid'} onClick={() => setViewFilter('unpaid')}>
              Не оплачено
            </FilterButton>
          </div>
        </div>

        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="text-[#666] text-xs">
            Показано: {allPlayers.length} из {totalPlayers}. Список обновляется в фоне.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={manualPlayerName}
              onChange={event => setManualPlayerName(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && manualPlayerName.trim()) {
                  void handleAddManualPlayer();
                }
              }}
              placeholder="Никнейм"
              className="admin-input !w-40 !py-2 !text-xs"
            />
            <button
              type="button"
              onClick={() => void handleAddManualPlayer()}
              disabled={!manualPlayerName.trim()}
              className="admin-btn-primary px-3 py-2 text-xs"
            >
              + Добавить
            </button>
            <button
              type="button"
              onClick={() => void onRefreshFromBot(true)}
              disabled={tournamentBotId == null || botSyncState.loading}
              className="admin-btn-secondary px-3 py-2 text-xs"
            >
              ↻ Синхронизировать
            </button>
          </div>
        </div>

        {playerSyncState.error && (
          <div className="rounded-xl border border-red-900/70 bg-red-950/40 px-3 py-2 text-red-300 text-sm">
            {playerSyncState.error}
          </div>
        )}

        {botSyncState.error && (
          <div className="rounded-xl border border-amber-900/70 bg-amber-950/30 px-3 py-2 text-amber-200 text-sm">
            {botSyncState.error}
          </div>
        )}

        {placeConflictNotice && (
          <div className="rounded-xl border border-red-900/70 bg-red-950/40 px-3 py-2 text-red-300 text-sm">
            {placeConflictNotice}
          </div>
        )}

        {(playerSyncState.shared || playerBackups.length > 0) && (
          <div className="rounded-xl border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-3">
            <button
              type="button"
              onClick={() => setBackupsOpen(current => !current)}
              className="flex w-full items-start justify-between gap-3 text-left"
            >
              <div>
                <div className="text-white text-sm font-bold">Резервные копии игроков</div>
                <div className="text-[#777] text-xs mt-1">
                  Сохраняются в облако. Откройте только если нужно восстановить слетевший список.
                </div>
                {playerBackups[0]?.updatedAt && (
                  <div className="text-[10px] uppercase tracking-[0.14em] text-[#666] mt-2">
                    Последняя: {new Date(playerBackups[0].updatedAt).toLocaleString('ru-RU', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                    {playerBackups.length > 0 ? ` · ${playerBackups.length} шт.` : ''}
                  </div>
                )}
              </div>
              <div className="shrink-0 rounded-full border border-[#2D2D2D] bg-[#111] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[#AAA]">
                {backupsOpen ? 'Скрыть ▲' : 'Открыть ▼'}
              </div>
            </button>

            {backupsOpen && (
              <>
                {backupRestoreNotice && (
                  <div className="mt-3 rounded-lg border border-[#2D2D2D] bg-[#111] px-3 py-2 text-sm text-[#DDD]">
                    {backupRestoreNotice}
                  </div>
                )}

                {playerBackups.length === 0 ? (
                  <div className="mt-3 text-xs text-[#666]">
                    Резервные копии ещё не появились. После первых сохранений игроков они будут доступны здесь.
                  </div>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    {playerBackups.map(backup => (
                      <div key={backup.id} className="flex flex-col gap-2 rounded-lg border border-[#2D2D2D] bg-[#111] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="text-white text-sm font-bold">
                            {backup.updatedAt
                              ? new Date(backup.updatedAt).toLocaleString('ru-RU', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                })
                              : 'Без времени'}
                          </div>
                          <div className="text-[#777] text-xs mt-1">
                            Игроков: {backup.playerCount} · Входов: {backup.entrants} · Выбыли: {backup.bustouts}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleRestoreBackup(backup.id)}
                          disabled={backupRestoreBusyId !== null}
                          className="admin-btn-secondary px-3 py-2 text-xs whitespace-nowrap"
                        >
                          {backupRestoreBusyId === backup.id ? 'Восстановление...' : 'Восстановить'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="text-[11px] text-[#666] flex flex-wrap gap-x-3 gap-y-1">
          <span>
            {tournamentBotId == null
              ? 'Для авто-импорта нужно выбрать игру из бота.'
              : 'Список из приложения подтягивается автоматически. Кнопка справа запускает ручную синхронизацию.'}
          </span>
        </div>
      </div>

      <div className="border-t border-[#2D2D2D] pt-4">
        <div className="text-white font-bold text-sm mb-3">Игроки</div>

        {allPlayers.length === 0 ? (
          <div className="rounded-xl bg-[#0A0A0A] border border-[#1D1D1D] px-4 py-5 text-[#555] text-sm">
            По текущему фильтру игроков нет.
          </div>
        ) : (
          <div className={preferMobileCards ? '' : 'overflow-x-hidden sm:max-h-[72vh] sm:overflow-y-auto'}>
            {preferMobileCards ? (
              <div className="flex flex-col gap-3">
                {allPlayers.map(player => (
                  <MobilePlayerCard
                    key={player.id}
                    player={player}
                    rosterPlayers={rosterPlayers}
                    onPlaceConflict={setPlaceConflictNotice}
                    onUpdatePlayerField={onUpdatePlayerField}
                    onSetPlayerArrival={onSetPlayerArrival}
                    onOpenOutDialog={openOutDialog}
                    onRestorePlayer={onRestorePlayer}
                  />
                ))}
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3 sm:hidden">
                  {allPlayers.map(player => (
                    <MobilePlayerCard
                      key={player.id}
                      player={player}
                      rosterPlayers={rosterPlayers}
                      onPlaceConflict={setPlaceConflictNotice}
                      onUpdatePlayerField={onUpdatePlayerField}
                      onSetPlayerArrival={onSetPlayerArrival}
                      onOpenOutDialog={openOutDialog}
                      onRestorePlayer={onRestorePlayer}
                    />
                  ))}
                </div>

                <div className="hidden sm:block">
                  <table className="w-full table-fixed border-separate border-spacing-y-1">
                    <thead>
                      <tr className="text-[8px] sm:text-[11px] uppercase tracking-[0.12em] sm:tracking-[0.18em] text-[#666]">
                        <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[28%]">Игрок</th>
                        <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[10%]">Rebuy</th>
                        <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[10%]">Addon</th>
                        <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[10%]">Бонус</th>
                        <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[14%]">В игре</th>
                        <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[12%]">Место</th>
                        <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[16%]">Вход / оплата</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allPlayers.map(player => (
                        <PlayerRow
                          key={player.id}
                          player={player}
                          rosterPlayers={rosterPlayers}
                          onPlaceConflict={setPlaceConflictNotice}
                          onUpdatePlayerField={onUpdatePlayerField}
                          onSetPlayerArrival={onSetPlayerArrival}
                          onOpenOutDialog={openOutDialog}
                          onRestorePlayer={onRestorePlayer}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {outDialogPlayer && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/75 p-3 sm:items-center sm:p-6">
          <div className="w-full max-w-md rounded-3xl border border-[#2D2D2D] bg-[#111] shadow-2xl">
            <div className="border-b border-[#2D2D2D] px-5 py-4">
              <div className="text-white font-black text-lg">
                {outDialogPlayer.status === 'out' ? 'Правка выбытия' : 'Подтвердить выбытие'}
              </div>
              <div className="mt-1 text-sm text-[#777] break-words">{outDialogPlayer.name}</div>
            </div>

            <div className="px-5 py-4 flex flex-col gap-4">
              <div className="rounded-2xl border border-[#2D2D2D] bg-[#0A0A0A] px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-[#666]">Место игрока</div>
                <div className="mt-2 text-3xl font-black text-white">
                  {projectedOutPlace ? `#${projectedOutPlace}` : '—'}
                </div>
              </div>

              <label className="block">
                <div className="text-[11px] uppercase tracking-[0.16em] text-[#666] mb-2">Bounty игрока</div>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={outDialogBountyDraft}
                  onChange={event => setOutDialogBountyDraft(event.target.value)}
                  className="admin-input !py-3 !px-4 !text-base text-center"
                  placeholder="0"
                />
              </label>

              <div className="text-xs text-[#666]">
                {outDialogPlayer.status === 'out'
                  ? 'Если bounty нет, оставьте `0`. После сохранения обновятся данные по уже выбывшему игроку.'
                  : 'Если bounty нет, оставьте `0`. После подтверждения игрок получит это место и перейдёт в список выбывших.'}
              </div>
            </div>

            <div className="border-t border-[#2D2D2D] px-5 py-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeOutDialog}
                disabled={outDialogBusy}
                className="admin-btn-secondary px-4 py-3 text-sm"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmOut()}
                disabled={outDialogBusy}
                className="admin-btn-danger px-4 py-3 text-sm"
              >
                {outDialogBusy
                  ? 'Сохранение...'
                  : outDialogPlayer.status === 'out'
                    ? 'Сохранить выбытие'
                    : 'Подтвердить выбытие'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getProjectedOutPlace(players: LiveTournamentPlayer[], player: LiveTournamentPlayer) {
  if (player.arrivalStatus === 'absent') return null;
  if (player.status === 'out') return player.place;

  const entrants = players.filter(item => item.arrivalStatus !== 'absent').length;
  const maxOutOrder = players.reduce((max, item) => Math.max(max, item.bustoutOrder ?? 0), 0);
  return Math.max(1, entrants - (maxOutOrder + 1) + 1);
}

function MobilePlayerCard({
  player,
  rosterPlayers,
  onPlaceConflict,
  onUpdatePlayerField,
  onSetPlayerArrival,
  onOpenOutDialog,
  onRestorePlayer,
}: {
  player: LiveTournamentPlayer;
  rosterPlayers: LiveTournamentPlayer[];
  onPlaceConflict: (message: string | null) => void;
  onUpdatePlayerField: (playerId: string, patch: Partial<LiveTournamentPlayer>) => Promise<boolean>;
  onSetPlayerArrival: (playerId: string, arrivalStatus: LiveTournamentArrivalStatus) => Promise<void>;
  onOpenOutDialog: (player: LiveTournamentPlayer) => void;
  onRestorePlayer: (playerId: string) => Promise<void>;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const canEditCounters = player.arrivalStatus !== 'absent';
  const isOut = player.status === 'out';
  const paymentDueLabel = player.paymentDue > 0 ? `${player.paymentDue} ₽` : '0 ₽';
  const nameBadgeLabel = isOut ? 'Выбыл' : player.arrivalStatus === 'absent' ? 'Не в игре' : 'В игре';
  const nameBadgeTone = isOut
    ? 'border-[#C0392B] bg-[#2A0C0A] text-white'
    : player.arrivalStatus === 'absent'
      ? 'border-[#4A4A4A] bg-[#161616] text-[#C2C2C2]'
      : 'border-blue-700/70 bg-blue-950/40 text-blue-200';
  const entryTypeValue = player.arrivalStatus === 'promo'
    ? 'promo'
    : player.arrivalStatus === 'free'
      ? 'free'
      : 'paid';

  const handlePaymentChange = async (nextValue: string) => {
    if (nextValue === 'unpaid' || nextValue === 'cash' || nextValue === 'card') {
      await onUpdatePlayerField(player.id, { paymentMethod: nextValue });
    }
  };

  const handleActiveClick = async () => {
    if (isOut) {
      await onRestorePlayer(player.id);
      return;
    }

    if (player.arrivalStatus === 'absent') {
      await onSetPlayerArrival(player.id, 'paid');
    }
  };

  const handleAbsentClick = async () => {
    await onSetPlayerArrival(player.id, 'absent');
  };

  const handlePlaceCommit = async (value: number | null, override: boolean) => {
    if (value !== null) {
      const conflictPlayer = findPlayerWithPlaceConflict(rosterPlayers, player.id, value);
      if (conflictPlayer) {
        onPlaceConflict(`Место #${value} уже занято игроком ${conflictPlayer.name}. Освободите его или выберите другое место.`);
        return false;
      }
    }

    onPlaceConflict(null);
    const updated = await onUpdatePlayerField(player.id, { place: value, placeOverride: override });
    if (!updated && value !== null) {
      onPlaceConflict(`Место #${value} уже занято другим игроком. Выберите другое место.`);
    }
    return updated;
  };

  return (
    <div className="rounded-2xl border border-[#2D2D2D] bg-[#0A0A0A] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-white font-black text-base leading-tight break-words">{player.name}</div>
          <div className={`mt-1 inline-flex items-center rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${nameBadgeTone}`}>
            {nameBadgeLabel}
          </div>
        </div>

        <div className="shrink-0 rounded-xl border border-[#2D2D2D] bg-[#141414] px-3 py-2 text-center min-w-[64px]">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Место</div>
          {isOut ? (
            <>
              <PlaceInput
                value={player.place}
                disabled={false}
                className="admin-input mt-2 !w-full !py-1.5 !px-2 !text-center !text-base font-black"
                onCommit={handlePlaceCommit}
              />
              <button
                type="button"
                onClick={() => onOpenOutDialog(player)}
                className="mt-2 inline-flex w-full items-center justify-center rounded-lg border border-[#2D2D2D] bg-[#1A1A1A] px-2 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#DDD]"
              >
                Править
              </button>
            </>
          ) : (
            <div className="mt-1 text-lg font-black text-[#777]">—</div>
          )}
          {!isOut && (
            <button
              type="button"
              onClick={() => onOpenOutDialog(player)}
              className="mt-2 inline-flex w-full items-center justify-center rounded-lg bg-[#5A1712] px-2 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#FFD5D0]"
            >
              Выбыл
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void handleAbsentClick()}
          disabled={isOut}
          className={`rounded-xl border px-3 py-3 text-sm font-bold transition-colors ${
            player.arrivalStatus === 'absent' && !isOut
              ? 'border-[#4A4A4A] bg-[#1A1A1A] text-white'
              : 'border-[#2D2D2D] bg-[#141414] text-[#888]'
          } disabled:opacity-40`}
        >
          Не в игре
        </button>
        <button
          type="button"
          onClick={() => void handleActiveClick()}
          className={`rounded-xl border px-3 py-3 text-sm font-bold transition-colors ${
            player.arrivalStatus !== 'absent' && !isOut
              ? 'border-blue-700/70 bg-blue-950/40 text-blue-200'
              : isOut
                ? 'border-emerald-800/70 bg-emerald-950/30 text-emerald-200'
                : 'border-[#2D2D2D] bg-[#141414] text-[#888]'
          }`}
        >
          {isOut ? 'Вернуть в игру' : 'В игре'}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <MobileCounter
          label="Rebuy"
          value={player.rebuyCount}
          disabled={!canEditCounters}
          onDecrease={() => void onUpdatePlayerField(player.id, { rebuyCount: Math.max(0, player.rebuyCount - 1) })}
          onIncrease={() => void onUpdatePlayerField(player.id, { rebuyCount: player.rebuyCount + 1 })}
        />
        <MobileCounter
          label="Addon"
          value={player.addonCount}
          disabled={!canEditCounters}
          onDecrease={() => void onUpdatePlayerField(player.id, { addonCount: Math.max(0, player.addonCount - 1) })}
          onIncrease={() => void onUpdatePlayerField(player.id, { addonCount: player.addonCount + 1 })}
        />
        <MobileCounter
          label="Бонус"
          value={player.bonusCount}
          disabled={!canEditCounters}
          onDecrease={() => void onUpdatePlayerField(player.id, { bonusCount: Math.max(0, player.bonusCount - 1) })}
          onIncrease={() => void onUpdatePlayerField(player.id, { bonusCount: player.bonusCount + 1 })}
        />
      </div>

      <button
        type="button"
        onClick={() => setDetailsOpen(current => !current)}
        className="mt-3 inline-flex w-full items-center justify-between rounded-xl border border-[#2D2D2D] bg-[#141414] px-3 py-2 text-left transition-colors hover:border-[#555]"
      >
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Детали</div>
          <div className="text-sm font-bold text-white">Тип входа и оплата</div>
        </div>
        <div className="text-xs font-bold uppercase tracking-[0.12em] text-[#888]">
          {detailsOpen ? 'Скрыть' : 'Открыть'}
        </div>
      </button>

      {detailsOpen && (
        <>
          <div className="mt-3 grid gap-2">
            <MobileSelect
              label="Тип входа"
              value={entryTypeValue}
              disabled={player.arrivalStatus === 'absent' && !isOut}
              onChange={value => {
                if (value === 'paid' || value === 'free' || value === 'promo') {
                  void onSetPlayerArrival(player.id, value);
                }
              }}
              options={[
                { value: 'paid', label: 'Платно' },
                { value: 'free', label: 'Бесплатно' },
                { value: 'promo', label: 'Промокод' },
              ]}
            />
            <MobileSelect
              label="Оплата"
              value={player.paymentMethod}
              onChange={value => { void handlePaymentChange(value); }}
              options={[
                { value: 'unpaid', label: 'Не оплачено' },
                { value: 'cash', label: 'Наличные' },
                { value: 'card', label: 'Карта' },
              ]}
            />
          </div>

          <div className="mt-3 rounded-xl border border-[#2D2D2D] bg-[#141414] px-3 py-2 text-right">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">К оплате</div>
            <div className="mt-2 text-base font-black text-white whitespace-nowrap">{paymentDueLabel}</div>
          </div>
        </>
      )}
    </div>
  );
}

function PlayerRow({
  player,
  rosterPlayers,
  onPlaceConflict,
  onUpdatePlayerField,
  onSetPlayerArrival,
  onOpenOutDialog,
  onRestorePlayer,
}: {
  player: LiveTournamentPlayer;
  rosterPlayers: LiveTournamentPlayer[];
  onPlaceConflict: (message: string | null) => void;
  onUpdatePlayerField: (playerId: string, patch: Partial<LiveTournamentPlayer>) => Promise<boolean>;
  onSetPlayerArrival: (playerId: string, arrivalStatus: LiveTournamentArrivalStatus) => Promise<void>;
  onOpenOutDialog: (player: LiveTournamentPlayer) => void;
  onRestorePlayer: (playerId: string) => Promise<void>;
}) {
  const [openField, setOpenField] = useState<'entry' | 'payment' | null>(null);
  const canEditCounters = player.arrivalStatus !== 'absent';
  const isOut = player.status === 'out';
  const paymentMethodLabel = player.paymentMethod === 'cash'
    ? 'Наличные'
    : player.paymentMethod === 'card'
      ? 'Карта'
      : 'Не оплачено';
  const paymentDueLabel = player.paymentDue > 0 ? `${player.paymentDue} ₽` : '0 ₽';
  const entryTypeLabel = player.arrivalStatus === 'promo'
    ? 'Промокод'
    : player.arrivalStatus === 'free'
      ? 'Бесплатно'
      : 'Платно';

  const toggleField = (field: typeof openField) => {
    setOpenField(current => current === field ? null : field);
  };

  const nameBadgeLabel = isOut ? 'Выбыл' : player.arrivalStatus === 'absent' ? 'Не в игре' : 'В игре';
  const nameBadgeTone = isOut
    ? 'border-[#C0392B] bg-[#2A0C0A] text-white'
    : player.arrivalStatus === 'absent'
      ? 'border-[#4A4A4A] bg-[#161616] text-[#C2C2C2]'
      : 'border-blue-700/70 bg-blue-950/40 text-blue-200';

  const handleActiveClick = async () => {
    if (isOut) {
      await onRestorePlayer(player.id);
      return;
    }

    if (player.arrivalStatus === 'absent') {
      await onSetPlayerArrival(player.id, 'paid');
    }
  };

  const handlePlaceCommit = async (value: number | null, override: boolean) => {
    if (value !== null) {
      const conflictPlayer = findPlayerWithPlaceConflict(rosterPlayers, player.id, value);
      if (conflictPlayer) {
        onPlaceConflict(`Место #${value} уже занято игроком ${conflictPlayer.name}. Освободите его или выберите другое место.`);
        return false;
      }
    }

    onPlaceConflict(null);
    const updated = await onUpdatePlayerField(player.id, { place: value, placeOverride: override });
    if (!updated && value !== null) {
      onPlaceConflict(`Место #${value} уже занято другим игроком. Выберите другое место.`);
    }
    return updated;
  };

  return (
    <tr className="rounded-2xl bg-[#0A0A0A]">
      <td className="px-1 py-1 sm:px-1.5 sm:py-1.5 align-top rounded-l-2xl border-y border-l border-[#2D2D2D]">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="text-white font-black text-[11px] sm:text-sm truncate">{player.name}</div>
          <div className={`inline-flex w-fit items-center rounded-full border px-1.5 py-0.5 text-[8px] sm:px-2 sm:text-[9px] uppercase tracking-[0.12em] sm:tracking-[0.14em] ${nameBadgeTone}`}>
            {nameBadgeLabel}
          </div>
        </div>
      </td>

      <td className="px-1 py-1 sm:px-1.5 sm:py-1.5 align-top border-y border-[#2D2D2D]">
        <div className="min-w-0 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void onUpdatePlayerField(player.id, { rebuyCount: Math.max(0, player.rebuyCount - 1) })}
            disabled={!canEditCounters}
            className="h-[18px] w-[18px] sm:h-6 sm:w-6 rounded-md sm:rounded-lg bg-[#2D2D2D] text-[#AAA] text-[10px] sm:text-xs font-bold disabled:opacity-30"
          >
            −
          </button>
          <div className="w-3 text-center text-white font-black text-[10px] sm:w-4 sm:text-[11px] leading-none">{player.rebuyCount}</div>
          <button
            type="button"
            onClick={() => void onUpdatePlayerField(player.id, { rebuyCount: player.rebuyCount + 1 })}
            disabled={!canEditCounters}
            className="h-[18px] w-[18px] sm:h-6 sm:w-6 rounded-md sm:rounded-lg bg-[#C0392B] text-white text-[10px] sm:text-xs font-bold disabled:opacity-30"
          >
            +
          </button>
        </div>
      </td>

      <td className="px-1 py-1 sm:px-1.5 sm:py-1.5 align-top border-y border-[#2D2D2D]">
        <div className="min-w-0 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void onUpdatePlayerField(player.id, { addonCount: Math.max(0, player.addonCount - 1) })}
            disabled={!canEditCounters}
            className="h-[18px] w-[18px] sm:h-6 sm:w-6 rounded-md sm:rounded-lg bg-[#2D2D2D] text-[#AAA] text-[10px] sm:text-xs font-bold disabled:opacity-30"
          >
            −
          </button>
          <div className="w-3 text-center text-white font-black text-[10px] sm:w-4 sm:text-[11px] leading-none">{player.addonCount}</div>
          <button
            type="button"
            onClick={() => void onUpdatePlayerField(player.id, { addonCount: player.addonCount + 1 })}
            disabled={!canEditCounters}
            className="h-[18px] w-[18px] sm:h-6 sm:w-6 rounded-md sm:rounded-lg bg-[#C0392B] text-white text-[10px] sm:text-xs font-bold disabled:opacity-30"
          >
            +
          </button>
        </div>
      </td>

      <td className="px-1 py-1 sm:px-1.5 sm:py-1.5 align-top border-y border-[#2D2D2D]">
        <div className="min-w-0 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void onUpdatePlayerField(player.id, { bonusCount: Math.max(0, player.bonusCount - 1) })}
            disabled={!canEditCounters}
            className="h-[18px] w-[18px] sm:h-6 sm:w-6 rounded-md sm:rounded-lg bg-[#2D2D2D] text-[#AAA] text-[10px] sm:text-xs font-bold disabled:opacity-30"
          >
            −
          </button>
          <div className="w-3 text-center text-white font-black text-[10px] sm:w-4 sm:text-[11px] leading-none">{player.bonusCount}</div>
          <button
            type="button"
            onClick={() => void onUpdatePlayerField(player.id, { bonusCount: player.bonusCount + 1 })}
            disabled={!canEditCounters}
            className="h-[18px] w-[18px] sm:h-6 sm:w-6 rounded-md sm:rounded-lg bg-[#C0392B] text-white text-[10px] sm:text-xs font-bold disabled:opacity-30"
          >
            +
          </button>
        </div>
      </td>

      <td className="px-1 py-1 sm:px-1.5 sm:py-1.5 align-top border-y border-[#2D2D2D]">
        <div className="min-w-0 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => void onSetPlayerArrival(player.id, 'absent')}
            disabled={isOut}
            className={`inline-flex w-full items-center justify-center whitespace-normal sm:whitespace-nowrap rounded-lg border px-1 py-1 text-center text-[9px] leading-tight sm:px-1.5 sm:text-[11px] font-bold transition-colors ${
              player.arrivalStatus === 'absent' && !isOut
                ? 'border-[#4A4A4A] bg-[#1A1A1A] text-white'
                : 'border-[#2D2D2D] bg-[#141414] text-[#EEE] hover:border-[#555]'
            } disabled:opacity-40`}
          >
            Не в игре
          </button>
          <button
            type="button"
            onClick={() => void handleActiveClick()}
            className={`inline-flex w-full items-center justify-center whitespace-normal sm:whitespace-nowrap rounded-lg border px-1 py-1 text-center text-[9px] leading-tight sm:px-1.5 sm:text-[11px] font-bold transition-colors ${
              player.arrivalStatus !== 'absent' && !isOut
                ? 'border-blue-700/70 bg-blue-950/40 text-blue-200'
                : isOut
                  ? 'border-emerald-800/70 bg-emerald-950/30 text-emerald-200'
                  : 'border-[#2D2D2D] bg-[#141414] text-[#EEE] hover:border-[#555]'
            }`}
          >
            {isOut ? 'Вернуть в игру' : 'В игре'}
          </button>
        </div>
      </td>

      <td className="px-1 py-1 sm:px-1.5 sm:py-1.5 align-top border-y border-[#2D2D2D]">
        <div className="min-w-0 flex flex-col gap-1">
          {isOut ? (
            <>
              <PlaceInput
                value={player.place}
                disabled={false}
                className="admin-input !w-full !py-1 !px-1 !text-[10px] sm:!text-[11px] text-center font-black"
                onCommit={handlePlaceCommit}
              />
              <button
                type="button"
                onClick={() => onOpenOutDialog(player)}
                className="inline-flex w-full items-center justify-center rounded-lg border border-[#2D2D2D] bg-[#1A1A1A] px-1 py-1 text-[9px] sm:px-1.5 sm:text-[11px] font-bold text-[#DDD]"
              >
                Править
              </button>
            </>
          ) : (
            <>
              <div className="inline-flex w-full items-center justify-center whitespace-nowrap rounded-lg border border-[#2D2D2D] bg-[#141414] px-1 py-1 text-[9px] text-[#777] sm:px-1.5 sm:text-[11px] font-bold">
                —
              </div>
              <button
                type="button"
                onClick={() => onOpenOutDialog(player)}
                className="inline-flex w-full items-center justify-center rounded-lg bg-[#5A1712] px-1 py-1 text-[9px] sm:px-1.5 sm:text-[11px] font-bold text-[#FFD5D0]"
              >
                Выбыл
              </button>
            </>
          )}
        </div>
      </td>

      <td className="px-1 py-1 sm:px-1.5 sm:py-1.5 align-top border-y border-[#2D2D2D] rounded-r-2xl border-r border-[#2D2D2D]">
        <div className="min-w-0 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => toggleField('entry')}
            disabled={player.arrivalStatus === 'absent' && !isOut}
            className="inline-flex w-full items-center justify-center sm:justify-start whitespace-normal sm:whitespace-nowrap rounded-lg border border-[#2D2D2D] bg-[#141414] px-1 py-1 text-center sm:px-1.5 sm:text-left text-[9px] leading-tight sm:text-[11px] font-bold text-white hover:border-[#555] disabled:opacity-40"
          >
            {entryTypeLabel}
          </button>
          {openField === 'entry' && (
            <div className="grid grid-cols-1 gap-1">
              <MiniChoice active={player.arrivalStatus === 'paid'} onClick={async () => {
                await onSetPlayerArrival(player.id, 'paid');
                setOpenField(null);
              }}>
                Платно
              </MiniChoice>
              <MiniChoice active={player.arrivalStatus === 'free'} onClick={async () => {
                await onSetPlayerArrival(player.id, 'free');
                setOpenField(null);
              }}>
                Бесплатно
              </MiniChoice>
              <MiniChoice active={player.arrivalStatus === 'promo'} onClick={async () => {
                await onSetPlayerArrival(player.id, 'promo');
                setOpenField(null);
              }}>
                Промокод
              </MiniChoice>
            </div>
          )}
          <button
            type="button"
            onClick={() => toggleField('payment')}
            className="inline-flex w-full items-center justify-center sm:justify-start whitespace-normal sm:whitespace-nowrap rounded-lg border border-[#2D2D2D] bg-[#141414] px-1 py-1 text-center sm:px-1.5 sm:text-left text-[9px] leading-tight sm:text-[11px] font-bold text-white hover:border-[#555]"
          >
            {paymentMethodLabel}
          </button>
          <div className="text-[8px] sm:text-[10px] leading-tight text-center sm:text-left uppercase tracking-[0.08em] sm:tracking-widest text-[#777]">
            {paymentDueLabel}
          </div>
          {openField === 'payment' && (
            <div className="grid grid-cols-1 gap-1">
              <MiniChoice active={player.paymentMethod === 'unpaid'} onClick={async () => {
                await onUpdatePlayerField(player.id, { paymentMethod: 'unpaid' });
                setOpenField(null);
              }}>
                Не оплачено
              </MiniChoice>
              <MiniChoice active={player.paymentMethod === 'cash'} onClick={async () => {
                await onUpdatePlayerField(player.id, { paymentMethod: 'cash' });
                setOpenField(null);
              }}>
                Наличные
              </MiniChoice>
              <MiniChoice active={player.paymentMethod === 'card'} onClick={async () => {
                await onUpdatePlayerField(player.id, { paymentMethod: 'card' });
                setOpenField(null);
              }}>
                Карта
              </MiniChoice>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function PlaceInput({
  value,
  disabled,
  className,
  onCommit,
}: {
  value: number | null;
  disabled: boolean;
  className: string;
  onCommit: (value: number | null, override: boolean) => Promise<boolean>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current || !inputRef.current) return;
    inputRef.current.value = value !== null && value > 0 ? String(value) : '';
  }, [value]);

  useEffect(() => {
    if (!inputRef.current || focusedRef.current) return;
    if (disabled) {
      inputRef.current.value = '';
    }
  }, [disabled]);

  return (
    <input
      ref={inputRef}
      type="number"
      disabled={disabled}
      defaultValue={value !== null && value > 0 ? String(value) : ''}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={async event => {
        focusedRef.current = false;
        if (disabled) {
          event.currentTarget.value = '';
          return;
        }

        const raw = event.currentTarget.value.trim();
        if (!raw) {
          event.currentTarget.value = '';
          const ok = await onCommit(null, false);
          if (!ok) {
            event.currentTarget.value = value !== null && value > 0 ? String(value) : '';
          }
          return;
        }

        const nextValue = Math.max(1, Number(raw) || 0);
        const normalizedValue = nextValue > 0 ? nextValue : null;
        const ok = await onCommit(normalizedValue, nextValue > 0);
        event.currentTarget.value = ok && normalizedValue !== null
          ? String(normalizedValue)
          : value !== null && value > 0
            ? String(value)
            : '';
      }}
      className={className}
      placeholder="—"
      inputMode="numeric"
    />
  );
}

function MobileCounter({
  label,
  value,
  disabled,
  onDecrease,
  onIncrease,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <div className="rounded-xl border border-[#2D2D2D] bg-[#141414] px-2 py-2">
      <div className="text-[10px] uppercase tracking-[0.12em] text-[#666] text-center">{label}</div>
      <div className="mt-2 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={onDecrease}
          disabled={disabled}
          className="mobile-counter-button h-8 w-8 rounded-lg bg-[#2D2D2D] text-[#AAA] text-sm font-bold disabled:opacity-30"
        >
          −
        </button>
        <div className="mobile-counter-value min-w-[24px] text-center text-white font-black text-base leading-none">{value}</div>
        <button
          type="button"
          onClick={onIncrease}
          disabled={disabled}
          className="mobile-counter-button h-8 w-8 rounded-lg bg-[#C0392B] text-white text-sm font-bold disabled:opacity-30"
        >
          +
        </button>
      </div>
    </div>
  );
}

function MobileSelect({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.14em] text-[#666] mb-1">{label}</div>
      <select
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        className="admin-input !w-full !py-2 !px-3 !text-sm disabled:opacity-40"
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`admin-filter-button rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
        active
          ? 'border-[#C0392B] bg-[#2A0C0A] text-white'
          : 'border-[#2D2D2D] bg-[#141414] text-[#888] hover:border-[#555] hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function MiniChoice({
  active,
  centered = false,
  children,
  onClick,
}: {
  active: boolean;
  centered?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex w-full items-center rounded-md border px-2 py-1.5 text-[10px] leading-none font-bold transition-colors ${
        centered ? 'justify-center text-center' : 'justify-start'
      } ${
        active
          ? 'border-[#C0392B] bg-[#2A0C0A] text-white'
          : 'border-[#2D2D2D] bg-[#141414] text-[#888] hover:border-[#555] hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}
