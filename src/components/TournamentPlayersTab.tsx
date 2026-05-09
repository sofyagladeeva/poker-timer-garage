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
  exportState: {
    sending: boolean;
    status: 'idle' | 'sent' | 'failed';
    error: string | null;
    lastAttemptAt: string | null;
    queued: boolean;
  };
  tournamentMode: TournamentMode;
  tournamentBotId: number | null;
  lateRegistrationClosedAt: number | null;
  lateRegistrationPlayers: number | null;
  levelsPlayed: number;
  onRefreshFromBot: (force?: boolean) => Promise<boolean>;
  onAddManualPlayer: (name: string) => Promise<boolean>;
  onUpdatePlayerField: (playerId: string, patch: Partial<LiveTournamentPlayer>) => Promise<void>;
  onSetPlayerArrival: (playerId: string, arrivalStatus: LiveTournamentArrivalStatus) => Promise<void>;
  onMarkPlayerOut: (playerId: string) => Promise<void>;
  onRestorePlayer: (playerId: string) => Promise<void>;
  onRemoveManualPlayer: (playerId: string) => Promise<boolean>;
  onSetPlayerPlace: (playerId: string, value: string) => Promise<void>;
  onCaptureLateRegistration: () => Promise<void>;
  onResetLateRegistration: () => Promise<void>;
  onSetLateRegistrationPlayers: (value: string) => Promise<void>;
  onExportResults: (levelsPlayed: number) => Promise<{
    ok: boolean;
    skipped: boolean;
    queued: boolean;
    error: string | null;
    queueError?: string | null;
  }>;
};

function formatSyncMoment(value: string | null) {
  if (!value) return 'еще не синхронизировалось';
  const date = new Date(value);
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatLateRegMoment(value: number | null) {
  if (!value) return 'не зафиксировано';
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TournamentPlayersTab({
  groupedPlayers,
  summary,
  playerSyncState,
  botSyncState,
  exportState,
  tournamentMode,
  tournamentBotId,
  lateRegistrationClosedAt,
  lateRegistrationPlayers,
  levelsPlayed,
  onRefreshFromBot,
  onAddManualPlayer,
  onUpdatePlayerField,
  onSetPlayerArrival,
  onMarkPlayerOut,
  onRestorePlayer,
  onRemoveManualPlayer,
  onSetPlayerPlace,
  onCaptureLateRegistration,
  onResetLateRegistration,
  onSetLateRegistrationPlayers,
  onExportResults,
}: Props) {
  const [manualPlayerName, setManualPlayerName] = useState('');
  const totalPlayers = groupedPlayers.active.length + groupedPlayers.pending.length + groupedPlayers.waitlist.length + groupedPlayers.out.length;

  const handleAddManualPlayer = async () => {
    const ok = await onAddManualPlayer(manualPlayerName);
    if (ok) setManualPlayerName('');
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <SummaryCard label="В игре" value={summary.active} accent="text-green-300" />
        <SummaryCard label="Пришли" value={summary.entrants} accent="text-white" />
        <SummaryCard label="Ожидают" value={summary.pending} accent="text-yellow-300" />
        <SummaryCard label="Waitlist" value={summary.waitlist} accent="text-blue-300" />
        <SummaryCard label="К оплате" value={summary.totalDue.toLocaleString('ru-RU')} accent="text-[#C0392B]" suffix="₽" />
      </div>

      <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex-1">
            <div className="text-white font-bold text-sm">Late reg</div>
            <div className="text-[#666] text-xs mt-1">
              Для Phoenix рейтинг считается от числа игроков, которые оставались в игре на момент закрытия late reg.
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[140px_auto_auto] gap-2 lg:min-w-[520px]">
            <input
              key={`late-reg-${lateRegistrationPlayers ?? 'empty'}-${lateRegistrationClosedAt ?? 'none'}`}
              type="number"
              defaultValue={lateRegistrationPlayers ?? ''}
              onBlur={event => void onSetLateRegistrationPlayers(event.currentTarget.value)}
              className="admin-input"
              placeholder="Игроков"
              inputMode="numeric"
            />
            <button
              type="button"
              onClick={() => void onCaptureLateRegistration()}
              disabled={summary.active <= 0}
              className="admin-btn-primary px-4 py-3 text-sm"
            >
              Зафиксировать по текущим ({summary.active})
            </button>
            <button
              type="button"
              onClick={() => void onResetLateRegistration()}
              className="admin-btn-secondary px-4 py-3 text-sm"
            >
              Сбросить
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl border border-[#2D2D2D] bg-[#0A0A0A] px-4 py-3">
            <div className="text-[#666] text-[11px] uppercase tracking-widest">Текущих в игре</div>
            <div className="mt-2 text-white font-black text-2xl">{summary.active}</div>
          </div>
          <div className="rounded-xl border border-[#2D2D2D] bg-[#0A0A0A] px-4 py-3">
            <div className="text-[#666] text-[11px] uppercase tracking-widest">Зафиксировано на late reg</div>
            <div className="mt-2 text-white font-black text-2xl">{lateRegistrationPlayers ?? '—'}</div>
          </div>
          <div className="rounded-xl border border-[#2D2D2D] bg-[#0A0A0A] px-4 py-3">
            <div className="text-[#666] text-[11px] uppercase tracking-widest">Когда зафиксировано</div>
            <div className="mt-2 text-[#DDD] font-bold">{formatLateRegMoment(lateRegistrationClosedAt)}</div>
          </div>
        </div>

        <div className={`rounded-xl border px-3 py-2 text-sm ${
          tournamentMode === 'phoenix'
            ? 'border-[#C0392B]/60 bg-[#220D0B] text-[#F2D2CD]'
            : 'border-[#2D2D2D] bg-[#0A0A0A] text-[#777]'
        }`}>
          {tournamentMode === 'phoenix'
            ? 'Сейчас выбран Phoenix: без этого числа экспорт итогов будет остановлен, чтобы рейтинг не посчитался неверно.'
            : 'Сейчас выбран Garage: late reg сохраняется для протокола, но на формулу рейтинга не влияет.'}
        </div>
      </div>

      <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex-1">
            <div className="text-white font-bold text-sm">Состав турнира</div>
            <div className="text-[#666] text-xs mt-1">
              Всего карточек игроков: {totalPlayers}. Поздние регистрации можно подхватывать повторной синхронизацией или добавлять вручную.
            </div>
          </div>

          <div className="flex flex-col gap-2 lg:items-end">
            <button
              type="button"
              onClick={() => void onRefreshFromBot(true)}
              disabled={tournamentBotId == null || botSyncState.loading}
              className="admin-btn-secondary px-4 py-2 text-sm"
            >
              {botSyncState.loading ? 'Обновляю состав...' : '↻ Обновить из бота'}
            </button>
            <div className="text-[11px] text-[#666] text-right">
              {tournamentBotId == null
                ? 'Для авто-импорта нужно выбрать игру из бота.'
                : `Последний sync: ${formatSyncMoment(botSyncState.lastSyncedAt)}`}
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

        {playerSyncState.loading && !playerSyncState.error && (
          <div className="text-[#666] text-xs">Синхронизация списка игроков...</div>
        )}
      </div>

      <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
          <div className="flex-1">
            <div className="text-white font-bold text-sm mb-1">Добавить игрока вручную</div>
            <input
              type="text"
              value={manualPlayerName}
              onChange={event => setManualPlayerName(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && manualPlayerName.trim()) {
                  void handleAddManualPlayer();
                }
              }}
              placeholder="Имя игрока"
              className="admin-input"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleAddManualPlayer()}
            disabled={!manualPlayerName.trim()}
            className="admin-btn-primary px-4 py-3 text-sm lg:min-w-[180px]"
          >
            + Добавить в игру
          </button>
        </div>
        <div className="text-[11px] text-[#666]">
          Ручной игрок сразу попадает в игру как платный вход. Если это free entry, поменяйте статус на карточке игрока.
        </div>
      </div>

      <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-white font-bold text-sm">Итоги в бот</div>
            <div className="text-[#666] text-xs mt-1">
              Отправка берет текущий live-список, места, re-entry, addon, bounty и оплату.
            </div>
          </div>
          <button
            type="button"
            onClick={() => void onExportResults(levelsPlayed)}
            disabled={exportState.sending || totalPlayers === 0}
            className="admin-btn-secondary px-4 py-3 text-sm"
          >
            {exportState.sending ? 'Отправляю...' : '⇪ Отправить итоги'}
          </button>
        </div>

        {exportState.status === 'sent' && (
          <div className="rounded-xl border border-green-900/60 bg-green-950/30 px-3 py-2 text-green-300 text-sm">
            Итоги турнира отправлены. {exportState.queued ? 'Копия также сохранена в очередь.' : ''}
          </div>
        )}

        {exportState.status === 'failed' && exportState.error && (
          <div className="rounded-xl border border-amber-900/70 bg-amber-950/30 px-3 py-2 text-amber-200 text-sm">
            {exportState.error} {exportState.queued ? 'Данные турнира сохранены в очередь отправки.' : ''}
          </div>
        )}
      </div>

      <PlayerSection
        title="В игре"
        note="Пришли и еще не выбыли"
        players={groupedPlayers.active}
        emptyText="Сейчас нет активных игроков."
        renderPlayer={player => (
          <PlayerCard
            key={player.id}
            player={player}
            onUpdatePlayerField={onUpdatePlayerField}
            onSetPlayerArrival={onSetPlayerArrival}
            onMarkPlayerOut={onMarkPlayerOut}
            onRestorePlayer={onRestorePlayer}
            onRemoveManualPlayer={onRemoveManualPlayer}
            onSetPlayerPlace={onSetPlayerPlace}
          />
        )}
      />

      <PlayerSection
        title="Зарегистрированы, но не пришли"
        note="Есть в составе турнира, но еще не отмечены на месте"
        players={groupedPlayers.pending}
        emptyText="Все зарегистрированные уже отмечены или перемещены."
        renderPlayer={player => (
          <PlayerCard
            key={player.id}
            player={player}
            onUpdatePlayerField={onUpdatePlayerField}
            onSetPlayerArrival={onSetPlayerArrival}
            onMarkPlayerOut={onMarkPlayerOut}
            onRestorePlayer={onRestorePlayer}
            onRemoveManualPlayer={onRemoveManualPlayer}
            onSetPlayerPlace={onSetPlayerPlace}
          />
        )}
      />

      <PlayerSection
        title="Лист ожидания"
        note="Записались, но пока без посадки"
        players={groupedPlayers.waitlist}
        emptyText="Лист ожидания пуст."
        renderPlayer={player => (
          <PlayerCard
            key={player.id}
            player={player}
            onUpdatePlayerField={onUpdatePlayerField}
            onSetPlayerArrival={onSetPlayerArrival}
            onMarkPlayerOut={onMarkPlayerOut}
            onRestorePlayer={onRestorePlayer}
            onRemoveManualPlayer={onRemoveManualPlayer}
            onSetPlayerPlace={onSetPlayerPlace}
          />
        )}
      />

      <PlayerSection
        title="Выбывшие"
        note="Место проставляется автоматически, но можно исправить вручную"
        players={groupedPlayers.out}
        emptyText="Пока никто не выбыл."
        renderPlayer={player => (
          <PlayerCard
            key={player.id}
            player={player}
            onUpdatePlayerField={onUpdatePlayerField}
            onSetPlayerArrival={onSetPlayerArrival}
            onMarkPlayerOut={onMarkPlayerOut}
            onRestorePlayer={onRestorePlayer}
            onRemoveManualPlayer={onRemoveManualPlayer}
            onSetPlayerPlace={onSetPlayerPlace}
          />
        )}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
  suffix,
}: {
  label: string;
  value: string | number;
  accent: string;
  suffix?: string;
}) {
  return (
    <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
      <div className="text-[#666] text-[11px] uppercase tracking-widest">{label}</div>
      <div className={`mt-2 font-black text-3xl leading-none ${accent}`}>
        {value}
        {suffix ? <span className="text-base text-[#666] ml-1">{suffix}</span> : null}
      </div>
    </div>
  );
}

function PlayerSection({
  title,
  note,
  players,
  emptyText,
  renderPlayer,
}: {
  title: string;
  note: string;
  players: LiveTournamentPlayer[];
  emptyText: string;
  renderPlayer: (player: LiveTournamentPlayer) => ReactNode;
}) {
  return (
    <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4 flex flex-col gap-3">
      <div>
        <div className="text-white font-bold text-sm">{title}</div>
        <div className="text-[#666] text-xs mt-1">{note}</div>
      </div>

      {players.length === 0 ? (
        <div className="rounded-xl bg-[#0A0A0A] border border-[#1D1D1D] px-4 py-5 text-[#555] text-sm">
          {emptyText}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {players.map(renderPlayer)}
        </div>
      )}
    </div>
  );
}

function PlayerCard({
  player,
  onUpdatePlayerField,
  onSetPlayerArrival,
  onMarkPlayerOut,
  onRestorePlayer,
  onRemoveManualPlayer,
  onSetPlayerPlace,
}: {
  player: LiveTournamentPlayer;
  onUpdatePlayerField: (playerId: string, patch: Partial<LiveTournamentPlayer>) => Promise<void>;
  onSetPlayerArrival: (playerId: string, arrivalStatus: LiveTournamentArrivalStatus) => Promise<void>;
  onMarkPlayerOut: (playerId: string) => Promise<void>;
  onRestorePlayer: (playerId: string) => Promise<void>;
  onRemoveManualPlayer: (playerId: string) => Promise<boolean>;
  onSetPlayerPlace: (playerId: string, value: string) => Promise<void>;
}) {
  const canEditCounters = player.arrivalStatus !== 'absent';
  const isOut = player.status === 'out';

  return (
    <div className="rounded-2xl border border-[#2D2D2D] bg-[#0A0A0A] p-4 flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-white font-black text-lg truncate">{player.name}</div>
            <Badge tone={player.source === 'manual' ? 'amber' : 'neutral'}>
              {player.source === 'manual' ? 'ручной' : 'бот'}
            </Badge>
            <Badge tone={player.registrationSource === 'waitlist' ? 'blue' : 'neutral'}>
              {player.registrationSource === 'waitlist' ? 'waitlist' : 'основной список'}
            </Badge>
            {isOut && player.place !== null && (
              <Badge tone="red">место {player.place}</Badge>
            )}
          </div>

          {player.username && (
            <div className="text-[#666] text-xs mt-1 truncate">@{player.username.replace(/^@/, '')}</div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {isOut ? (
            <button type="button" onClick={() => void onRestorePlayer(player.id)} className="admin-btn-secondary px-3 py-2 text-xs">
              Вернуть в игру
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void onMarkPlayerOut(player.id)}
              disabled={!canEditCounters}
              className="admin-btn-danger px-3 py-2 text-xs"
            >
              Отметить выбывшим
            </button>
          )}

          {player.source === 'manual' && (
            <button type="button" onClick={() => void onRemoveManualPlayer(player.id)} className="admin-btn-secondary px-3 py-2 text-xs">
              Удалить
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="flex flex-col gap-2">
          <div className="text-[#666] text-[11px] uppercase tracking-widest">Приход</div>
          <div className="grid grid-cols-3 gap-2">
            <ChoiceButton active={player.arrivalStatus === 'absent'} onClick={() => void onSetPlayerArrival(player.id, 'absent')}>
              Нет
            </ChoiceButton>
            <ChoiceButton active={player.arrivalStatus === 'paid'} onClick={() => void onSetPlayerArrival(player.id, 'paid')}>
              Платно
            </ChoiceButton>
            <ChoiceButton active={player.arrivalStatus === 'free'} onClick={() => void onSetPlayerArrival(player.id, 'free')}>
              Бесплатно
            </ChoiceButton>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-[#666] text-[11px] uppercase tracking-widest">Повторы входа</div>
          <div className="grid grid-cols-2 gap-2">
            <TinyCounter
              label="Rebuy"
              value={player.rebuyCount}
              disabled={!canEditCounters}
              onDecrement={() => void onUpdatePlayerField(player.id, { rebuyCount: Math.max(0, player.rebuyCount - 1) })}
              onIncrement={() => void onUpdatePlayerField(player.id, { rebuyCount: player.rebuyCount + 1 })}
            />
            <TinyCounter
              label="Addon"
              value={player.addonCount}
              disabled={!canEditCounters}
              onDecrement={() => void onUpdatePlayerField(player.id, { addonCount: Math.max(0, player.addonCount - 1) })}
              onIncrement={() => void onUpdatePlayerField(player.id, { addonCount: player.addonCount + 1 })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-[#666] text-[11px] uppercase tracking-widest">Bounty и место</div>
          <div className="grid grid-cols-2 gap-2">
            <input
              key={`bounty-${player.id}-${player.updatedAt}`}
              type="number"
              defaultValue={player.bounty || ''}
              onBlur={event => void onUpdatePlayerField(player.id, { bounty: Math.max(0, Number(event.currentTarget.value) || 0) })}
              className="admin-input"
              placeholder="Bounty"
              inputMode="numeric"
            />
            <input
              key={`place-${player.id}-${player.updatedAt}`}
              type="number"
              defaultValue={player.place ?? ''}
              onBlur={event => void onSetPlayerPlace(player.id, event.currentTarget.value)}
              className="admin-input"
              placeholder="Место"
              inputMode="numeric"
              disabled={!isOut}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
        <div className="flex flex-col gap-2">
          <div className="text-[#666] text-[11px] uppercase tracking-widest">Сумма к оплате</div>
          <input
            key={`payment-${player.id}-${player.updatedAt}`}
            type="number"
            defaultValue={player.paymentDue || ''}
            onBlur={event => void onUpdatePlayerField(player.id, { paymentDue: Math.max(0, Number(event.currentTarget.value) || 0) })}
            className="admin-input"
            placeholder="Сумма"
            inputMode="numeric"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-[#666] text-[11px] uppercase tracking-widest">Способ оплаты</div>
          <div className="grid grid-cols-3 gap-2">
            <ChoiceButton active={player.paymentMethod === 'unpaid'} onClick={() => void onUpdatePlayerField(player.id, { paymentMethod: 'unpaid' })}>
              Не оплачено
            </ChoiceButton>
            <ChoiceButton active={player.paymentMethod === 'cash'} onClick={() => void onUpdatePlayerField(player.id, { paymentMethod: 'cash' })}>
              Нал.
            </ChoiceButton>
            <ChoiceButton active={player.paymentMethod === 'card'} onClick={() => void onUpdatePlayerField(player.id, { paymentMethod: 'card' })}>
              Карта
            </ChoiceButton>
          </div>
        </div>
      </div>
    </div>
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
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${classes[tone]}`}>
      {children}
    </span>
  );
}

function ChoiceButton({
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

function TinyCounter({
  label,
  value,
  disabled,
  onDecrement,
  onIncrement,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onDecrement: () => void;
  onIncrement: () => void;
}) {
  return (
    <div className="rounded-xl border border-[#2D2D2D] bg-[#141414] px-3 py-2">
      <div className="text-[#666] text-[10px] uppercase tracking-widest">{label}</div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onDecrement}
          disabled={disabled}
          className="h-9 w-9 rounded-lg bg-[#2D2D2D] text-[#AAA] font-bold disabled:opacity-30"
        >
          −
        </button>
        <div className="text-white font-black text-2xl leading-none min-w-[24px] text-center">{value}</div>
        <button
          type="button"
          onClick={onIncrement}
          disabled={disabled}
          className="h-9 w-9 rounded-lg bg-[#C0392B] text-white font-bold disabled:opacity-30"
        >
          +
        </button>
      </div>
    </div>
  );
}
