import { useState } from 'react';
import type { ReactNode } from 'react';
import type {
  LiveTournamentArrivalStatus,
  LiveTournamentPlayer,
} from '../types';

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
  botSyncState: {
    loading: boolean;
    error: string | null;
    lastSyncedAt: string | null;
    disabled: boolean;
  };
  tournamentBotId: number | null;
  onRefreshFromBot: (force?: boolean) => Promise<boolean>;
  onAddManualPlayer: (name: string) => Promise<boolean>;
  onUpdatePlayerField: (playerId: string, patch: Partial<LiveTournamentPlayer>) => Promise<void>;
  onSetPlayerArrival: (playerId: string, arrivalStatus: LiveTournamentArrivalStatus) => Promise<void>;
  onMarkPlayerOut: (playerId: string) => Promise<void>;
};

export function TournamentPlayersTab({
  groupedPlayers,
  playerSyncState,
  botSyncState,
  tournamentBotId,
  onRefreshFromBot,
  onAddManualPlayer,
  onUpdatePlayerField,
  onSetPlayerArrival,
  onMarkPlayerOut,
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
    <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4 flex flex-col gap-4">
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
          <div className="max-h-[72vh] overflow-y-auto overflow-x-hidden">
            <div className="flex flex-col gap-3 sm:hidden">
              {allPlayers.map(player => (
                <MobilePlayerCard
                  key={player.id}
                  player={player}
                  onUpdatePlayerField={onUpdatePlayerField}
                  onSetPlayerArrival={onSetPlayerArrival}
                  onMarkPlayerOut={onMarkPlayerOut}
                />
              ))}
            </div>

            <div className="hidden sm:block">
              <table className="w-full table-fixed border-separate border-spacing-y-1">
                <thead>
                  <tr className="text-[8px] sm:text-[11px] uppercase tracking-[0.12em] sm:tracking-[0.18em] text-[#666]">
                    <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[26%]">Игрок</th>
                    <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[10%]">Rebuy</th>
                    <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[10%]">Addon</th>
                    <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[10%]">Бонус</th>
                    <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[13%]">Статус</th>
                    <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[8%]">Bounty</th>
                    <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[7%]">Место</th>
                    <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[16%]">Оплата</th>
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
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MobilePlayerCard({
  player,
  onUpdatePlayerField,
  onSetPlayerArrival,
  onMarkPlayerOut,
}: {
  player: LiveTournamentPlayer;
  onUpdatePlayerField: (playerId: string, patch: Partial<LiveTournamentPlayer>) => Promise<void>;
  onSetPlayerArrival: (playerId: string, arrivalStatus: LiveTournamentArrivalStatus) => Promise<void>;
  onMarkPlayerOut: (playerId: string) => Promise<void>;
}) {
  const canEditCounters = player.arrivalStatus !== 'absent';
  const isOut = player.status === 'out';
  const placeLabel = isOut && player.place !== null ? String(player.place) : '—';
  const paymentDueLabel = player.paymentDue > 0 ? `${player.paymentDue} ₽` : '0 ₽';
  const nameBadgeLabel = isOut ? 'Выбыл' : player.arrivalStatus === 'absent' ? 'Не в игре' : 'В игре';
  const nameBadgeTone = isOut
    ? 'border-[#C0392B] bg-[#2A0C0A] text-white'
    : player.arrivalStatus === 'absent'
      ? 'border-[#4A4A4A] bg-[#161616] text-[#C2C2C2]'
      : 'border-blue-700/70 bg-blue-950/40 text-blue-200';
  const statusValue = isOut ? 'out' : player.arrivalStatus;

  const handleStatusChange = async (nextValue: string) => {
    if (nextValue === 'out') {
      await onMarkPlayerOut(player.id);
      return;
    }

    if (nextValue === 'absent' || nextValue === 'paid' || nextValue === 'free' || nextValue === 'promo') {
      await onSetPlayerArrival(player.id, nextValue);
    }
  };

  const handlePaymentChange = async (nextValue: string) => {
    if (nextValue === 'unpaid' || nextValue === 'cash' || nextValue === 'card') {
      await onUpdatePlayerField(player.id, { paymentMethod: nextValue });
    }
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
          <div className={`mt-1 text-lg font-black ${isOut ? 'text-white' : 'text-[#777]'}`}>{placeLabel}</div>
        </div>
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

      <div className="mt-3 grid gap-2">
        <MobileSelect
          label="Статус"
          value={statusValue}
          onChange={value => { void handleStatusChange(value); }}
          options={[
            { value: 'absent', label: 'Не в игре' },
            { value: 'paid', label: 'Платно' },
            { value: 'free', label: 'Бесплатно' },
            { value: 'promo', label: 'Промокод' },
            { value: 'out', label: 'Выбыл' },
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

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_96px] gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#666] mb-1">Bounty</div>
          <input
            key={`mobile-bounty-${player.id}-${player.updatedAt}`}
            type="number"
            defaultValue={player.bounty || ''}
            onBlur={event => void onUpdatePlayerField(player.id, { bounty: Math.max(0, Number(event.currentTarget.value) || 0) })}
            className="admin-input !w-full !py-2 !px-3 !text-sm text-center"
            placeholder="0"
            inputMode="numeric"
          />
        </div>

        <div className="rounded-xl border border-[#2D2D2D] bg-[#141414] px-3 py-2 text-right">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">К оплате</div>
          <div className="mt-2 text-base font-black text-white whitespace-nowrap">{paymentDueLabel}</div>
        </div>
      </div>
    </div>
  );
}

function PlayerRow({
  player,
  onUpdatePlayerField,
  onSetPlayerArrival,
  onMarkPlayerOut,
}: {
  player: LiveTournamentPlayer;
  onUpdatePlayerField: (playerId: string, patch: Partial<LiveTournamentPlayer>) => Promise<void>;
  onSetPlayerArrival: (playerId: string, arrivalStatus: LiveTournamentArrivalStatus) => Promise<void>;
  onMarkPlayerOut: (playerId: string) => Promise<void>;
}) {
  const [openField, setOpenField] = useState<'status' | 'payment' | null>(null);
  const canEditCounters = player.arrivalStatus !== 'absent';
  const isOut = player.status === 'out';
  const placeLabel = isOut && player.place !== null ? String(player.place) : '—';
  const paymentMethodLabel = player.paymentMethod === 'cash'
    ? 'Наличные'
    : player.paymentMethod === 'card'
      ? 'Карта'
      : 'Не оплачено';
  const paymentDueLabel = player.paymentDue > 0 ? `${player.paymentDue} ₽` : '0 ₽';

  const toggleField = (field: typeof openField) => {
    setOpenField(current => current === field ? null : field);
  };

  const statusLabel = isOut
    ? 'Выбыл'
    : player.arrivalStatus === 'paid'
      ? 'Платно'
      : player.arrivalStatus === 'free'
        ? 'Бесплатно'
        : player.arrivalStatus === 'promo'
          ? 'Промокод'
          : 'Не в игре';
  const nameBadgeLabel = isOut ? 'Выбыл' : player.arrivalStatus === 'absent' ? 'Не в игре' : 'В игре';
  const nameBadgeTone = isOut
    ? 'border-[#C0392B] bg-[#2A0C0A] text-white'
    : player.arrivalStatus === 'absent'
      ? 'border-[#4A4A4A] bg-[#161616] text-[#C2C2C2]'
      : 'border-blue-700/70 bg-blue-950/40 text-blue-200';

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
            onClick={() => toggleField('status')}
            className={`inline-flex w-full items-center justify-center whitespace-normal sm:whitespace-nowrap rounded-lg border px-1 py-1 text-center text-[9px] leading-tight sm:px-1.5 sm:text-[11px] font-bold transition-colors ${
              openField === 'status'
                ? 'border-[#555] bg-[#1A1A1A] text-white'
                : 'border-[#2D2D2D] bg-[#141414] text-[#EEE] hover:border-[#555]'
            }`}
          >
            {statusLabel}
          </button>
          {openField === 'status' && (
            <div className="grid grid-cols-1 gap-1">
              <MiniChoice centered active={player.arrivalStatus === 'absent'} onClick={async () => {
                await onSetPlayerArrival(player.id, 'absent');
                setOpenField(null);
              }}>
                Не в игре
              </MiniChoice>
              <MiniChoice centered active={player.arrivalStatus === 'paid'} onClick={async () => {
                await onSetPlayerArrival(player.id, 'paid');
                setOpenField(null);
              }}>
                Платно
              </MiniChoice>
              <MiniChoice centered active={player.arrivalStatus === 'free'} onClick={async () => {
                await onSetPlayerArrival(player.id, 'free');
                setOpenField(null);
              }}>
                Бесплатно
              </MiniChoice>
              <MiniChoice centered active={player.arrivalStatus === 'promo'} onClick={async () => {
                await onSetPlayerArrival(player.id, 'promo');
                setOpenField(null);
              }}>
                Промокод
              </MiniChoice>
              <MiniChoice centered active={isOut} onClick={async () => {
                await onMarkPlayerOut(player.id);
                setOpenField(null);
              }}>
                Выбыл
              </MiniChoice>
            </div>
          )}
        </div>
      </td>

      <td className="px-1 py-1 sm:px-1.5 sm:py-1.5 align-top border-y border-[#2D2D2D]">
        <input
          key={`bounty-${player.id}-${player.updatedAt}`}
          type="number"
          defaultValue={player.bounty || ''}
          onBlur={event => void onUpdatePlayerField(player.id, { bounty: Math.max(0, Number(event.currentTarget.value) || 0) })}
          className="admin-input !w-full !py-1 !px-1 !text-[10px] sm:!text-[11px] text-center"
          placeholder="0"
          inputMode="numeric"
        />
      </td>

      <td className="px-1 py-1 sm:px-1.5 sm:py-1.5 align-top border-y border-[#2D2D2D]">
        <div className={`inline-flex w-full items-center justify-center whitespace-nowrap rounded-lg border px-1 py-1 text-[9px] sm:px-1.5 sm:text-[11px] font-bold ${isOut ? 'border-[#C0392B] bg-[#220D0B] text-white' : 'border-[#2D2D2D] bg-[#141414] text-[#777]'}`}>
          {placeLabel}
        </div>
      </td>

      <td className="px-1 py-1 sm:px-1.5 sm:py-1.5 align-top border-y border-[#2D2D2D] rounded-r-2xl border-r border-[#2D2D2D]">
        <div className="min-w-0 flex flex-col gap-1">
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
          className="h-8 w-8 rounded-lg bg-[#2D2D2D] text-[#AAA] text-sm font-bold disabled:opacity-30"
        >
          −
        </button>
        <div className="min-w-[24px] text-center text-white font-black text-base leading-none">{value}</div>
        <button
          type="button"
          onClick={onIncrease}
          disabled={disabled}
          className="h-8 w-8 rounded-lg bg-[#C0392B] text-white text-sm font-bold disabled:opacity-30"
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
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.14em] text-[#666] mb-1">{label}</div>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="admin-input !w-full !py-2 !px-3 !text-sm"
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
