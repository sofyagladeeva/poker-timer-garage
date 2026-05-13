import { useState } from 'react';
import type { ReactNode } from 'react';
import type {
  LiveTournamentArrivalStatus,
  LiveTournamentPlayer,
  TournamentMode,
  TournamentPlayersSummary,
} from '../types';

type Props = {
  groupedPlayers: {
    active: LiveTournamentPlayer[];
    pending: LiveTournamentPlayer[];
    waitlist: LiveTournamentPlayer[];
    out: LiveTournamentPlayer[];
  };
  summary: TournamentPlayersSummary;
  playerSyncState: {
    loading: boolean;
    error: string | null;
  };
  botSyncState: {
    loading: boolean;
    error: string | null;
    lastSyncedAt: string | null;
    disabled: boolean;
  };
  tournamentMode: TournamentMode;
  tournamentBotId: number | null;
  lateRegistrationClosedAt: number | null;
  lateRegistrationPlayers: number | null;
  onRefreshFromBot: (force?: boolean) => Promise<boolean>;
  onAddManualPlayer: (name: string) => Promise<boolean>;
  onUpdatePlayerField: (playerId: string, patch: Partial<LiveTournamentPlayer>) => Promise<void>;
  onSetPlayerArrival: (playerId: string, arrivalStatus: LiveTournamentArrivalStatus) => Promise<void>;
  onMarkPlayerOut: (playerId: string) => Promise<void>;
  onRestorePlayer: (playerId: string) => Promise<void>;
  onCaptureLateRegistration: () => Promise<void>;
  onResetLateRegistration: () => Promise<void>;
  onSetLateRegistrationPlayers: (value: string) => Promise<void>;
};

function formatSyncMoment(value: string | null) {
  if (!value) return 'еще не синхронизировалось';
  const date = new Date(value);
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function TournamentPlayersTab({
  groupedPlayers,
  summary,
  playerSyncState,
  botSyncState,
  tournamentMode,
  tournamentBotId,
  lateRegistrationClosedAt,
  lateRegistrationPlayers,
  onRefreshFromBot,
  onAddManualPlayer,
  onUpdatePlayerField,
  onSetPlayerArrival,
  onMarkPlayerOut,
  onRestorePlayer,
  onCaptureLateRegistration,
  onResetLateRegistration,
  onSetLateRegistrationPlayers,
}: Props) {
  const [manualPlayerName, setManualPlayerName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewFilter, setViewFilter] = useState<'all' | 'active' | 'pending' | 'waitlist' | 'out' | 'unpaid'>('all');
  const totalPlayers = groupedPlayers.active.length + groupedPlayers.pending.length + groupedPlayers.waitlist.length + groupedPlayers.out.length;
  const normalizedQuery = searchQuery.trim().toLowerCase();

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
    active: filterPlayers(groupedPlayers.active).length,
    pending: filterPlayers(groupedPlayers.pending).length,
    waitlist: filterPlayers(groupedPlayers.waitlist).length,
    out: filterPlayers(groupedPlayers.out).length,
  };

  const handleAddManualPlayer = async () => {
    const ok = await onAddManualPlayer(manualPlayerName);
    if (ok) setManualPlayerName('');
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

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4 flex flex-col gap-3">
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
            Показано: {allPlayers.length} из {totalPlayers}. Все основные действия идут из одной таблицы.
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
              {botSyncState.loading ? 'Синхронизация...' : '↻ Бот'}
            </button>
            <div className="flex items-center gap-2">
              <input
                key={`late-reg-${lateRegistrationPlayers ?? 'empty'}-${lateRegistrationClosedAt ?? 'none'}`}
                type="number"
                defaultValue={lateRegistrationPlayers ?? ''}
                onBlur={event => void onSetLateRegistrationPlayers(event.currentTarget.value)}
                className="admin-input !py-2 !text-xs !w-24"
                placeholder="Late reg"
                inputMode="numeric"
              />
              <button
                type="button"
                onClick={() => void onCaptureLateRegistration()}
                disabled={summary.active <= 0}
                className="admin-btn-primary px-3 py-2 text-xs"
              >
                Фикс. {summary.active}
              </button>
              <button
                type="button"
                onClick={() => void onResetLateRegistration()}
                className="admin-btn-secondary px-3 py-2 text-xs"
              >
                Сброс
              </button>
            </div>
          </div>
        </div>

        <div className="text-[#666] text-[11px]">
          Итоги отправляются в бот при завершении турнира.
        </div>

        <div className="grid grid-cols-1 gap-2 text-[11px] md:grid-cols-3">
          <div className="rounded-xl border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-2 text-[#999]">
            <span className="text-[#666] uppercase tracking-widest mr-2">Текущих</span>
            <span className="text-white font-bold">{summary.active}</span>
          </div>
          <div className="rounded-xl border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-2 text-[#999]">
            <span className="text-[#666] uppercase tracking-widest mr-2">Late reg</span>
            <span className="text-white font-bold">{lateRegistrationPlayers ?? '—'}</span>
          </div>
          <div className={`rounded-xl border px-3 py-2 ${tournamentMode === 'phoenix' ? 'border-[#C0392B]/60 bg-[#220D0B] text-[#F2D2CD]' : 'border-[#2D2D2D] bg-[#0A0A0A] text-[#777]'}`}>
            <div className="text-[10px] uppercase tracking-widest mb-1 text-[#666]">Late reg</div>
            <div className="text-xs leading-relaxed">
              {tournamentMode === 'phoenix'
                ? 'Для Phoenix это число фиксирует базу рейтинга. Ничего нажимать не нужно.'
                : 'Для Garage это только справка. На рейтинг не влияет.'}
            </div>
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

        <div className="text-[11px] text-[#666] flex flex-wrap gap-x-3 gap-y-1">
          <span>{tournamentBotId == null ? 'Для авто-импорта нужно выбрать игру из бота.' : `Последний sync: ${formatSyncMoment(botSyncState.lastSyncedAt)}`}</span>
          {playerSyncState.loading && !playerSyncState.error && <span>Синхронизация списка игроков...</span>}
        </div>
      </div>

      <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-white font-bold text-sm">Игроки</div>
        </div>

        {allPlayers.length === 0 ? (
          <div className="rounded-xl bg-[#0A0A0A] border border-[#1D1D1D] px-4 py-5 text-[#555] text-sm">
            По текущему фильтру игроков нет.
          </div>
        ) : (
          <div className="max-h-[72vh] overflow-auto">
            <table className="table-fixed w-full border-separate border-spacing-y-1.5">
              <thead>
                <tr className="text-[9px] sm:text-[11px] uppercase tracking-[0.18em] text-[#666]">
                  <th className="sticky top-0 z-20 text-left font-normal px-1.5 py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[24%]">Игрок</th>
                  <th className="sticky top-0 z-20 text-left font-normal px-1.5 py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[13%]">Статус</th>
                  <th className="sticky top-0 z-20 text-left font-normal px-1.5 py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[12%]">Rebuy</th>
                  <th className="sticky top-0 z-20 text-left font-normal px-1.5 py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[12%]">Addon</th>
                  <th className="sticky top-0 z-20 text-left font-normal px-1.5 py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[10%]">Bounty</th>
                  <th className="sticky top-0 z-20 text-left font-normal px-1.5 py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[10%]">Выбыл</th>
                  <th className="sticky top-0 z-20 text-left font-normal px-1.5 py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[13%]">Оплата</th>
                  <th className="sticky top-0 z-20 text-left font-normal px-1.5 py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[4%]">Место</th>
                </tr>
              </thead>
              <tbody>
                {allPlayers.map(player => (
                  <PlayerRow
                    key={player.id}
                    player={player}
                    onUpdatePlayerField={onUpdatePlayerField}
                    onSetPlayerArrival={onSetPlayerArrival}
                    onMarkPlayerOut={onMarkPlayerOut}
                    onRestorePlayer={onRestorePlayer}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerRow({
  player,
  onUpdatePlayerField,
  onSetPlayerArrival,
  onMarkPlayerOut,
  onRestorePlayer,
}: {
  player: LiveTournamentPlayer;
  onUpdatePlayerField: (playerId: string, patch: Partial<LiveTournamentPlayer>) => Promise<void>;
  onSetPlayerArrival: (playerId: string, arrivalStatus: LiveTournamentArrivalStatus) => Promise<void>;
  onMarkPlayerOut: (playerId: string) => Promise<void>;
  onRestorePlayer: (playerId: string) => Promise<void>;
}) {
  const [openField, setOpenField] = useState<'status' | 'payment' | null>(null);
  const canEditCounters = player.arrivalStatus !== 'absent';
  const isOut = player.status === 'out';
  const liveStateLabel = isOut
    ? 'Выбыл'
    : player.arrivalStatus === 'absent'
      ? 'Не в игре'
      : 'В игре';
  const placeLabel = isOut && player.place !== null ? String(player.place) : '—';
  const paymentMethodLabel = player.paymentMethod === 'cash'
    ? 'Наличные'
    : player.paymentMethod === 'card'
      ? 'Карта'
      : 'Не оплачено';

  const toggleField = (field: typeof openField) => {
    setOpenField(current => current === field ? null : field);
  };

  return (
    <tr className="rounded-2xl bg-[#0A0A0A]">
      <td className="px-1.5 py-1.5 align-top rounded-l-2xl border-y border-l border-[#2D2D2D]">
        <div className="min-w-0 flex flex-col gap-1">
          <div className="text-white font-black text-[12px] sm:text-sm truncate">{player.name}</div>
          <Badge tone={isOut ? 'red' : player.arrivalStatus === 'absent' ? 'amber' : 'blue'}>
            {liveStateLabel}
          </Badge>
        </div>
      </td>

      <td className="px-1.5 py-1.5 align-top border-y border-[#2D2D2D]">
        <div className="min-w-0 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => toggleField('status')}
            className={`inline-flex w-fit max-w-full items-center justify-start whitespace-nowrap rounded-lg border px-1.5 py-1 text-left text-[10px] sm:text-[11px] font-bold transition-colors ${
              openField === 'status'
                ? 'border-[#C0392B] bg-[#2A0C0A] text-white'
                : 'border-[#2D2D2D] bg-[#141414] text-[#EEE] hover:border-[#555]'
            }`}
          >
            {player.arrivalStatus === 'paid'
              ? 'В игре платно'
              : player.arrivalStatus === 'free'
                ? 'В игре бесплатно'
                : 'Не в игре'}
          </button>
          {openField === 'status' && (
            <div className="grid grid-cols-1 gap-1">
              <MiniChoice active={player.arrivalStatus === 'absent'} onClick={async () => {
                await onSetPlayerArrival(player.id, 'absent');
                setOpenField(null);
              }}>
                Не в игре
              </MiniChoice>
              <MiniChoice active={player.arrivalStatus === 'paid'} onClick={async () => {
                await onSetPlayerArrival(player.id, 'paid');
                setOpenField(null);
              }}>
                В игре платно
              </MiniChoice>
              <MiniChoice active={player.arrivalStatus === 'free'} onClick={async () => {
                await onSetPlayerArrival(player.id, 'free');
                setOpenField(null);
              }}>
                В игре бесплатно
              </MiniChoice>
            </div>
          )}
        </div>
      </td>

      <td className="px-1.5 py-1.5 align-top border-y border-[#2D2D2D]">
        <div className="min-w-0 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void onUpdatePlayerField(player.id, { rebuyCount: Math.max(0, player.rebuyCount - 1) })}
            disabled={!canEditCounters}
            className="h-6 w-6 rounded-lg bg-[#2D2D2D] text-[#AAA] text-xs font-bold disabled:opacity-30"
          >
            −
          </button>
          <div className="w-4 text-center text-white font-black text-[11px] leading-none">{player.rebuyCount}</div>
          <button
            type="button"
            onClick={() => void onUpdatePlayerField(player.id, { rebuyCount: player.rebuyCount + 1 })}
            disabled={!canEditCounters}
            className="h-6 w-6 rounded-lg bg-[#C0392B] text-white text-xs font-bold disabled:opacity-30"
          >
            +
          </button>
        </div>
      </td>

      <td className="px-1.5 py-1.5 align-top border-y border-[#2D2D2D]">
        <div className="min-w-0 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void onUpdatePlayerField(player.id, { addonCount: Math.max(0, player.addonCount - 1) })}
            disabled={!canEditCounters}
            className="h-6 w-6 rounded-lg bg-[#2D2D2D] text-[#AAA] text-xs font-bold disabled:opacity-30"
          >
            −
          </button>
          <div className="w-4 text-center text-white font-black text-[11px] leading-none">{player.addonCount}</div>
          <button
            type="button"
            onClick={() => void onUpdatePlayerField(player.id, { addonCount: player.addonCount + 1 })}
            disabled={!canEditCounters}
            className="h-6 w-6 rounded-lg bg-[#C0392B] text-white text-xs font-bold disabled:opacity-30"
          >
            +
          </button>
        </div>
      </td>

      <td className="px-1.5 py-1.5 align-top border-y border-[#2D2D2D]">
        <input
          key={`bounty-${player.id}-${player.updatedAt}`}
          type="number"
          defaultValue={player.bounty || ''}
          onBlur={event => void onUpdatePlayerField(player.id, { bounty: Math.max(0, Number(event.currentTarget.value) || 0) })}
          className="admin-input !w-full !py-1 !px-1 !text-[11px] text-center"
          placeholder="0"
          inputMode="numeric"
        />
      </td>

      <td className="px-1.5 py-1.5 align-top border-y border-[#2D2D2D]">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => void (isOut ? onRestorePlayer(player.id) : onMarkPlayerOut(player.id))}
            disabled={!canEditCounters && !isOut}
            className={`inline-flex w-full items-center justify-center whitespace-nowrap rounded-lg border px-1.5 py-1 text-left text-[10px] sm:text-[11px] font-bold transition-colors ${
              isOut
                ? 'border-[#C0392B] bg-[#2A0C0A] text-white'
                : 'border-[#2D2D2D] bg-[#141414] text-[#EEE] hover:border-[#555]'
            }`}
          >
            Выбыл
          </button>
        </div>
      </td>

      <td className="px-1.5 py-1.5 align-top border-y border-[#2D2D2D]">
        <div className="min-w-0 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => toggleField('payment')}
            className="inline-flex w-full items-center justify-start whitespace-nowrap rounded-lg border border-[#2D2D2D] bg-[#141414] px-1.5 py-1 text-left text-[10px] sm:text-[11px] font-bold text-white hover:border-[#555]"
          >
            {paymentMethodLabel}
          </button>
          <div className="text-[9px] sm:text-[10px] leading-none whitespace-nowrap uppercase tracking-widest text-[#777]">
            {player.paymentDue > 0 ? `${player.paymentDue} ₽ к оплате` : 'К оплате 0 ₽'}
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

      <td className="px-1.5 py-1.5 align-top border-y border-[#2D2D2D] rounded-r-2xl border-r border-[#2D2D2D]">
        <div className="min-w-0">
          <div className={`inline-flex w-full items-center justify-center whitespace-nowrap rounded-lg border px-1.5 py-1 text-[10px] sm:text-[11px] font-bold ${isOut ? 'border-[#C0392B] bg-[#220D0B] text-white' : 'border-[#2D2D2D] bg-[#141414] text-[#777]'}`}>
            {placeLabel}
          </div>
        </div>
      </td>
    </tr>
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
      className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
        active
          ? 'border-[#C0392B] bg-[#2A0C0A] text-white'
          : 'border-[#2D2D2D] bg-[#141414] text-[#888] hover:border-[#555] hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'neutral' | 'red' | 'blue' | 'amber';
}) {
  const classes = {
    neutral: 'bg-[#171717] text-[#999] border-[#2D2D2D]',
    red: 'bg-red-950/40 text-red-300 border-red-900/70',
    blue: 'bg-blue-950/40 text-blue-300 border-blue-900/70',
    amber: 'bg-amber-950/40 text-amber-200 border-amber-900/70',
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[8px] sm:text-[9px] font-bold uppercase tracking-wide ${classes[tone]}`}>
      {children}
    </span>
  );
}

function MiniChoice({
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
      className={`inline-flex w-full items-center justify-start rounded-md border px-2 py-1.5 text-[10px] leading-none font-bold transition-colors ${
        active
          ? 'border-[#C0392B] bg-[#2A0C0A] text-white'
          : 'border-[#2D2D2D] bg-[#141414] text-[#888] hover:border-[#555] hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}
