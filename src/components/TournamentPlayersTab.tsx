import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  LiveTournamentArrivalStatus,
  LiveTournamentPlayer,
  PlayerGift,
  PlayerGiftType,
  PlayerGiftValidCondition,
  PlayerProfile,
  PlayerProfileDefaultStatus,
} from '../types';
import { isGiftValidNow } from '../playerGifts';
import { findPlayerWithPlaceConflict, isEarlyBird } from '../hooks/useTournamentPlayers';
import { matchesSearchQuery } from '../searchUtils';

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
  tournamentTitle?: string | null;
  tournamentDate?: string | null;
  earlyBirdBonusEnabled?: boolean;
  isTournamentEnded: boolean;
  preferMobileCards?: boolean;
  reviewPlayers: LiveTournamentPlayer[];
  cashAdditionalContent?: ReactNode;
  onOpenControlTab: () => void;
  onRefreshFromBot: (force?: boolean) => Promise<boolean>;
  onAddManualPlayer: (name: string) => Promise<boolean>;
  onRemovePlayer: (playerId: string) => Promise<boolean>;
  onUpdatePlayerField: (playerId: string, patch: Partial<LiveTournamentPlayer>) => Promise<boolean>;
  onSetPlayerArrival: (playerId: string, arrivalStatus: LiveTournamentArrivalStatus) => Promise<void>;
  onMarkPlayerOut: (playerId: string, options?: { bounty?: number }) => Promise<void>;
  onRestorePlayer: (playerId: string) => Promise<void>;
  onRestorePlayersFromBackup: (backupId: string) => Promise<boolean>;
  tableCount?: number;
  onAssignSeat?: (playerId: string, tableNumber: number | null, seatNumber: number | null) => Promise<void>;
  knownPlayers?: Array<{ name: string; username: string | null }>;
  profilesByTelegramId?: Map<number, PlayerProfile>;
  activeGifts?: Map<number, PlayerGift[]>;
  usedGiftIdsThisSession?: Set<string>;
  isClassicTournament?: boolean;
  currentSessionId?: number | null;
  onRedeemGift?: (gift: PlayerGift, player: LiveTournamentPlayer) => Promise<void>;
  onUnredeemGift?: (gift: PlayerGift) => void;
  onCreateGift?: (player: LiveTournamentPlayer, type: PlayerGiftType, comment: string | null, validCondition: PlayerGiftValidCondition, validUntil: string | null, validTournamentTitle: string | null) => Promise<void>;
  botGames?: Array<{ id: number; title: string; date: string }>;
};

export function TournamentPlayersTab({
  groupedPlayers,
  playerSyncState,
  playerBackups,
  botSyncState,
  tournamentBotId,
  tournamentTitle,
  tournamentDate,
  earlyBirdBonusEnabled = true,
  isTournamentEnded,
  preferMobileCards = false,
  reviewPlayers,
  cashAdditionalContent,
  onOpenControlTab,
  onRefreshFromBot,
  onAddManualPlayer,
  onRemovePlayer,
  onUpdatePlayerField,
  onSetPlayerArrival,
  onMarkPlayerOut,
  onRestorePlayer,
  onRestorePlayersFromBackup,
  tableCount = 4,
  onAssignSeat,
  knownPlayers = [],
  profilesByTelegramId,
  activeGifts,
  usedGiftIdsThisSession,
  isClassicTournament = false,
  currentSessionId,
  onRedeemGift,
  onUnredeemGift,
  onCreateGift,
  botGames = [],
}: Props) {
  const isGiftApplicable = (gift: PlayerGift) =>
    gift.type === 'custom' || isClassicTournament;

  const [manualPlayerName, setManualPlayerName] = useState('');
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewFilter, setViewFilter] = useState<'all' | 'active' | 'pending' | 'waitlist' | 'out' | 'unpaid' | 'cash' | 'card'>('all');
  const [placeConflictNotice, setPlaceConflictNotice] = useState<string | null>(null);
  const [backupRestoreBusyId, setBackupRestoreBusyId] = useState<string | null>(null);
  const [backupRestoreNotice, setBackupRestoreNotice] = useState<string | null>(null);
  const [cashSummaryOpen, setCashSummaryOpen] = useState(false);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [outDialogPlayerId, setOutDialogPlayerId] = useState<string | null>(null);
  const [outDialogBountyDraft, setOutDialogBountyDraft] = useState('0');
  const [seatModalPlayer, setSeatModalPlayer] = useState<LiveTournamentPlayer | null>(null);
  const [seatModalBusy, setSeatModalBusy] = useState(false);
  const [outDialogBusy, setOutDialogBusy] = useState(false);
  const [contactPlayer, setContactPlayer] = useState<LiveTournamentPlayer | null>(null);
  const [returnBountyNotice, setReturnBountyNotice] = useState<{ playerName: string; bounty: number } | null>(null);
  const [giftArrivalNotice, setGiftArrivalNotice] = useState<{ player: LiveTournamentPlayer; gifts: PlayerGift[] } | null>(null);
  const [giftDialogPlayer, setGiftDialogPlayer] = useState<LiveTournamentPlayer | null>(null);
  const [giftDialogType, setGiftDialogType] = useState<PlayerGiftType>('free_entry');
  const [giftDialogValidity, setGiftDialogValidity] = useState<PlayerGiftValidCondition>('next_tournament');
  const [giftDialogDate, setGiftDialogDate] = useState('');
  const [giftDialogTournamentTitle, setGiftDialogTournamentTitle] = useState('');
  const [giftDialogComment, setGiftDialogComment] = useState('');
  const [giftDialogBusy, setGiftDialogBusy] = useState(false);

  const getProfileArrivalStatus = (player: LiveTournamentPlayer): LiveTournamentArrivalStatus =>
    (player.telegramId != null ? profilesByTelegramId?.get(player.telegramId)?.defaultArrivalStatus : undefined) ?? 'paid';

  const getValidGiftsForPlayer = (player: LiveTournamentPlayer): PlayerGift[] => {
    if (player.telegramId == null || !activeGifts) return [];
    return (activeGifts.get(player.telegramId) ?? []).filter(g => isGiftValidNow(g, tournamentBotId, tournamentTitle, currentSessionId));
  };

  const handleRequestActivate = (player: LiveTournamentPlayer) => {
    if (onAssignSeat && tableCount > 0) {
      setSeatModalPlayer(player);
    } else {
      void onSetPlayerArrival(player.id, getProfileArrivalStatus(player));
      const gifts = getValidGiftsForPlayer(player);
      if (gifts.length > 0) setGiftArrivalNotice({ player, gifts });
    }
  };

  const handleRestorePlayer = async (playerId: string) => {
    const player = rosterPlayers.find(item => item.id === playerId) ?? null;
    await onRestorePlayer(playerId);

    if (player && player.bounty > 0) {
      setReturnBountyNotice({
        playerName: player.name,
        bounty: player.bounty,
      });
    }
  };

  const handleSeatConfirm = async (tableNumber: number, seatNumber: number) => {
    if (!seatModalPlayer) return;
    setSeatModalBusy(true);
    const activatingPlayer = seatModalPlayer;
    try {
      await onSetPlayerArrival(activatingPlayer.id, getProfileArrivalStatus(activatingPlayer));
      await onAssignSeat?.(activatingPlayer.id, tableNumber, seatNumber);
      setSeatModalPlayer(null);
      const gifts = getValidGiftsForPlayer(activatingPlayer);
      if (gifts.length > 0) setGiftArrivalNotice({ player: activatingPlayer, gifts });
    } finally {
      setSeatModalBusy(false);
    }
  };

  const handleSeatSkip = async () => {
    if (!seatModalPlayer) return;
    setSeatModalBusy(true);
    const activatingPlayer = seatModalPlayer;
    try {
      await onSetPlayerArrival(activatingPlayer.id, getProfileArrivalStatus(activatingPlayer));
      setSeatModalPlayer(null);
      const gifts = getValidGiftsForPlayer(activatingPlayer);
      if (gifts.length > 0) setGiftArrivalNotice({ player: activatingPlayer, gifts });
    } finally {
      setSeatModalBusy(false);
    }
  };

  const handleCreateGiftSubmit = async () => {
    if (!giftDialogPlayer || !onCreateGift) return;
    setGiftDialogBusy(true);
    try {
      const validUntil = giftDialogValidity === 'until_date' ? (giftDialogDate || null) : null;
      const validTournamentTitle = giftDialogValidity === 'specific_tournament' ? (giftDialogTournamentTitle || null) : null;
      await onCreateGift(giftDialogPlayer, giftDialogType, giftDialogComment.trim() || null, giftDialogValidity, validUntil, validTournamentTitle);
      setGiftDialogPlayer(null);
      setGiftDialogComment('');
      setGiftDialogType('free_entry');
      setGiftDialogValidity('next_tournament');
      setGiftDialogDate('');
      setGiftDialogTournamentTitle('');
    } finally {
      setGiftDialogBusy(false);
    }
  };

  const totalPlayers = groupedPlayers.active.length + groupedPlayers.pending.length + groupedPlayers.waitlist.length + groupedPlayers.out.length;
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const rosterPlayers = [
    ...groupedPlayers.active,
    ...groupedPlayers.pending,
    ...groupedPlayers.waitlist,
    ...groupedPlayers.out,
  ];
  const waitlistQueuePlayers = useMemo(
    () => [...groupedPlayers.waitlist].sort(compareWaitlistQueue),
    [groupedPlayers.waitlist]
  );
  const waitlistPositionById = useMemo(
    () => new Map(waitlistQueuePlayers.map((player, index) => [player.id, index + 1])),
    [waitlistQueuePlayers]
  );
  const arrivedPlayers = rosterPlayers.filter(p => p.arrivalStatus !== 'absent');
  const payTotalDue = arrivedPlayers.reduce((s, p) => s + p.paymentDue, 0);
  const payCash = arrivedPlayers.reduce((s, p) => s + p.cashPaid, 0);
  const payCard = arrivedPlayers.reduce((s, p) => s + p.cardPaid, 0);
  const payUnpaid = payTotalDue - payCash - payCard;
  const outDialogPlayer = outDialogPlayerId
    ? rosterPlayers.find(player => player.id === outDialogPlayerId) ?? null
    : null;

  const matchesSearch = (player: LiveTournamentPlayer) => {
    if (!normalizedQuery) return true;
    if (matchesSearchQuery(player.name, normalizedQuery)) return true;
    if (player.realName && matchesSearchQuery(player.realName, normalizedQuery)) return true;
    return false;
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
        return player.arrivalStatus !== 'absent' && player.paymentDue > player.cashPaid + player.cardPaid;
      case 'cash':
        return player.arrivalStatus !== 'absent' && player.cashPaid > 0;
      case 'card':
        return player.arrivalStatus !== 'absent' && player.cardPaid > 0;
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

  const rosterNames = new Set(rosterPlayers.map(p => p.name.toLowerCase()));
  const autocompleteSuggestions = manualPlayerName.trim().length > 0
    ? knownPlayers
        .filter(p => !rosterNames.has(p.name.toLowerCase()) && matchesSearchQuery(p.name, manualPlayerName.trim()))
        .slice(0, 7)
    : [];
  const typedMatchesExisting = knownPlayers.some(
    p => p.name.toLowerCase() === manualPlayerName.trim().toLowerCase()
  );

  const handleAddManualPlayer = async (nameOverride?: string) => {
    const name = nameOverride ?? manualPlayerName;
    const ok = await onAddManualPlayer(name);
    if (ok) {
      setManualPlayerName('');
      setAutocompleteOpen(false);
    }
  };

  const handleAutocompleteSelect = (name: string) => {
    void handleAddManualPlayer(name);
  };

  const handleRemovePlayer = async (player: LiveTournamentPlayer) => {
    if (!confirm('Удалить игрока из турнира? Место освободится для других игроков.')) return;

    setPlaceConflictNotice(null);
    const ok = await onRemovePlayer(player.id);
    if (!ok) {
      setPlaceConflictNotice('Не удалось удалить игрока. Проверьте синхронизацию с ботом и попробуйте ещё раз.');
    }
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
        ? filterPlayers(waitlistQueuePlayers)
        : viewFilter === 'out'
          ? filterPlayers(groupedPlayers.out)
          : [
              ...filterPlayers(groupedPlayers.active),
              ...filterPlayers(waitlistQueuePlayers),
              ...filterPlayers(groupedPlayers.out),
              ...filterPlayers(groupedPlayers.pending),
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
            <div className="relative">
              <input
                type="text"
                value={manualPlayerName}
                onChange={event => {
                  setManualPlayerName(event.target.value);
                  setAutocompleteOpen(true);
                  setAutocompleteIndex(0);
                }}
                onFocus={() => setAutocompleteOpen(true)}
                onBlur={() => setTimeout(() => setAutocompleteOpen(false), 150)}
                onKeyDown={event => {
                  const total = autocompleteSuggestions.length + (manualPlayerName.trim() && !typedMatchesExisting ? 1 : 0);
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setAutocompleteIndex(i => Math.min(i + 1, total - 1));
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setAutocompleteIndex(i => Math.max(i - 1, 0));
                  } else if (event.key === 'Escape') {
                    setAutocompleteOpen(false);
                  } else if (event.key === 'Enter' && autocompleteOpen && total > 0) {
                    event.preventDefault();
                    const isNewPlayerItem = autocompleteIndex === autocompleteSuggestions.length;
                    const name = isNewPlayerItem
                      ? manualPlayerName.trim()
                      : autocompleteSuggestions[autocompleteIndex]?.name ?? manualPlayerName.trim();
                    void handleAddManualPlayer(name);
                  } else if (event.key === 'Enter' && manualPlayerName.trim()) {
                    void handleAddManualPlayer();
                  }
                }}
                placeholder="Никнейм"
                className="admin-input !w-44 !py-2 !text-xs"
              />
              {autocompleteOpen && manualPlayerName.trim() && (autocompleteSuggestions.length > 0 || !typedMatchesExisting) && (
                <div className="absolute left-0 top-full mt-1 z-50 w-56 bg-[#111] border border-[#2D2D2D] rounded-xl overflow-hidden shadow-xl">
                  {autocompleteSuggestions.map((p, i) => (
                    <button
                      key={p.name}
                      type="button"
                      onMouseDown={() => handleAutocompleteSelect(p.name)}
                      className={`w-full text-left px-3 py-2 text-xs flex flex-col gap-0.5 transition-colors ${
                        i === autocompleteIndex ? 'bg-[#1E1E1E] text-white' : 'text-[#ccc] hover:bg-[#1A1A1A]'
                      }`}
                    >
                      <span className="font-semibold">{p.name}</span>
                      {p.username && <span className="text-[#555] text-[10px]">@{p.username}</span>}
                    </button>
                  ))}
                  {!typedMatchesExisting && (
                    <button
                      type="button"
                      onMouseDown={() => void handleAddManualPlayer(manualPlayerName.trim())}
                      className={`w-full text-left px-3 py-2 text-xs transition-colors border-t border-[#1D1D1D] ${
                        autocompleteIndex === autocompleteSuggestions.length ? 'bg-[#1E1E1E] text-white' : 'text-[#888] hover:bg-[#1A1A1A]'
                      }`}
                    >
                      + Новый игрок «{manualPlayerName.trim()}»
                    </button>
                  )}
                </div>
              )}
            </div>
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

        {(arrivedPlayers.length > 0 || cashAdditionalContent) && (
          <div className="rounded-xl border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Касса</div>
              <button
                type="button"
                onClick={() => setCashSummaryOpen(open => !open)}
                className="admin-btn-secondary px-3 py-1.5 text-xs"
              >
                {cashSummaryOpen ? 'Скрыть' : 'Показать'}
              </button>
            </div>
            {cashSummaryOpen && (
              <div className="mt-3 flex flex-col gap-3">
              {arrivedPlayers.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-lg bg-[#111] px-3 py-2">
                  <div className="text-[#555] text-[10px] uppercase">К оплате</div>
                  <div className="text-white font-black text-base mt-0.5">{payTotalDue.toLocaleString('ru-RU')} ₽</div>
                </div>
                <button
                  type="button"
                  onClick={() => setViewFilter(f => f === 'cash' ? 'all' : 'cash')}
                  className={`rounded-lg px-3 py-2 text-left transition-colors ${
                    viewFilter === 'cash'
                      ? 'border border-[#C0392B] bg-[#2A0C0A]'
                      : 'bg-[#111] hover:bg-[#1A1A1A]'
                  }`}
                >
                  <div className="text-[#555] text-[10px] uppercase">Наличными</div>
                  <div className="text-white font-black text-base mt-0.5">{payCash.toLocaleString('ru-RU')} ₽</div>
                </button>
                <button
                  type="button"
                  onClick={() => setViewFilter(f => f === 'card' ? 'all' : 'card')}
                  className={`rounded-lg px-3 py-2 text-left transition-colors ${
                    viewFilter === 'card'
                      ? 'border border-[#C0392B] bg-[#2A0C0A]'
                      : 'bg-[#111] hover:bg-[#1A1A1A]'
                  }`}
                >
                  <div className="text-[#555] text-[10px] uppercase">Картой</div>
                  <div className="text-white font-black text-base mt-0.5">{payCard.toLocaleString('ru-RU')} ₽</div>
                </button>
                <button
                  type="button"
                  onClick={() => setViewFilter(f => f === 'unpaid' ? 'all' : 'unpaid')}
                  className={`rounded-lg px-3 py-2 text-left transition-colors ${
                    viewFilter === 'unpaid'
                      ? 'border border-amber-600 bg-amber-950/50'
                      : payUnpaid > 0
                        ? 'bg-amber-950/30 border border-amber-900/50 hover:bg-amber-950/50'
                        : 'bg-[#111] hover:bg-[#1A1A1A]'
                  }`}
                >
                  <div className="text-[#555] text-[10px] uppercase">Не оплачено</div>
                  <div className={`font-black text-base mt-0.5 ${payUnpaid > 0 ? 'text-amber-300' : 'text-white'}`}>
                    {payUnpaid.toLocaleString('ru-RU')} ₽
                  </div>
                </button>
              </div>
              )}
              {cashAdditionalContent && (
                <div className="border-t border-[#2D2D2D] pt-3">
                  {cashAdditionalContent}
                </div>
              )}
              </div>
            )}
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
                {allPlayers.map(player => {
                  const playerGifts = player.telegramId != null
                    ? (activeGifts?.get(player.telegramId) ?? []).filter(g => g.status === 'redeemed' || g.status === 'active')
                    : [];
                  const availableGifts = playerGifts.filter(g => g.status === 'active' && !usedGiftIdsThisSession?.has(g.id) && isGiftApplicable(g) && isGiftValidNow(g, tournamentBotId, tournamentTitle, currentSessionId));
                  const availableGiftIds = new Set(availableGifts.map(g => g.id));
                  return (
                    <MobilePlayerCard
                      key={player.id}
                      player={player}
                      waitlistPosition={waitlistPositionById.get(player.id) ?? null}
                      tournamentDate={tournamentDate}
                      earlyBirdBonusEnabled={earlyBirdBonusEnabled}
                      rosterPlayers={rosterPlayers}
                      onPlaceConflict={setPlaceConflictNotice}
                      onUpdatePlayerField={onUpdatePlayerField}
                      onSetPlayerArrival={onSetPlayerArrival}
                      onRequestActivate={handleRequestActivate}
                      onOpenOutDialog={openOutDialog}
                      onRestorePlayer={handleRestorePlayer}
                      onRemovePlayer={handleRemovePlayer}
                      onShowContact={setContactPlayer}
                      profileDefaultStatus={player.telegramId != null ? profilesByTelegramId?.get(player.telegramId)?.defaultArrivalStatus : undefined}
                      playerGifts={playerGifts}
                      usedGiftIdsThisSession={usedGiftIdsThisSession}
                      availableGiftIds={availableGiftIds}
                      onApplyGift={onRedeemGift && availableGifts.length > 0 ? () => setGiftArrivalNotice({ player, gifts: availableGifts }) : undefined}
                      onAutoApplyGift={onRedeemGift ? (gift) => void onRedeemGift(gift, player) : undefined}
                      onUnredeemGift={onUnredeemGift}
                      onOpenGiftDialog={onCreateGift && player.telegramId != null ? () => setGiftDialogPlayer(player) : undefined}
                    />
                  );
                })}
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3 sm:hidden">
                  {allPlayers.map(player => {
                    const playerGifts = player.telegramId != null
                      ? (activeGifts?.get(player.telegramId) ?? []).filter(g => g.status === 'redeemed' || g.status === 'active')
                      : [];
                    const availableGifts = playerGifts.filter(g => g.status === 'active' && !usedGiftIdsThisSession?.has(g.id) && isGiftApplicable(g) && isGiftValidNow(g, tournamentBotId, tournamentTitle, currentSessionId));
                    const availableGiftIds = new Set(availableGifts.map(g => g.id));
                    return (
                      <MobilePlayerCard
                        key={player.id}
                        player={player}
                        waitlistPosition={waitlistPositionById.get(player.id) ?? null}
                        tournamentDate={tournamentDate}
                        earlyBirdBonusEnabled={earlyBirdBonusEnabled}
                        rosterPlayers={rosterPlayers}
                        onPlaceConflict={setPlaceConflictNotice}
                        onUpdatePlayerField={onUpdatePlayerField}
                        onSetPlayerArrival={onSetPlayerArrival}
                        onRequestActivate={handleRequestActivate}
                        onOpenOutDialog={openOutDialog}
                        onRestorePlayer={handleRestorePlayer}
                        onRemovePlayer={handleRemovePlayer}
                        onShowContact={setContactPlayer}
                        profileDefaultStatus={player.telegramId != null ? profilesByTelegramId?.get(player.telegramId)?.defaultArrivalStatus : undefined}
                        playerGifts={playerGifts}
                        usedGiftIdsThisSession={usedGiftIdsThisSession}
                        availableGiftIds={availableGiftIds}
                        onApplyGift={onRedeemGift && availableGifts.length > 0 ? () => setGiftArrivalNotice({ player, gifts: availableGifts }) : undefined}
                        onAutoApplyGift={onRedeemGift ? (gift) => void onRedeemGift(gift, player) : undefined}
                      onUnredeemGift={onUnredeemGift}
                        onOpenGiftDialog={onCreateGift && player.telegramId != null ? () => setGiftDialogPlayer(player) : undefined}
                      />
                    );
                  })}
                </div>

                <div className="hidden sm:block">
                  <table className="w-full table-fixed border-separate border-spacing-y-1">
                    <thead>
                      <tr className="text-[8px] sm:text-[11px] uppercase tracking-[0.12em] sm:tracking-[0.18em] text-[#666]">
                        <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[22%]">Игрок</th>
                        <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[13%]">В игре</th>
                        <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[9%]">Rebuy</th>
                        <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[9%]">Addon</th>
                        <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[9%]">Бонус</th>
                        <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[8%]">RC</th>
                        <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[12%]">Место</th>
                        <th className="sticky top-0 z-20 text-left font-normal px-1 py-1 sm:px-1.5 sm:py-1.5 bg-[#111] shadow-[0_1px_0_#2D2D2D] w-[18%]">Вход / оплата</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allPlayers.map(player => {
                        const playerGifts = player.telegramId != null
                          ? (activeGifts?.get(player.telegramId) ?? []).filter(g => g.status === 'redeemed' || g.status === 'active')
                          : [];
                        const availableGifts = playerGifts.filter(g => g.status === 'active' && !usedGiftIdsThisSession?.has(g.id) && isGiftApplicable(g) && isGiftValidNow(g, tournamentBotId, tournamentTitle, currentSessionId));
                        const availableGiftIds = new Set(availableGifts.map(g => g.id));
                        return (
                          <PlayerRow
                            key={player.id}
                            player={player}
                            waitlistPosition={waitlistPositionById.get(player.id) ?? null}
                            tournamentDate={tournamentDate}
                            earlyBirdBonusEnabled={earlyBirdBonusEnabled}
                            rosterPlayers={rosterPlayers}
                            onPlaceConflict={setPlaceConflictNotice}
                            onUpdatePlayerField={onUpdatePlayerField}
                            onSetPlayerArrival={onSetPlayerArrival}
                            onOpenOutDialog={openOutDialog}
                            onRestorePlayer={handleRestorePlayer}
                            onRemovePlayer={handleRemovePlayer}
                            onShowContact={setContactPlayer}
                            onRequestActivate={handleRequestActivate}
                            profileDefaultStatus={player.telegramId != null ? profilesByTelegramId?.get(player.telegramId)?.defaultArrivalStatus : undefined}
                            playerGifts={playerGifts}
                            usedGiftIdsThisSession={usedGiftIdsThisSession}
                            availableGiftIds={availableGiftIds}
                            onApplyGift={onRedeemGift && availableGifts.length > 0 ? () => setGiftArrivalNotice({ player, gifts: availableGifts }) : undefined}
                            onAutoApplyGift={onRedeemGift ? (gift) => void onRedeemGift(gift, player) : undefined}
                      onUnredeemGift={onUnredeemGift}
                            onOpenGiftDialog={onCreateGift && player.telegramId != null ? () => setGiftDialogPlayer(player) : undefined}
                          />
                        );
                      })}
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
      {contactPlayer && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 sm:items-center sm:p-6"
          onClick={() => setContactPlayer(null)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-[#2D2D2D] bg-[#111] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="border-b border-[#2D2D2D] px-5 py-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-white font-black text-base break-words">{contactPlayer.name}</div>
                {contactPlayer.realName && (
                  <div className="mt-0.5 text-sm text-[#999]">{contactPlayer.realName}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setContactPlayer(null)}
                className="shrink-0 text-[#666] hover:text-white text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              {contactPlayer.phone ? (
                <a
                  href={`tel:${contactPlayer.phone}`}
                  className="flex items-center gap-3 rounded-2xl border border-[#2D2D2D] bg-[#0A0A0A] px-4 py-3 hover:border-[#444] transition-colors"
                >
                  <span className="text-lg">📞</span>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Телефон</div>
                    <div className="text-white font-bold text-sm mt-0.5">{contactPlayer.phone}</div>
                  </div>
                </a>
              ) : (
                <div className="flex items-center gap-3 rounded-2xl border border-[#2D2D2D] bg-[#0A0A0A] px-4 py-3 opacity-40">
                  <span className="text-lg">📞</span>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Телефон</div>
                    <div className="text-[#666] text-sm mt-0.5">Не указан</div>
                  </div>
                </div>
              )}
              {contactPlayer.instagram && (
                <a
                  href={`https://instagram.com/${contactPlayer.instagram.replace(/^@/, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-2xl border border-[#2D2D2D] bg-[#0A0A0A] px-4 py-3 hover:border-[#444] transition-colors"
                >
                  <span className="text-lg">📸</span>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Instagram</div>
                    <div className="text-white font-bold text-sm mt-0.5">{contactPlayer.instagram}</div>
                  </div>
                </a>
              )}
              {contactPlayer.username ? (
                <a
                  href={`https://t.me/${contactPlayer.username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-2xl border border-[#2D2D2D] bg-[#0A0A0A] px-4 py-3 hover:border-[#444] transition-colors"
                >
                  <span className="text-lg">✈️</span>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Telegram</div>
                    <div className="text-white font-bold text-sm mt-0.5">@{contactPlayer.username}</div>
                  </div>
                </a>
              ) : contactPlayer.telegramId ? (
                <div className="flex items-center gap-3 rounded-2xl border border-[#2D2D2D] bg-[#0A0A0A] px-4 py-3">
                  <span className="text-lg">✈️</span>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Telegram ID</div>
                    <div className="text-white font-bold text-sm mt-0.5">{contactPlayer.telegramId}</div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
      {returnBountyNotice && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 sm:items-center sm:p-6"
          onClick={() => setReturnBountyNotice(null)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-amber-700/70 bg-[#111] shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="border-b border-[#2D2D2D] px-5 py-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-amber-300">Bounty</div>
              <div className="mt-2 text-xl font-black text-white">Игрок снова в игре</div>
              <div className="mt-1 break-words text-sm text-[#888]">{returnBountyNotice.playerName}</div>
            </div>
            <div className="px-5 py-5">
              <div className="rounded-2xl border border-amber-700/50 bg-amber-950/30 px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-amber-300">Выдайте игроку</div>
                <div className="mt-2 text-4xl font-black text-white">{returnBountyNotice.bounty}</div>
                <div className="mt-1 text-sm text-amber-100">bounty шт.</div>
              </div>
              <div className="mt-3 text-xs text-[#777]">
                Это напоминание появляется, потому что при прошлом вылете у игрока было bounty больше нуля.
              </div>
            </div>
            <div className="border-t border-[#2D2D2D] px-5 py-4">
              <button
                type="button"
                onClick={() => setReturnBountyNotice(null)}
                className="admin-btn-primary w-full py-3 text-sm"
              >
                Понятно
              </button>
            </div>
          </div>
        </div>
      )}
      {giftArrivalNotice && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 sm:items-center sm:p-6"
          onClick={() => setGiftArrivalNotice(null)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-violet-700/70 bg-[#111] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="border-b border-[#2D2D2D] px-5 py-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-violet-300">Призы</div>
              <div className="mt-2 text-xl font-black text-white">У игрока есть призы</div>
              <div className="mt-1 break-words text-sm text-[#888]">{giftArrivalNotice.player.name}</div>
            </div>
            <div className="flex flex-col gap-3 px-5 py-4">
              {giftArrivalNotice.gifts.map(gift => (
                <div key={gift.id} className={`rounded-2xl border px-4 py-3 ${giftBannerTone(gift.type)}`}>
                  <div className="text-sm font-bold">{giftTypeLabel(gift)}</div>
                  <div className="mt-0.5 text-[11px] opacity-70">{giftValidLabel(gift)}</div>
                  {onRedeemGift && (
                    <button
                      type="button"
                      onClick={() => {
                        void onRedeemGift(gift, giftArrivalNotice.player);
                        setGiftArrivalNotice(prev => {
                          if (!prev) return null;
                          const remaining = prev.gifts.filter(g => g.id !== gift.id);
                          return remaining.length > 0 ? { ...prev, gifts: remaining } : null;
                        });
                      }}
                      className="mt-2.5 w-full rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-wide bg-white/10 hover:bg-white/20 transition-colors"
                    >
                      {gift.type === 'custom' ? 'Отметить использованным' : 'Применить'}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="border-t border-[#2D2D2D] px-5 py-4">
              <button
                type="button"
                onClick={() => setGiftArrivalNotice(null)}
                className="admin-btn-secondary w-full py-3 text-sm"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
      {seatModalPlayer && (
        <SeatAssignModal
          player={seatModalPlayer}
          tableCount={tableCount}
          rosterPlayers={rosterPlayers}
          busy={seatModalBusy}
          onConfirm={handleSeatConfirm}
          onSkip={() => void handleSeatSkip()}
          onClose={() => setSeatModalPlayer(null)}
        />
      )}

      {giftDialogPlayer && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/75 p-3 sm:items-center sm:p-6">
          <div className="w-full max-w-md rounded-3xl border border-[#2D2D2D] bg-[#111] shadow-2xl">
            <div className="border-b border-[#2D2D2D] px-5 py-4">
              <div className="text-white font-black text-lg">Выдать подарок</div>
              <div className="mt-1 text-sm text-[#777] break-words">{giftDialogPlayer.name}</div>
            </div>
            <div className="px-5 py-4 flex flex-col gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[#666] mb-2">Тип подарка</div>
                <div className="grid grid-cols-2 gap-2">
                  {(['free_entry', 'free_rebuy', 'free_addon', 'custom'] as const).map(t => (
                    <button key={t} type="button"
                      onClick={() => setGiftDialogType(t)}
                      className={`rounded-xl border px-3 py-2.5 text-xs font-bold text-left transition-colors ${giftDialogType === t ? 'border-[#C0392B] bg-[#2A0C0A] text-white' : 'border-[#2D2D2D] bg-[#141414] text-[#888] hover:border-[#555]'}`}
                    >
                      {t === 'free_entry' ? 'Бесплатный вход' : t === 'free_rebuy' ? 'Бесплатный ребай' : t === 'free_addon' ? 'Бесплатный аддон' : 'Другое'}
                    </button>
                  ))}
                </div>
              </div>
              {giftDialogType === 'custom' && (
                <input
                  value={giftDialogComment}
                  onChange={e => setGiftDialogComment(e.target.value)}
                  placeholder="Описание подарка"
                  className="admin-input"
                />
              )}
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[#666] mb-2">Срок действия</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {([
                    ['next_tournament', 'Следующий турнир'],
                    ['next_month', 'Следующий месяц'],
                    ['until_date', 'До даты'],
                    ['specific_tournament', 'Конкретный турнир'],
                    ['indefinite', 'Бессрочно'],
                  ] as const).map(([v, label]) => (
                    <button key={v} type="button"
                      onClick={() => { setGiftDialogValidity(v); setGiftDialogDate(''); setGiftDialogTournamentTitle(''); }}
                      className={`rounded-xl border px-2 py-2.5 text-[11px] font-bold text-center transition-colors ${giftDialogValidity === v ? 'border-[#C0392B] bg-[#2A0C0A] text-white' : 'border-[#2D2D2D] bg-[#141414] text-[#888] hover:border-[#555]'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {giftDialogValidity === 'until_date' && (
                <input
                  type="date"
                  value={giftDialogDate}
                  onChange={e => setGiftDialogDate(e.target.value)}
                  className="admin-input"
                />
              )}
              {giftDialogValidity === 'specific_tournament' && (
                <select
                  value={giftDialogTournamentTitle}
                  onChange={e => setGiftDialogTournamentTitle(e.target.value)}
                  className="admin-input"
                >
                  <option value="">— выберите турнир —</option>
                  {[...botGames].sort((a, b) => a.date.localeCompare(b.date)).map(t => (
                    <option key={t.id} value={t.title}>{t.title} · {new Date(t.date).toLocaleDateString('ru-RU')}</option>
                  ))}
                </select>
              )}
              {giftDialogType !== 'custom' && (
                <input
                  value={giftDialogComment}
                  onChange={e => setGiftDialogComment(e.target.value)}
                  placeholder="Комментарий (необязательно)"
                  className="admin-input"
                />
              )}
            </div>
            <div className="flex gap-2 border-t border-[#2D2D2D] px-5 py-4">
              <button type="button" onClick={() => setGiftDialogPlayer(null)} disabled={giftDialogBusy} className="admin-btn-secondary flex-1 py-3 text-sm">
                Отмена
              </button>
              <button type="button" onClick={() => void handleCreateGiftSubmit()} disabled={giftDialogBusy || (giftDialogType === 'custom' && !giftDialogComment.trim()) || (giftDialogValidity === 'until_date' && !giftDialogDate) || (giftDialogValidity === 'specific_tournament' && !giftDialogTournamentTitle)} className="admin-btn-primary flex-1 py-3 text-sm disabled:opacity-40">
                {giftDialogBusy ? 'Сохранение...' : 'Выдать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SeatAssignModal({
  player,
  tableCount,
  rosterPlayers,
  busy,
  onConfirm,
  onSkip,
  onClose,
}: {
  player: LiveTournamentPlayer;
  tableCount: number;
  rosterPlayers: LiveTournamentPlayer[];
  busy: boolean;
  onConfirm: (tableNumber: number, seatNumber: number) => Promise<void>;
  onSkip: () => void;
  onClose: () => void;
}) {
  const SEATS = 9;

  const occupiedSeats = new Set(
    rosterPlayers
      .filter(p => p.arrivalStatus !== 'absent' && p.status !== 'out' && p.tableNumber && p.seatNumber)
      .map(p => `${p.tableNumber}-${p.seatNumber}`)
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-3 sm:items-center sm:p-6"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-full max-w-lg rounded-3xl border border-[#2D2D2D] bg-[#111] shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-[#2D2D2D] px-5 py-4">
          <div className="text-white font-black text-base">За какой стол посадить?</div>
          <div className="text-[#777] text-sm mt-0.5 break-words">{player.name}</div>
        </div>

        <div className="px-4 py-4 flex flex-col gap-4">
          {Array.from({ length: tableCount }, (_, i) => i + 1).map(tableNumber => (
            <div key={tableNumber}>
              <div className="text-[10px] uppercase tracking-[0.16em] text-[#555] mb-2">
                Стол {tableNumber}
              </div>
              <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-9">
                {Array.from({ length: SEATS }, (_, j) => j + 1).map(seatNumber => {
                  const taken = occupiedSeats.has(`${tableNumber}-${seatNumber}`);
                  return (
                    <button
                      key={seatNumber}
                      type="button"
                      disabled={taken || busy}
                      onClick={() => void onConfirm(tableNumber, seatNumber)}
                      className={`rounded-xl border py-2 text-xs font-bold transition-colors ${
                        taken
                          ? 'border-[#2D2D2D] bg-[#1A1A1A] text-[#444] cursor-not-allowed'
                          : 'border-[#3D3D3D] bg-[#0A0A0A] text-white hover:border-[#C0392B] hover:bg-[#2A0C0A] active:scale-95'
                      }`}
                    >
                      {seatNumber}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-[#2D2D2D] px-5 py-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="admin-btn-secondary px-4 py-3 text-sm"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="flex-1 admin-btn-secondary py-3 text-sm"
          >
            {busy ? 'Сохранение...' : 'Пропустить — без места'}
          </button>
        </div>
      </div>
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

function compareWaitlistQueue(a: LiveTournamentPlayer, b: LiveTournamentPlayer) {
  const queuedAtA = a.registeredAt ?? a.createdAt;
  const queuedAtB = b.registeredAt ?? b.createdAt;
  return queuedAtA.localeCompare(queuedAtB)
    || a.sortOrder - b.sortOrder
    || a.createdAt.localeCompare(b.createdAt)
    || a.name.localeCompare(b.name, 'ru');
}

function profileStatusLabel(status: PlayerProfileDefaultStatus): string {
  if (status === 'free') return 'Бесплатно';
  if (status === 'promo') return 'Скидка 50%';
  if (status === 'freePromo') return 'Бесп.+скидка';
  if (status === 'admin') return 'Админ';
  return '';
}

function giftTypeLabel(gift: PlayerGift): string {
  if (gift.type === 'free_entry') return 'Бесплатный вход';
  if (gift.type === 'free_rebuy') return 'Бесплатный ребай';
  if (gift.type === 'free_addon') return 'Бесплатный аддон';
  return gift.comment ?? 'Подарок';
}

function giftValidLabel(gift: PlayerGift): string {
  if (gift.validCondition === 'next_tournament') return 'На следующий турнир';
  if (gift.validCondition === 'next_month') {
    if (gift.validUntil) return `До ${new Date(gift.validUntil).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    return 'Следующий месяц';
  }
  if (gift.validCondition === 'until_date' && gift.validUntil) {
    return `До ${new Date(gift.validUntil).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  }
  if (gift.validCondition === 'specific_tournament') {
    return gift.validTournamentTitle ? gift.validTournamentTitle : 'Конкретный турнир';
  }
  return 'Бессрочно';
}

function giftBannerTone(type: PlayerGiftType): string {
  if (type === 'free_entry') return 'border-emerald-700/50 bg-emerald-950/30 text-emerald-200';
  if (type === 'free_rebuy') return 'border-amber-700/50 bg-amber-950/30 text-amber-200';
  if (type === 'free_addon') return 'border-blue-700/50 bg-blue-950/30 text-blue-200';
  return 'border-violet-700/50 bg-violet-950/30 text-violet-200';
}

function MobilePlayerCard({
  player,
  waitlistPosition,
  tournamentDate,
  earlyBirdBonusEnabled,
  rosterPlayers,
  onPlaceConflict,
  onUpdatePlayerField,
  onSetPlayerArrival,
  onRequestActivate,
  onOpenOutDialog,
  onRestorePlayer,
  onRemovePlayer,
  onShowContact,
  profileDefaultStatus,
  playerGifts,
  usedGiftIdsThisSession,
  availableGiftIds,
  onApplyGift,
  onAutoApplyGift,
  onUnredeemGift,
  onOpenGiftDialog,
}: {
  player: LiveTournamentPlayer;
  waitlistPosition: number | null;
  tournamentDate?: string | null;
  earlyBirdBonusEnabled: boolean;
  rosterPlayers: LiveTournamentPlayer[];
  onPlaceConflict: (message: string | null) => void;
  onUpdatePlayerField: (playerId: string, patch: Partial<LiveTournamentPlayer>) => Promise<boolean>;
  onSetPlayerArrival: (playerId: string, arrivalStatus: LiveTournamentArrivalStatus) => Promise<void>;
  onRequestActivate: (player: LiveTournamentPlayer) => void;
  onOpenOutDialog: (player: LiveTournamentPlayer) => void;
  onRestorePlayer: (playerId: string) => Promise<void>;
  onRemovePlayer: (player: LiveTournamentPlayer) => Promise<void>;
  onShowContact: (player: LiveTournamentPlayer) => void;
  profileDefaultStatus?: PlayerProfileDefaultStatus;
  playerGifts?: PlayerGift[];
  usedGiftIdsThisSession?: Set<string>;
  availableGiftIds?: Set<string>;
  onApplyGift?: (gift: PlayerGift) => void;
  onAutoApplyGift?: (gift: PlayerGift) => void;
  onUnredeemGift?: (gift: PlayerGift) => void;
  onOpenGiftDialog?: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [entryTypeError, setEntryTypeError] = useState<string | null>(null);
  const canEditCounters = player.arrivalStatus !== 'absent';
  const isOut = player.status === 'out';
  const isWaitlist = player.registrationSource === 'waitlist';
  const isEarlyBirdPlayer = earlyBirdBonusEnabled && player.registeredAt != null && isEarlyBird(player.registeredAt, tournamentDate);
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
      : player.arrivalStatus === 'freePromo'
        ? 'freePromo'
        : player.arrivalStatus === 'admin'
          ? 'admin'
          : 'paid';

  const handleActiveClick = async () => {
    if (isOut) {
      await onRestorePlayer(player.id);
      return;
    }

    if (player.arrivalStatus === 'absent') {
      onRequestActivate(player);
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
          <div className="flex items-center gap-1.5">
              <div className="text-white font-black text-base leading-tight break-words">{player.name}</div>
              <button
                type="button"
                onClick={() => onShowContact(player)}
                className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full border border-[#3D3D3D] text-[#888] text-[11px] hover:border-[#888] hover:text-white transition-colors"
                title="Контакты"
              >ⓘ</button>
              {onOpenGiftDialog && (
                <button
                  type="button"
                  onClick={onOpenGiftDialog}
                  className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full border border-amber-700/50 text-amber-500 text-[11px] hover:border-amber-500 hover:text-amber-300 transition-colors"
                  title="Выдать подарок"
                >+</button>
              )}
            </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <div className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${nameBadgeTone}`}>
              {nameBadgeLabel}
            </div>
            {isWaitlist && (
              <div className="inline-flex items-center rounded-full border border-amber-600/70 bg-amber-950/50 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-amber-300">
                {waitlistPosition ? `Очередь #${waitlistPosition}` : 'Waitlist'}
              </div>
            )}
            {isEarlyBirdPlayer && (
              <div className="inline-flex items-center rounded-full border border-green-600/70 bg-green-950/50 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-green-300">
                Бонус
              </div>
            )}
            {profileDefaultStatus && profileDefaultStatus !== 'paid' && player.arrivalStatus === 'absent' && (
              <div className="inline-flex items-center rounded-full border border-violet-600/70 bg-violet-950/50 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-violet-300">
                {profileStatusLabel(profileDefaultStatus)}
              </div>
            )}
          </div>
          {player.arrivalStatus !== 'absent' && !isOut && player.tableNumber != null && player.seatNumber != null && (
            <div className="mt-1 text-[10px] text-[#555]">Стол {player.tableNumber}, бокс {player.seatNumber}</div>
          )}
          {playerGifts && playerGifts.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-1">
              {playerGifts.map(gift => {
                const isUsedThisSession = usedGiftIdsThisSession?.has(gift.id);
                if (gift.status === 'redeemed' || isUsedThisSession) {
                  return (
                    <div key={gift.id} className="flex w-full items-center justify-between gap-2 rounded-lg border border-[#2D2D2D] px-2 py-1">
                      <span className="text-[10px] font-bold truncate text-[#888] opacity-50">✓ {giftTypeLabel(gift)}{isUsedThisSession && gift.status === 'active' ? ' (в этой игре)' : ''}</span>
                      {onUnredeemGift && (
                        <button type="button" onClick={() => onUnredeemGift(gift)} className="shrink-0 text-[10px] text-[#555] hover:text-[#C0392B] transition-colors" title="Отменить применение">✕</button>
                      )}
                    </div>
                  );
                }
                const isAvailable = availableGiftIds?.has(gift.id) ?? false;
                if (!isAvailable) {
                  const pendingLabel = gift.validCondition === 'next_tournament' ? 'след. турнир'
                    : gift.validCondition === 'specific_tournament' ? 'другой турнир'
                    : 'только классика';
                  return (
                    <div key={gift.id} className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1 opacity-40 ${giftBannerTone(gift.type)}`}>
                      <span className="text-[10px] font-bold truncate">{giftTypeLabel(gift)}</span>
                      <span className="shrink-0 text-[9px] opacity-70">{pendingLabel}</span>
                    </div>
                  );
                }
                return (
                  <button
                    key={gift.id}
                    type="button"
                    onClick={onApplyGift ? () => onApplyGift(gift) : undefined}
                    disabled={!onApplyGift}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1 text-left transition-opacity ${giftBannerTone(gift.type)} ${onApplyGift ? 'hover:opacity-75' : ''}`}
                  >
                    <span className="text-[10px] font-bold truncate">{giftTypeLabel(gift)}</span>
                    {onApplyGift && <span className="shrink-0 text-[10px] opacity-50">›</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 grid grid-cols-2 gap-2 min-w-[156px]">
          <div className="rounded-xl border border-[#2D2D2D] bg-[#141414] px-2 py-2 text-center">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Выбыл</div>
            <button
              type="button"
              onClick={() => onOpenOutDialog(player)}
              className={`mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-lg px-2 py-2 text-[11px] font-bold uppercase tracking-[0.08em] ${
                isOut
                  ? 'border border-[#2D2D2D] bg-[#1A1A1A] text-[#DDD]'
                  : 'bg-[#5A1712] text-[#FFD5D0]'
              }`}
            >
              {isOut ? 'Править' : 'Выбыл'}
            </button>
          </div>

          <div className="rounded-xl border border-[#2D2D2D] bg-[#141414] px-2 py-2 text-center">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Место</div>
            {isOut ? (
              <PlaceInput
                value={player.place}
                disabled={false}
                className="admin-input mt-2 !w-full !py-1.5 !px-2 !text-center !text-base font-black"
                onCommit={handlePlaceCommit}
              />
            ) : (
              <div className="mt-3 text-lg font-black text-[#777]">—</div>
            )}
          </div>
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
          onIncrease={() => {
            const freeGift = playerGifts?.find(g => g.type === 'free_rebuy' && g.status === 'active' && !usedGiftIdsThisSession?.has(g.id) && (availableGiftIds?.has(g.id) ?? true));
            if (freeGift && onAutoApplyGift) { onAutoApplyGift(freeGift); }
            else { void onUpdatePlayerField(player.id, { rebuyCount: player.rebuyCount + 1 }); }
          }}
        />
        <MobileCounter
          label="Addon"
          value={player.addonCount}
          disabled={!canEditCounters}
          onDecrease={() => void onUpdatePlayerField(player.id, { addonCount: Math.max(0, player.addonCount - 1) })}
          onIncrease={() => {
            const freeGift = playerGifts?.find(g => g.type === 'free_addon' && g.status === 'active' && !usedGiftIdsThisSession?.has(g.id) && (availableGiftIds?.has(g.id) ?? true));
            if (freeGift && onAutoApplyGift) { onAutoApplyGift(freeGift); }
            else { void onUpdatePlayerField(player.id, { addonCount: player.addonCount + 1 }); }
          }}
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
            <div>
              <MobileSelect
                label="Тип входа"
                value={entryTypeValue}
                disabled={player.arrivalStatus === 'absent' && !isOut}
                onChange={value => {
                  if (value === 'paid' || value === 'free' || value === 'promo' || value === 'freePromo' || value === 'admin') {
                    setEntryTypeError(null);
                    onSetPlayerArrival(player.id, value).catch((err: unknown) => {
                      setEntryTypeError(err instanceof Error ? err.message : String(err));
                    });
                  }
                }}
                options={[
                  { value: 'paid', label: 'Платно' },
                  { value: 'free', label: 'Бесплатно' },
                  { value: 'promo', label: 'Скидка 50%' },
                  { value: 'freePromo', label: 'Бесплатно+скидка' },
                  { value: 'admin', label: 'Админ' },
                ]}
              />
              {entryTypeError && (
                <div className="mt-1 text-xs text-red-400 break-words">{entryTypeError}</div>
              )}
              {player.arrivalStatus === 'absent' && !isOut && (
                <div className="mt-1 text-xs text-[#888]">Сначала отметьте игрока «В игре»</div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {player.paymentDue > 0 && (
                <div className="col-span-2 rounded-xl border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-[#666] mb-2">Способ оплаты</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      disabled={player.arrivalStatus === 'absent'}
                      onClick={async () => {
                        setSplitOpen(false);
                        await onUpdatePlayerField(player.id, { cashPaid: player.paymentDue, cardPaid: 0 });
                      }}
                      className={`rounded-lg border py-2 text-[11px] font-bold transition-colors ${
                        player.cashPaid > 0 && player.cardPaid === 0
                          ? 'border-[#C0392B] bg-[#2A0C0A] text-white'
                          : 'border-[#2D2D2D] bg-[#141414] text-[#888] hover:border-[#555] hover:text-white'
                      } disabled:opacity-40`}
                    >
                      Наличкой
                    </button>
                    <button
                      type="button"
                      disabled={player.arrivalStatus === 'absent'}
                      onClick={async () => {
                        setSplitOpen(false);
                        await onUpdatePlayerField(player.id, { cardPaid: player.paymentDue, cashPaid: 0 });
                      }}
                      className={`rounded-lg border py-2 text-[11px] font-bold transition-colors ${
                        player.cardPaid > 0 && player.cashPaid === 0
                          ? 'border-[#C0392B] bg-[#2A0C0A] text-white'
                          : 'border-[#2D2D2D] bg-[#141414] text-[#888] hover:border-[#555] hover:text-white'
                      } disabled:opacity-40`}
                    >
                      Картой
                    </button>
                    <button
                      type="button"
                      disabled={player.arrivalStatus === 'absent'}
                      onClick={() => setSplitOpen(o => !o)}
                      className={`rounded-lg border py-2 text-[11px] font-bold transition-colors ${
                        (player.cashPaid > 0 && player.cardPaid > 0) || splitOpen
                          ? 'border-[#C0392B] bg-[#2A0C0A] text-white'
                          : 'border-[#2D2D2D] bg-[#141414] text-[#888] hover:border-[#555] hover:text-white'
                      } disabled:opacity-40`}
                    >
                      Разделить
                    </button>
                  </div>
                  {splitOpen && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.14em] text-[#666] mb-1">Наличными</div>
                        <PaidAmountInput
                          value={player.cashPaid}
                          disabled={player.arrivalStatus === 'absent'}
                          className="w-full bg-transparent text-base font-black text-right focus:outline-none placeholder:text-[#444] disabled:text-[#444] text-white"
                          onCommit={async (value) => await onUpdatePlayerField(player.id, { cashPaid: value })}
                        />
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.14em] text-[#666] mb-1">Картой</div>
                        <PaidAmountInput
                          value={player.cardPaid}
                          disabled={player.arrivalStatus === 'absent'}
                          className="w-full bg-transparent text-base font-black text-right focus:outline-none placeholder:text-[#444] disabled:text-[#444] text-white"
                          onCommit={async (value) => await onUpdatePlayerField(player.id, { cardPaid: value })}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="rounded-xl border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">
                  К оплате{player.paymentDueOverride && <span className="ml-1 text-amber-400">✎</span>}
                </div>
                <PaymentDueInput
                  value={player.paymentDue}
                  disabled={player.arrivalStatus === 'absent'}
                  className="mt-1 w-full bg-transparent text-base font-black text-right focus:outline-none placeholder:text-[#444] disabled:text-[#444] text-white"
                  onCommit={async (value, override) =>
                    await onUpdatePlayerField(player.id, { paymentDue: value, paymentDueOverride: override })
                  }
                />
              </div>
              <div className="rounded-xl border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Бонус RC</div>
                <BonusRcInput
                  value={player.bonusRcPoints}
                  disabled={player.arrivalStatus === 'absent'}
                  className="mt-1 w-full bg-transparent text-base font-black text-right focus:outline-none placeholder:text-[#444] disabled:text-[#444] text-white"
                  onCommit={async (value) =>
                    await onUpdatePlayerField(player.id, { bonusRcPoints: value })
                  }
                />
              </div>
            </div>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => void onRemovePlayer(player)}
        className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-[#5A1712] bg-[#1A0C0A] px-3 py-2 text-sm font-bold text-[#FFD5D0] transition-colors hover:bg-[#2A0C0A]"
      >
        Удалить
      </button>
    </div>
  );
}

function PlayerRow({
  player,
  waitlistPosition,
  tournamentDate,
  earlyBirdBonusEnabled,
  rosterPlayers,
  onPlaceConflict,
  onUpdatePlayerField,
  onSetPlayerArrival,
  onOpenOutDialog,
  onRestorePlayer,
  onRemovePlayer,
  onShowContact,
  onRequestActivate,
  profileDefaultStatus,
  playerGifts,
  usedGiftIdsThisSession,
  availableGiftIds,
  onApplyGift,
  onAutoApplyGift,
  onUnredeemGift,
  onOpenGiftDialog,
}: {
  player: LiveTournamentPlayer;
  waitlistPosition: number | null;
  tournamentDate?: string | null;
  earlyBirdBonusEnabled: boolean;
  rosterPlayers: LiveTournamentPlayer[];
  onPlaceConflict: (message: string | null) => void;
  onUpdatePlayerField: (playerId: string, patch: Partial<LiveTournamentPlayer>) => Promise<boolean>;
  onSetPlayerArrival: (playerId: string, arrivalStatus: LiveTournamentArrivalStatus) => Promise<void>;
  onOpenOutDialog: (player: LiveTournamentPlayer) => void;
  onRestorePlayer: (playerId: string) => Promise<void>;
  onRemovePlayer: (player: LiveTournamentPlayer) => Promise<void>;
  onShowContact: (player: LiveTournamentPlayer) => void;
  onRequestActivate: (player: LiveTournamentPlayer) => void;
  profileDefaultStatus?: PlayerProfileDefaultStatus;
  playerGifts?: PlayerGift[];
  usedGiftIdsThisSession?: Set<string>;
  availableGiftIds?: Set<string>;
  onApplyGift?: (gift: PlayerGift) => void;
  onAutoApplyGift?: (gift: PlayerGift) => void;
  onUnredeemGift?: (gift: PlayerGift) => void;
  onOpenGiftDialog?: () => void;
}) {
  const [openField, setOpenField] = useState<'entry' | 'split' | null>(null);
  const canEditCounters = player.arrivalStatus !== 'absent';
  const isOut = player.status === 'out';
  const entryTypeLabel = player.arrivalStatus === 'promo'
    ? 'Скидка 50%'
    : player.arrivalStatus === 'free'
      ? 'Бесплатно'
      : player.arrivalStatus === 'freePromo'
        ? 'Бесплатно+скидка'
        : player.arrivalStatus === 'admin'
          ? 'Админ'
          : 'Платно';

  const toggleField = (field: typeof openField) => {
    setOpenField(current => current === field ? null : field);
  };

  const isWaitlist = player.registrationSource === 'waitlist';
  const isEarlyBirdPlayer = earlyBirdBonusEnabled && player.registeredAt != null && isEarlyBird(player.registeredAt, tournamentDate);
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
      onRequestActivate(player);
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
          <div className="flex items-center gap-1">
              <div className="text-white font-black text-[11px] sm:text-sm truncate">{player.name}</div>
              <button
                type="button"
                onClick={() => onShowContact(player)}
                className="shrink-0 inline-flex items-center justify-center w-4 h-4 sm:w-5 sm:h-5 rounded-full border border-[#3D3D3D] text-[#888] text-[9px] sm:text-[11px] hover:border-[#888] hover:text-white transition-colors"
                title="Контакты"
              >ⓘ</button>
              {onOpenGiftDialog && (
                <button
                  type="button"
                  onClick={onOpenGiftDialog}
                  className="shrink-0 inline-flex items-center justify-center w-4 h-4 sm:w-5 sm:h-5 rounded-full border border-amber-700/50 text-amber-500 text-[9px] sm:text-[11px] hover:border-amber-500 hover:text-amber-300 transition-colors"
                  title="Выдать подарок"
                >+</button>
              )}
            </div>
          <div className="flex flex-wrap gap-1">
            <div className={`inline-flex w-fit items-center rounded-full border px-1.5 py-0.5 text-[8px] sm:px-2 sm:text-[9px] uppercase tracking-[0.12em] sm:tracking-[0.14em] ${nameBadgeTone}`}>
              {nameBadgeLabel}
            </div>
            {isWaitlist && (
              <div className="inline-flex w-fit items-center rounded-full border border-amber-600/70 bg-amber-950/50 px-1.5 py-0.5 text-[8px] sm:px-2 sm:text-[9px] uppercase tracking-[0.12em] sm:tracking-[0.14em] text-amber-300">
                {waitlistPosition ? `Очередь #${waitlistPosition}` : 'Waitlist'}
              </div>
            )}
            {isEarlyBirdPlayer && (
              <div className="inline-flex w-fit items-center rounded-full border border-green-600/70 bg-green-950/50 px-1.5 py-0.5 text-[8px] sm:px-2 sm:text-[9px] uppercase tracking-[0.12em] sm:tracking-[0.14em] text-green-300">
                Бонус
              </div>
            )}
            {profileDefaultStatus && profileDefaultStatus !== 'paid' && player.arrivalStatus === 'absent' && (
              <div className="inline-flex w-fit items-center rounded-full border border-violet-600/70 bg-violet-950/50 px-1.5 py-0.5 text-[8px] sm:px-2 sm:text-[9px] uppercase tracking-[0.12em] sm:tracking-[0.14em] text-violet-300">
                {profileStatusLabel(profileDefaultStatus)}
              </div>
            )}
            <button
              type="button"
              onClick={() => void onRemovePlayer(player)}
              className="inline-flex w-fit items-center rounded-full border border-[#5A1712] bg-[#1A0C0A] px-1.5 py-0.5 text-[8px] uppercase tracking-[0.12em] text-[#FFD5D0] transition-colors hover:bg-[#2A0C0A] sm:px-2 sm:text-[9px]"
            >
              Удалить
            </button>
          </div>
          {player.arrivalStatus !== 'absent' && !isOut && player.tableNumber != null && player.seatNumber != null && (
            <div className="text-[8px] sm:text-[9px] text-[#555]">Стол {player.tableNumber}, бокс {player.seatNumber}</div>
          )}
          {playerGifts && playerGifts.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {playerGifts.map(gift => {
                const isUsedThisSession = usedGiftIdsThisSession?.has(gift.id);
                if (gift.status === 'redeemed' || isUsedThisSession) {
                  return (
                    <div key={gift.id} className="flex w-full items-center justify-between gap-1 rounded-md border border-[#2D2D2D] px-1 py-0.5">
                      <span className="text-[7px] sm:text-[8px] uppercase tracking-[0.08em] truncate text-[#888] opacity-50">✓ {giftTypeLabel(gift)}{isUsedThisSession && gift.status === 'active' ? ' (эта игра)' : ''}</span>
                      {onUnredeemGift && (
                        <button type="button" onClick={() => onUnredeemGift(gift)} className="shrink-0 text-[9px] text-[#555] hover:text-[#C0392B] transition-colors" title="Отменить">✕</button>
                      )}
                    </div>
                  );
                }
                const isAvailable = availableGiftIds?.has(gift.id) ?? false;
                if (!isAvailable) {
                  const pendingLabel = gift.validCondition === 'next_tournament' ? 'след. турнир'
                    : gift.validCondition === 'specific_tournament' ? 'другой турнир'
                    : 'классика';
                  return (
                    <div key={gift.id} className={`flex w-full items-center justify-between gap-1 rounded-md border px-1 py-0.5 opacity-40 ${giftBannerTone(gift.type)}`}>
                      <span className="text-[7px] sm:text-[8px] uppercase tracking-[0.08em] truncate">{giftTypeLabel(gift)}</span>
                      <span className="shrink-0 text-[7px] opacity-70">{pendingLabel}</span>
                    </div>
                  );
                }
                return (
                  <button
                    key={gift.id}
                    type="button"
                    onClick={onApplyGift ? () => onApplyGift(gift) : undefined}
                    disabled={!onApplyGift}
                    className={`flex w-full items-center justify-between gap-1 rounded-md border px-1 py-0.5 text-left transition-opacity ${giftBannerTone(gift.type)} ${onApplyGift ? 'hover:opacity-75' : ''}`}
                  >
                    <span className="text-[7px] sm:text-[8px] uppercase tracking-[0.08em] truncate">{giftTypeLabel(gift)}</span>
                    {onApplyGift && <span className="shrink-0 text-[8px] opacity-50">›</span>}
                  </button>
                );
              })}
            </div>
          )}
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
            onClick={() => {
              const freeGift = playerGifts?.find(g => g.type === 'free_rebuy' && g.status === 'active' && !usedGiftIdsThisSession?.has(g.id) && (availableGiftIds?.has(g.id) ?? true));
              if (freeGift && onAutoApplyGift) { onAutoApplyGift(freeGift); }
              else { void onUpdatePlayerField(player.id, { rebuyCount: player.rebuyCount + 1 }); }
            }}
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
            onClick={() => {
              const freeGift = playerGifts?.find(g => g.type === 'free_addon' && g.status === 'active' && !usedGiftIdsThisSession?.has(g.id) && (availableGiftIds?.has(g.id) ?? true));
              if (freeGift && onAutoApplyGift) { onAutoApplyGift(freeGift); }
              else { void onUpdatePlayerField(player.id, { addonCount: player.addonCount + 1 }); }
            }}
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
        <BonusRcInput
          value={player.bonusRcPoints}
          disabled={!canEditCounters}
          className="admin-input !w-full !py-1 !px-1 !text-[10px] sm:!text-[11px] text-center font-black disabled:opacity-30"
          onCommit={async (value) => await onUpdatePlayerField(player.id, { bonusRcPoints: value })}
        />
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
                Скидка 50%
              </MiniChoice>
              <MiniChoice active={player.arrivalStatus === 'freePromo'} onClick={async () => {
                await onSetPlayerArrival(player.id, 'freePromo');
                setOpenField(null);
              }}>
                Бесплатно+скидка
              </MiniChoice>
              <MiniChoice active={player.arrivalStatus === 'admin'} onClick={async () => {
                await onSetPlayerArrival(player.id, 'admin');
                setOpenField(null);
              }}>
                Админ
              </MiniChoice>
            </div>
          )}
          {player.paymentDue > 0 && (
            <div className="flex flex-col gap-1">
              <div className="grid grid-cols-3 gap-0.5">
                <MiniChoice
                  active={player.cashPaid > 0 && player.cardPaid === 0}
                  centered
                  onClick={async () => {
                    setOpenField(f => f === 'split' ? null : f);
                    await onUpdatePlayerField(player.id, { cashPaid: player.paymentDue, cardPaid: 0 });
                  }}
                >
                  Нал
                </MiniChoice>
                <MiniChoice
                  active={player.cardPaid > 0 && player.cashPaid === 0}
                  centered
                  onClick={async () => {
                    setOpenField(f => f === 'split' ? null : f);
                    await onUpdatePlayerField(player.id, { cardPaid: player.paymentDue, cashPaid: 0 });
                  }}
                >
                  Карта
                </MiniChoice>
                <MiniChoice
                  active={(player.cashPaid > 0 && player.cardPaid > 0) || openField === 'split'}
                  centered
                  onClick={() => setOpenField(f => f === 'split' ? null : 'split')}
                >
                  Сплит
                </MiniChoice>
              </div>
              {openField === 'split' && (
                <div className="flex gap-0.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-[7px] sm:text-[8px] uppercase text-[#555] text-center mb-0.5">нал</div>
                    <PaidAmountInput
                      value={player.cashPaid}
                      disabled={player.arrivalStatus === 'absent'}
                      className="admin-input !w-full !py-0.5 !px-1 !text-[9px] sm:!text-[10px] text-center disabled:opacity-40"
                      onCommit={async (v) => await onUpdatePlayerField(player.id, { cashPaid: v })}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[7px] sm:text-[8px] uppercase text-[#555] text-center mb-0.5">карта</div>
                    <PaidAmountInput
                      value={player.cardPaid}
                      disabled={player.arrivalStatus === 'absent'}
                      className="admin-input !w-full !py-0.5 !px-1 !text-[9px] sm:!text-[10px] text-center disabled:opacity-40"
                      onCommit={async (v) => await onUpdatePlayerField(player.id, { cardPaid: v })}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="text-[8px] sm:text-[10px] leading-tight text-center sm:text-left uppercase tracking-[0.08em] sm:tracking-widest text-[#777]">
            <PaymentDueInput
              value={player.paymentDue}
              disabled={player.arrivalStatus === 'absent'}
              className="w-full bg-transparent text-center sm:text-left font-bold text-white focus:outline-none placeholder:text-[#444] disabled:text-[#555]"
              onCommit={async (value, override) =>
                await onUpdatePlayerField(player.id, { paymentDue: value, paymentDueOverride: override })
              }
            />
            {player.paymentDueOverride && <span className="text-amber-400 text-[8px]">✎</span>}
          </div>
        </div>
      </td>
    </tr>
  );
}

function PaidAmountInput({
  value,
  disabled,
  className,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  className: string;
  onCommit: (value: number) => Promise<boolean>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current || !inputRef.current) return;
    inputRef.current.value = value > 0 ? String(value) : '';
  }, [value]);

  useEffect(() => {
    if (!inputRef.current || focusedRef.current) return;
    if (disabled) inputRef.current.value = '';
  }, [disabled]);

  return (
    <input
      ref={inputRef}
      type="number"
      min="0"
      disabled={disabled}
      defaultValue={value > 0 ? String(value) : ''}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={async event => {
        focusedRef.current = false;
        if (disabled) { event.currentTarget.value = ''; return; }
        const raw = event.currentTarget.value.trim();
        const nextValue = raw ? Math.max(0, Math.round(Number(raw) || 0)) : 0;
        const ok = await onCommit(nextValue);
        event.currentTarget.value = ok && nextValue > 0 ? String(nextValue) : (value > 0 ? String(value) : '');
      }}
      className={className}
      placeholder={disabled ? '—' : '0'}
      inputMode="numeric"
    />
  );
}

function BonusRcInput({
  value,
  disabled,
  className,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  className: string;
  onCommit: (value: number) => Promise<boolean>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current || !inputRef.current) return;
    inputRef.current.value = value > 0 ? String(value) : '';
  }, [value]);

  useEffect(() => {
    if (!inputRef.current || focusedRef.current) return;
    if (disabled) inputRef.current.value = '';
  }, [disabled]);

  return (
    <input
      ref={inputRef}
      type="number"
      min="0"
      disabled={disabled}
      defaultValue={value > 0 ? String(value) : ''}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={async event => {
        focusedRef.current = false;
        if (disabled) { event.currentTarget.value = ''; return; }
        const raw = event.currentTarget.value.trim();
        const nextValue = raw ? Math.max(0, Math.round(Number(raw) || 0)) : 0;
        const ok = await onCommit(nextValue);
        event.currentTarget.value = ok && nextValue > 0 ? String(nextValue) : (value > 0 ? String(value) : '');
      }}
      className={className}
      placeholder={disabled ? '—' : '0'}
      inputMode="numeric"
    />
  );
}

function PaymentDueInput({
  value,
  disabled,
  className,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  className: string;
  onCommit: (value: number, override: boolean) => Promise<boolean>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current || !inputRef.current) return;
    inputRef.current.value = value > 0 ? String(value) : '';
  }, [value]);

  useEffect(() => {
    if (!inputRef.current || focusedRef.current) return;
    if (disabled) inputRef.current.value = '';
  }, [disabled]);

  return (
    <input
      ref={inputRef}
      type="number"
      disabled={disabled}
      defaultValue={value > 0 ? String(value) : ''}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={async event => {
        focusedRef.current = false;
        if (disabled) { event.currentTarget.value = ''; return; }
        const raw = event.currentTarget.value.trim();
        if (!raw || Number(raw) <= 0) {
          const ok = await onCommit(0, false);
          event.currentTarget.value = ok ? '' : (value > 0 ? String(value) : '');
          return;
        }
        const nextValue = Math.round(Math.max(0, Number(raw)));
        const ok = await onCommit(nextValue, true);
        event.currentTarget.value = ok ? String(nextValue) : (value > 0 ? String(value) : '');
      }}
      className={className}
      placeholder={disabled ? '—' : String(value > 0 ? value : '—')}
      inputMode="numeric"
    />
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
  const [localValue, setLocalValue] = useState(value);
  useEffect(() => { setLocalValue(value); }, [value]);

  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.14em] text-[#666] mb-1">{label}</div>
      <select
        value={localValue}
        disabled={disabled}
        onChange={event => {
          setLocalValue(event.target.value);
          onChange(event.target.value);
        }}
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
