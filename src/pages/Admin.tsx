import React, { useState, useEffect, useRef, useCallback, useMemo, Component } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { useGameState } from '../hooks/useGameState';
import { useTournamentBotLiveSync } from '../hooks/useTournamentBotLiveSync';
import { useTournamentPlayers } from '../hooks/useTournamentPlayers';
import { supabase } from '../supabase';
import { getNextGarageBlindPair } from '../blindStructure';
import {
  getKnockoutLabel,
  getLateRegistrationLevel,
  getNextKnockoutInfo,
  setKnockoutMarker,
} from '../blindLevelMarkers';
import {
  deleteChipLeaderSubmissions,
  getChipLeaderHideAfterLevelIndex,
} from '../chipLeaderSubmissions';
import { calcTotalStack } from '../gameStateMath';
import type {
  BlindLevel,
  BlindTemplate,
  Combination,
  Card,
  Suit,
  Rank,
  TournamentArchiveDetails,
  TournamentArchivePlayerRecord,
  TournamentRecord,
  GameState,
  ChipLeaderEntry,
  LiveTournamentPlayer,
  FloorNotification,
  PersonnelRecord,
  StaffMember,
} from '../types';
import { PersonnelForm } from '../components/PersonnelForm';
import { formatPersonnelRole, personnelTotals } from '../personnel';
import { SUIT_SYMBOLS, getRankPoints } from '../types';
import {
  buildFloorBustoutConfirmationEntries,
  deriveTournamentResultsUiState,
  getDuplicatePlaces,
  getTournamentResultsButtonLabel,
  shouldBlockNewTournamentForPendingBotResults,
} from '../tournamentResultsFlow';
import { aggregatePlayerHistory, filterByPeriod, mergeWithBotPlayerList } from '../playerHistory';
import type { MergedPlayerAggregate, PeriodFilter, PlayerAggregate } from '../playerHistory';
import { fetchBotPlayerList } from '../tournamentBotApi';
import type { BotPlayerListItem } from '../tournamentBotApi';
import { matchesSearchQuery } from '../searchUtils';
import * as XLSX from 'xlsx';
import { PokerCard } from '../components/PokerCard';
import { TournamentPlayersTab } from '../components/TournamentPlayersTab';
import { TablesTab } from '../components/TablesTab';
import { NotificationsTab } from '../components/NotificationsTab';
import { useFloorNotifications } from '../hooks/useFloorNotifications';
import {
  buildBlindTemplate,
  deleteSharedBlindTemplates,
  fetchSharedBlindTemplates,
  isSharedBlindTemplateLibraryEnabled,
  loadBlindTemplates,
  mergeBlindTemplates,
  PRESET_BLIND_TEMPLATES,
  saveBlindTemplates,
  upsertSharedBlindTemplate,
} from '../blindTemplateLibrary';
import {
  createBackgroundFromFile,
  deleteSharedBackgrounds,
  fetchSharedBackgroundLibrary,
  isSharedBackgroundLibraryEnabled,
  loadBackgroundLibrary,
  mergeBackgroundLibraries,
  PRESET_BACKGROUNDS,
  saveBackgroundLibrary,
  upsertSharedBackgrounds,
} from '../backgroundLibrary';
import type { StoredBackground } from '../backgroundLibrary';
import {
  DISPLAY_PRESENCE_ONLINE_MS,
  fetchDisplayClients,
  isDisplayPresenceEnabled,
} from '../displayPresence';
import type { DisplayClient } from '../displayPresence';
import {
  createStaffMember,
  deleteStaffMember,
  deletePersonnelDraft,
  fetchPersonnelDraft,
  fetchStaffDirectory,
  isPersonnelDraftRowId,
  loadLocalStaffDirectory,
  mergePersonnelRecords,
  savePersonnelDraft,
  saveStaffMember,
} from '../staffDirectory';

// ─── Error Boundary ────────────────────────────────────────────────────────
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message + '\n' + err.stack : String(err) };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center px-4">
          <div className="bg-red-950 border border-red-700 rounded-2xl p-6 w-full max-w-lg">
            <div className="text-red-400 font-bold text-lg mb-3">Ошибка рендера</div>
            <pre className="text-red-300 text-xs whitespace-pre-wrap break-all">{this.state.error}</pre>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-4 admin-btn-primary px-4 py-2 text-sm"
            >Попробовать снова</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const BOT_API = import.meta.env.VITE_BOT_API_URL || 'https://web-production-6035.up.railway.app';

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || 'poker2024';
const ARCHIVE_PASSWORD = import.meta.env.VITE_ARCHIVE_PASSWORD || 'garage1409';
const MAX_BACKGROUND_ITEMS = 24;
const SHARED_LIBRARY_TIMEOUT_MS = 20_000;
const SHARED_LIBRARY_RETRY_COUNT = 2;
const ADMIN_AUTH_STORAGE_KEY = 'admin_authed';
const ARCHIVE_AUTH_STORAGE_KEY = 'archive_authed';
const DISPLAY_CLIENTS_REFRESH_MS = 3_000;
const BOT_PLAYER_LIST_CACHE_KEY = 'poker_bot_player_list_cache';
const BOT_PLAYER_LIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type BotPlayerListCache = { players: BotPlayerListItem[]; cachedAt: string };

function loadBotPlayerListCache(): BotPlayerListCache | null {
  try {
    const raw = localStorage.getItem(BOT_PLAYER_LIST_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BotPlayerListCache>;
    if (!Array.isArray(parsed?.players) || typeof parsed?.cachedAt !== 'string') return null;
    return { players: parsed.players, cachedAt: parsed.cachedAt };
  } catch {
    return null;
  }
}

function saveBotPlayerListCache(players: BotPlayerListItem[]): string {
  const cachedAt = new Date().toISOString();
  try {
    localStorage.setItem(BOT_PLAYER_LIST_CACHE_KEY, JSON.stringify({ players, cachedAt }));
  } catch {
    // ignore storage quota errors
  }
  return cachedAt;
}

function isBotPlayerListCacheStale(cachedAt: string): boolean {
  return Date.now() - new Date(cachedAt).getTime() > BOT_PLAYER_LIST_CACHE_TTL_MS;
}

type BotGameSummary = {
  id: number;
  title: string;
  date: string;
  format?: string;
  buy_in?: number;
  confirmed: number;
  max_players: number;
  status?: string;
};

type TournamentResultsNotice = {
  tone: 'success' | 'error' | 'warning';
  text: string;
} | null;

type TournamentResultsDispatchOutcome = {
  ok: boolean;
  skipped: boolean;
  cancelled: boolean;
  error: string | null;
  resent: boolean;
  financeError: string | null;
  financeSkipped: boolean;
};

type AdminTab = 'control' | 'players' | 'blinds' | 'combos' | 'archive' | 'settings' | 'tables' | 'notifications';

type ChipLeaderDraftRow = {
  id: string;
  playerId: string;
  name: string;
  stack: string;
};

type ChipLeaderDraftOverride = {
  levelIndex: number;
  rows: ChipLeaderDraftRow[];
} | null;

const CHIP_LEADER_ROW_IDS = ['chip-1', 'chip-2', 'chip-3'] as const;

type PendingTournamentSelection = {
  title: string;
  botId: number | null;
  buyIn?: number | null;
};

function isPassiveBotPlayerForUpcomingGame(player: {
  source: string;
  arrivalStatus: string;
  status: string;
  rebuyCount: number;
  addonCount: number;
  bonusCount: number;
  bounty: number;
  paymentDue: number;
  cashPaid: number;
  cardPaid: number;
  place: number | null;
  bustoutOrder: number | null;
}) {
  return (
    player.source === 'bot' &&
    player.arrivalStatus === 'absent' &&
    player.status !== 'out' &&
    player.rebuyCount === 0 &&
    player.addonCount === 0 &&
    player.bonusCount === 0 &&
    player.bounty === 0 &&
    player.paymentDue === 0 &&
    player.cashPaid === 0 &&
    player.cardPaid === 0 &&
    player.place === null &&
    player.bustoutOrder === null
  );
}

function hasLiveTournamentProgress(player: {
  arrivalStatus: string;
  status: string;
  rebuyCount: number;
  addonCount: number;
  bonusCount: number;
  bounty: number;
  paymentDue: number;
  cashPaid: number;
  cardPaid: number;
  place: number | null;
  bustoutOrder: number | null;
}) {
  return (
    player.arrivalStatus !== 'absent' ||
    player.status === 'out' ||
    player.rebuyCount > 0 ||
    player.addonCount > 0 ||
    player.bonusCount > 0 ||
    player.bounty > 0 ||
    player.paymentDue > 0 ||
    player.cashPaid > 0 ||
    player.cardPaid > 0 ||
    player.place !== null ||
    player.bustoutOrder !== null
  );
}

function formatNextGameFallback(game: { title: string; date: string; confirmed: number; max_players: number }) {
  const d = new Date(game.date);
  const dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const timeStr = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${game.title}\n${dateStr} · ${timeStr}\n${game.confirmed} / ${game.max_players} мест`;
}

function createBlankChipLeaderDraft(): ChipLeaderDraftRow[] {
  return CHIP_LEADER_ROW_IDS.map(id => ({ id, playerId: '', name: '', stack: '' }));
}

function chipLeaderDraftFromEntries(entries: ChipLeaderEntry[]): ChipLeaderDraftRow[] {
  const blank = createBlankChipLeaderDraft();
  entries.slice(0, 3).forEach((entry, index) => {
    blank[index] = {
      id: entry.id || CHIP_LEADER_ROW_IDS[index],
      playerId: entry.playerId,
      name: entry.name,
      stack: entry.stack > 0 ? String(entry.stack) : '',
    };
  });
  return blank;
}

function isDisplayClientOnline(client: DisplayClient, now = Date.now()) {
  const seenAt = Date.parse(client.lastSeenAt);
  return Number.isFinite(seenAt) && now - seenAt <= DISPLAY_PRESENCE_ONLINE_MS;
}

function formatPresenceAge(iso: string, now = Date.now()) {
  const seenAt = Date.parse(iso);
  if (!Number.isFinite(seenAt)) return 'нет данных';

  const seconds = Math.max(0, Math.floor((now - seenAt) / 1000));
  if (seconds < 60) return `${seconds} сек назад`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;

  const hours = Math.floor(minutes / 60);
  return `${hours} ч назад`;
}

function formatDisplayStatus(status: GameState['status']) {
  const labels: Record<GameState['status'], string> = {
    idle: 'ожидает',
    running: 'идёт',
    paused: 'пауза',
    break: 'перерыв',
    ended: 'завершён',
  };
  return labels[status];
}

function isActiveChipLeaderCandidate(player: LiveTournamentPlayer) {
  return player.status === 'active' && player.arrivalStatus !== 'absent';
}

function formatApproxTimeFromNow(secondsFromNow: number) {
  return new Date(Date.now() + Math.max(0, secondsFromNow) * 1000).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}. Нет ответа от Supabase дольше ${Math.round(timeoutMs / 1000)} сек.`));
    }, timeoutMs);

    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getTabletAdminLayoutMatch() {
  if (typeof window === 'undefined') return false;

  const width = window.innerWidth;
  const inTabletWidthRange = width >= 768 && width <= 1180;
  const coarsePointer = typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false;

  return inTabletWidthRange || (coarsePointer && width >= 768 && width <= 1366);
}

function useTabletAdminLayout() {
  const [tabletLayout, setTabletLayout] = useState(getTabletAdminLayoutMatch);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const coarsePointerQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)')
      : null;
    const update = () => setTabletLayout(getTabletAdminLayoutMatch());

    update();
    window.addEventListener('resize', update);

    if (coarsePointerQuery) {
      if (typeof coarsePointerQuery.addEventListener === 'function') {
        coarsePointerQuery.addEventListener('change', update);
      } else if (typeof coarsePointerQuery.addListener === 'function') {
        coarsePointerQuery.addListener(update);
      }
    }

    return () => {
      window.removeEventListener('resize', update);
      if (!coarsePointerQuery) return;

      if (typeof coarsePointerQuery.removeEventListener === 'function') {
        coarsePointerQuery.removeEventListener('change', update);
      } else if (typeof coarsePointerQuery.removeListener === 'function') {
        coarsePointerQuery.removeListener(update);
      }
    };
  }, []);

  return tabletLayout;
}

function formatArchiveArrivalStatus(value: TournamentArchivePlayerRecord['arrivalStatus']) {
  if (value === 'free') return 'Бесплатно';
  if (value === 'promo') return 'Скидка 50%';
  if (value === 'paid') return 'Платно';
  if (value === 'freePromo') return 'Бесплатно+скидка';
  if (value === 'admin') return 'Админ';
  return 'Не в игре';
}

function formatArchivePayment(player: TournamentArchivePlayerRecord) {
  if (player.cashPaid != null || player.cardPaid != null) {
    const cash = player.cashPaid ?? 0;
    const card = player.cardPaid ?? 0;
    if (cash > 0 && card > 0) return `нал ${cash.toLocaleString('ru-RU')} ₽ + карта ${card.toLocaleString('ru-RU')} ₽`;
    if (cash > 0) return `нал ${cash.toLocaleString('ru-RU')} ₽`;
    if (card > 0) return `карта ${card.toLocaleString('ru-RU')} ₽`;
    return 'Не оплачено';
  }
  // legacy fallback
  if (player.paymentMethod === 'cash') return 'Наличные';
  if (player.paymentMethod === 'card') return 'Карта';
  return 'Не оплачено';
}

function formatArchiveStatus(player: TournamentArchivePlayerRecord) {
  if (player.status === 'out') return 'Выбыл';
  if (player.arrivalStatus === 'absent') return 'Не в игре';
  if (player.status === 'waitlist') return 'Waitlist';
  return 'В игре';
}

function sortArchivePlayers(players: TournamentArchivePlayerRecord[]) {
  return [...players].sort((a, b) => {
    if (a.place !== null && b.place !== null) return a.place - b.place;
    if (a.place !== null) return -1;
    if (b.place !== null) return 1;
    if (a.status === 'out' && b.status !== 'out') return 1;
    if (a.status !== 'out' && b.status === 'out') return -1;
    return a.name.localeCompare(b.name, 'ru');
  });
}

function loadAdminAuthFlag() {
  try {
    return sessionStorage.getItem(ADMIN_AUTH_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveAdminAuthFlag() {
  try {
    sessionStorage.setItem(ADMIN_AUTH_STORAGE_KEY, '1');
  } catch (error) {
    console.warn('Failed to persist admin auth flag in sessionStorage', error);
  }
}

function loadArchiveAuthFlag() {
  try {
    return sessionStorage.getItem(ARCHIVE_AUTH_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveArchiveAuthFlag() {
  try {
    sessionStorage.setItem(ARCHIVE_AUTH_STORAGE_KEY, '1');
  } catch (error) {
    console.warn('Failed to persist archive auth flag in sessionStorage', error);
  }
}

async function withRetries<T>(
  run: () => Promise<T>,
  timeoutMs: number,
  label: string,
  attempts: number
): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await withTimeout(run(), timeoutMs, label);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await wait(750);
      }
    }
  }

  throw lastError ?? new Error(label);
}

// ─── Card picker ──────────────────────────────────────────────────────────
const RANKS: Rank[] = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];
const SUITS: Suit[] = ['spades','hearts','diamonds','clubs','any'];

function CardPicker({ onAdd }: { onAdd: (card: Card) => void }) {
  const [rank, setRank] = useState<Rank>('A');
  const [suit, setSuit] = useState<Suit>('spades');

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={rank}
        onChange={e => setRank(e.target.value as Rank)}
        className="admin-input w-16"
      >
        {RANKS.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <select
        value={suit}
        onChange={e => setSuit(e.target.value as Suit)}
        className="admin-input w-28"
      >
        {SUITS.map(s => (
          <option key={s} value={s}>
            {s === 'any' ? '♠♥♦♣ любая масть' : `${SUIT_SYMBOLS[s]} ${s}`}
          </option>
        ))}
      </select>
      <button
        onClick={() => onAdd({ rank, suit })}
        className="admin-btn-primary px-3 py-2 text-sm"
      >
        + Добавить карту
      </button>
    </div>
  );
}

// ─── Blind level row ──────────────────────────────────────────────────────
function BlindRow({
  level,
  onChange,
  onDelete,
}: {
  level: BlindLevel;
  onChange: (l: BlindLevel) => void;
  onDelete: () => void;
}) {
  const upd = (patch: Partial<BlindLevel>) => onChange({ ...level, ...patch });
  const [sbDraft, setSbDraft] = useState(String(level.sb));
  const [bbDraft, setBbDraft] = useState(String(level.bb));
  const [minutesDraft, setMinutesDraft] = useState(String(Math.round(level.duration / 60)));
  const knockoutLabel = getKnockoutLabel(level);
  const knockoutEnabled = Boolean(knockoutLabel);

  const parseDraftNumber = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') return null;

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;

    return Math.max(0, Math.round(parsed));
  };

  const commitMinutes = () => {
    const nextMinutes = parseDraftNumber(minutesDraft);
    if (nextMinutes === null) {
      setMinutesDraft(String(Math.round(level.duration / 60)));
      return;
    }

    const normalizedMinutes = Math.max(1, nextMinutes);
    setMinutesDraft(String(normalizedMinutes));
    upd({ duration: normalizedMinutes * 60 });
  };

  if (level.isBreak) {
    return (
      <div className="bg-blue-900/20 border border-blue-700/30 rounded-xl p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-blue-400 text-xs font-bold uppercase tracking-wider">Перерыв</span>
          <button onClick={onDelete} className="admin-btn-danger px-3 py-2 text-sm">✕</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input className="admin-input" placeholder="Название" value={level.breakLabel || ''}
            onChange={e => upd({ breakLabel: e.target.value })} />
          <div className="flex items-center gap-1">
            <input
              type="text"
              inputMode="numeric"
              className="admin-input"
              placeholder="мин"
              value={minutesDraft}
              onChange={e => setMinutesDraft(e.target.value)}
              onBlur={commitMinutes}
              onKeyDown={e => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            />
            <span className="text-[#555] text-xs flex-shrink-0">мин</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#111] border border-[#2D2D2D] rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[#666] text-xs">Ур. {level.level}</span>
          {knockoutEnabled && (
            <span className="rounded-full border border-[#C0392B]/40 bg-[#1a0a00] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[#E31E24]">
              Игра на вылет / поздняя рег.
            </span>
          )}
        </div>
        <button onClick={onDelete} className="admin-btn-danger px-3 py-2 text-sm">✕</button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <div className="text-[#555] text-[10px] uppercase tracking-wider mb-1">SB</div>
          <input
            type="text"
            inputMode="numeric"
            className="admin-input text-sm px-2"
            value={sbDraft}
            onChange={e => setSbDraft(e.target.value)}
            onBlur={() => {
              const nextSb = parseDraftNumber(sbDraft);
              if (nextSb === null) {
                setSbDraft(String(level.sb));
                return;
              }

              setSbDraft(String(nextSb));
              upd({ sb: nextSb });
            }}
            onKeyDown={e => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
        </div>
        <div>
          <div className="text-[#555] text-[10px] uppercase tracking-wider mb-1">BB</div>
          <input
            type="text"
            inputMode="numeric"
            className="admin-input text-sm px-2"
            value={bbDraft}
            onChange={e => setBbDraft(e.target.value)}
            onBlur={() => {
              const nextBb = parseDraftNumber(bbDraft);
              if (nextBb === null) {
                setBbDraft(String(level.bb));
                return;
              }

              setBbDraft(String(nextBb));
              upd({ bb: nextBb, ante: level.ante > 0 ? nextBb : 0 });
            }}
            onKeyDown={e => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
        </div>
        <div>
          <div className="text-[#555] text-[10px] uppercase tracking-wider mb-1">Мин</div>
          <input
            type="text"
            inputMode="numeric"
            className="admin-input text-sm px-2"
            value={minutesDraft}
            onChange={e => setMinutesDraft(e.target.value)}
            onBlur={commitMinutes}
            onKeyDown={e => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between rounded-xl border border-[#1F1F1F] bg-[#0A0A0A] px-3 py-2">
        <div>
          <div className="text-white text-sm font-medium">Игра на вылет и поздняя регистрация</div>
          <div className="text-[#666] text-xs">Этот уровень отмечает начало игры на вылет и точку закрытия поздней регистрации.</div>
        </div>
        <button
          type="button"
          onClick={() => onChange(setKnockoutMarker(level, !knockoutEnabled, knockoutLabel || 'Игра на вылет'))}
          className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide transition-colors ${
            knockoutEnabled
              ? 'bg-[#C0392B] text-white'
              : 'bg-[#1E1E1E] text-[#777] hover:text-white'
          }`}
        >
          {knockoutEnabled ? 'Вкл' : 'Выкл'}
        </button>
      </div>
    </div>
  );
}

// ─── Main Admin page ───────────────────────────────────────────────────────
export function Admin() {
  const tabletAdminLayout = useTabletAdminLayout();
  const sharedBackgroundLibraryEnabled = isSharedBackgroundLibraryEnabled();
  const sharedBlindTemplateLibraryEnabled = isSharedBlindTemplateLibraryEnabled();
  const [authed, setAuthed] = useState(loadAdminAuthFlag);
  const [archiveAuthed, setArchiveAuthed] = useState(loadArchiveAuthFlag);
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState(false);
  const [archivePwInput, setArchivePwInput] = useState('');
  const [archivePwError, setArchivePwError] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('control');
  const [gamePickerOpen, setGamePickerOpen] = useState(false);
  const [customGameOpen, setCustomGameOpen] = useState(false);
  const [pendingGameSwitch, setPendingGameSwitch] = useState<{ title: string; botId: number | null; buyIn: number | null } | null>(null);
  const [customGameTitle, setCustomGameTitle] = useState('');
  const [nextGamePickerOpen, setNextGamePickerOpen] = useState(false);
  const [blindTemplates, setBlindTemplates] = useState<BlindTemplate[]>(() => loadBlindTemplates());
  const [templateName, setTemplateName] = useState('');
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateNote, setTemplateNote] = useState<string | null>(null);
  const [chipLeaderSaveError, setChipLeaderSaveError] = useState<string | null>(null);
  const [chipLeaderSaveNote, setChipLeaderSaveNote] = useState<string | null>(null);
  const [backgroundLibrary, setBackgroundLibrary] = useState<StoredBackground[]>(() => loadBackgroundLibrary());
  const [backgroundUploadBusy, setBackgroundUploadBusy] = useState(false);
  const [backgroundUploadError, setBackgroundUploadError] = useState<string | null>(null);
  const [backgroundUploadNote, setBackgroundUploadNote] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [chipLeaderDraftOverride, setChipLeaderDraftOverride] = useState<ChipLeaderDraftOverride>(null);
  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ── Drag state for blind levels ────────────────────────────────────────
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropLine, setDropLine] = useState<number | null>(null);
  const rowEls = useRef<(HTMLDivElement | null)[]>([]);
  const dragging = useRef(false);
  const blindTemplatesRef = useRef(blindTemplates);
  const backgroundLibraryRef = useRef(backgroundLibrary);

  const {
    gameState, blindLevels, combinations, syncReady, authoritativeReady, syncError, getAuthoritativeNow, retrySync,
    updateGameState, forceSyncDisplays, startTimer, pauseTimer, nextLevel, prevLevel, resetTournament,
    updateBlindLevels, updateCombinations, saveTournament, fetchTournaments, fetchTournamentArchiveDetails, fetchTournamentArchiveDetailsBatch, updateTournamentArchiveDetails, deleteTournament,
  } = useGameState();
  const gameStateSnapshotRef = useRef(gameState);
  const displayPresenceEnabled = isDisplayPresenceEnabled();
  const [displayClients, setDisplayClients] = useState<DisplayClient[]>([]);
  const [displayClientsError, setDisplayClientsError] = useState<string | null>(null);
  const [displayClientsCollapsed, setDisplayClientsCollapsed] = useState(false);
  const [displayForceSyncBusy, setDisplayForceSyncBusy] = useState(false);
  const [displayForceSyncResult, setDisplayForceSyncResult] = useState<'ok' | 'error' | null>(null);
  const [presenceNow, setPresenceNow] = useState(() => Date.now());

  const [tournaments, setTournaments] = useState<TournamentRecord[]>([]);
  const [archiveDetailsById, setArchiveDetailsById] = useState<Record<number, TournamentArchiveDetails | null>>({});
  const [archiveSubTab, setArchiveSubTab] = useState<'games' | 'players' | 'salary' | 'staff'>('games');
  const [playerHistorySearch, setPlayerHistorySearch] = useState('');
  const [archivePeriod, setArchivePeriod] = useState<'7' | '30' | '90' | '365' | 'all'>('all');
  const [playerHistoryLoading, setPlayerHistoryLoading] = useState(false);
  const [playerHistorySort, setPlayerHistorySort] = useState<'games' | 'spend_desc' | 'spend_asc' | 'rebuys' | 'discount' | 'avg_desc'>('games');
  const [expandedPlayerKey, setExpandedPlayerKey] = useState<string | null>(null);
  const [playerContacts, setPlayerContacts] = useState<Record<string, { realName: string | null; phone: string | null; instagram: string | null }>>({});
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [knownPlayersForSearch, setKnownPlayersForSearch] = useState<Array<{ name: string; username: string | null }>>([]);
  const [knownPlayersLoaded, setKnownPlayersLoaded] = useState(false);
  const [archiveContactPlayer, setArchiveContactPlayer] = useState<PlayerAggregate | null>(null);
  const [contactEditMode, setContactEditMode] = useState(false);
  const [contactDraft, setContactDraft] = useState<{ realName: string; phone: string; instagram: string }>({ realName: '', phone: '', instagram: '' });
  const [contactSaving, setContactSaving] = useState(false);
  const [archiveOpenId, setArchiveOpenId] = useState<number | null>(null);
  const [archiveDetailsLoadingId, setArchiveDetailsLoadingId] = useState<number | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [botPlayerList, setBotPlayerList] = useState<BotPlayerListItem[] | null>(() => {
    const cache = loadBotPlayerListCache();
    return cache && !isBotPlayerListCacheStale(cache.cachedAt) ? cache.players : null;
  });
  const [botPlayerListLoading, setBotPlayerListLoading] = useState(false);
  const [botPlayerListError, setBotPlayerListError] = useState<string | null>(null);
  const [botPlayerListCachedAt, setBotPlayerListCachedAt] = useState<string | null>(() => {
    const cache = loadBotPlayerListCache();
    return cache && !isBotPlayerListCacheStale(cache.cachedAt) ? cache.cachedAt : null;
  });
  const botPlayerListFetchedRef = useRef(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [finishReviewOpen, setFinishReviewOpen] = useState(false);
  const [finishStep, setFinishStep] = useState<'review' | 'personnel'>('review');
  const [finishPersonnel, setFinishPersonnel] = useState<PersonnelRecord[]>([]);
  const finishPersonnelRef = useRef<PersonnelRecord[]>([]);
  useEffect(() => { finishPersonnelRef.current = finishPersonnel; }, [finishPersonnel]);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>(() => loadLocalStaffDirectory());
  const [staffDraft, setStaffDraft] = useState<StaffMember | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [staffContactOpenId, setStaffContactOpenId] = useState<string | null>(null);
  const [staffDeleteTarget, setStaffDeleteTarget] = useState<StaffMember | null>(null);
  const [staffDeletePassword, setStaffDeletePassword] = useState('');
  const [staffDeleteError, setStaffDeleteError] = useState(false);
  const [staffBusy, setStaffBusy] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [personnelSyncError, setPersonnelSyncError] = useState<string | null>(null);
  const [personnelEditorOpen, setPersonnelEditorOpen] = useState(false);
  const [editingPersonnelId, setEditingPersonnelId] = useState<number | null>(null);
  const [personnelExpandedId, setPersonnelExpandedId] = useState<number | null>(null);
  const [personnelDraft, setPersonnelDraft] = useState<PersonnelRecord[]>([]);
  const [personnelConfirm, setPersonnelConfirm] = useState<{
    tournamentId: number; finishedAt: string;
    oldPersonnel: PersonnelRecord[]; newPersonnel: PersonnelRecord[];
  } | null>(null);
  const [personnelSavingId, setPersonnelSavingId] = useState<number | null>(null);
  const [financialExportBusy, setFinancialExportBusy] = useState(false);
  const [priceConfirmOpen, setPriceConfirmOpen] = useState(false);
  const [priceDraft, setPriceDraft] = useState({ buyIn: '', rebuy: '', addon: '' });
  const [finishBusy, setFinishBusy] = useState(false);
  const [resultsBusy, setResultsBusy] = useState(false);
  const [newTournamentBusy, setNewTournamentBusy] = useState(false);
  const [resultsNotice, setResultsNotice] = useState<TournamentResultsNotice>(null);
  const rosterSanitizedSelectionRef = useRef<string | null>(null);
  const initialIdleSelectionResetRef = useRef(false);
  const pendingTournamentSaveRef = useRef<{
    saved: boolean;
    gs: typeof gameState;
    levels: number;
    details: TournamentArchiveDetails | null;
  } | null>(null);

  // ── Bot games list ─────────────────────────────────────────────────────
  const [botGames, setBotGames] = useState<BotGameSummary[]>([]);
  useEffect(() => {
    fetch(`${BOT_API}/api/games?include_private=true`)
      .then(r => r.json())
      .then(setBotGames)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!authed || !displayPresenceEnabled) return;

    let cancelled = false;

    const refreshDisplayClients = async () => {
      const result = await fetchDisplayClients();
      if (cancelled) return;

      setPresenceNow(Date.now());
      setDisplayClients(result.clients);
      setDisplayClientsError(result.error ? 'Не удалось загрузить статусы экранов. Проверьте SQL supabase/display_clients.sql.' : null);
    };

    void refreshDisplayClients();
    const interval = setInterval(() => {
      void refreshDisplayClients();
    }, DISPLAY_CLIENTS_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [authed, displayPresenceEnabled]);

  const selectedBotGame = botGames.find(g => g.id === gameState.tournamentBotId) ?? null;
  const selectedTournamentIsClassic = selectedBotGame?.format === 'Классический турнир';

  const {
    players: tournamentPlayers,
    groupedPlayers,
    summary: tournamentPlayersSummary,
    playerSyncState,
    playerBackups,
    botSyncState,
    resultsSubmission,
    currentResultsSignature,
    refreshFromBot,
    addManualPlayer,
    removePlayer,
    updatePlayerField,
    setPlayerArrival,
    markPlayerOut,
    markPlayersOutInOrder,
    restorePlayer,
    assignPlayerSeat,
    restorePlayersFromBackup,
    getLatestTournamentArchiveDetails,
    prepareTournamentPlayersContext,
    exportTournamentResults,
  } = useTournamentPlayers({
    gameState,
    updateGameState,
    tournamentDate: selectedBotGame?.date ?? null,
    earlyBirdBonusEnabled: selectedTournamentIsClassic,
  });
  const floorSessionId = Math.max(1, Math.round(gameState.resetAt || 0));
  const personnelSaveSequenceRef = useRef(0);
  const personnelSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const personnelLocalWritesRef = useRef(0);

  const handlePersonnelChange = useCallback((records: PersonnelRecord[]) => {
    const merged = mergePersonnelRecords(records);
    setFinishPersonnel(merged);
    finishPersonnelRef.current = merged;
    const sequence = ++personnelSaveSequenceRef.current;
    personnelLocalWritesRef.current += 1;
    personnelSaveQueueRef.current = personnelSaveQueueRef.current
      .catch(() => undefined)
      .then(() => savePersonnelDraft(floorSessionId, merged))
      .then(() => {
        if (personnelSaveSequenceRef.current === sequence) setPersonnelSyncError(null);
      })
      .catch(error => {
        if (personnelSaveSequenceRef.current === sequence) {
          setPersonnelSyncError(error instanceof Error ? error.message : 'Не удалось сохранить выплаты персоналу.');
        }
      })
      .finally(() => {
        personnelLocalWritesRef.current = Math.max(0, personnelLocalWritesRef.current - 1);
      });
  }, [floorSessionId]);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    void fetchPersonnelDraft(floorSessionId)
      .then(records => {
        if (!cancelled) {
          setFinishPersonnel(records);
          finishPersonnelRef.current = records;
          setPersonnelSyncError(null);
        }
      })
      .catch(error => {
        if (!cancelled) setPersonnelSyncError(error instanceof Error ? error.message : 'Не удалось загрузить выплаты персоналу.');
      });
    return () => { cancelled = true; };
  }, [authed, floorSessionId]);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const members = await fetchStaffDirectory();
        if (!cancelled) {
          setStaffMembers(members);
          setStaffError(null);
        }
      } catch (error) {
        if (!cancelled) setStaffError(error instanceof Error ? error.message : 'Не удалось загрузить сотрудников.');
      }
    };
    void refresh();
    const channel = supabase
      .channel('staff-directory-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff' }, refresh)
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const channel = supabase
      .channel(`personnel-draft-sync-${floorSessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blind_templates' }, payload => {
        const row = (payload.new && Object.keys(payload.new).length > 0 ? payload.new : payload.old) as { id?: unknown };
        if (!isPersonnelDraftRowId(row.id, floorSessionId)) return;
        if (personnelLocalWritesRef.current > 0) return;
        void fetchPersonnelDraft(floorSessionId).then(records => {
          setFinishPersonnel(records);
          finishPersonnelRef.current = records;
        }).catch(() => {});
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [authed, floorSessionId]);
  const {
    notifications: floorNotifications,
    pendingCount: floorPendingCount,
    confirmNotification,
    rejectNotification,
  } = useFloorNotifications(floorSessionId);
  const pendingFloorNotifications = useMemo(
    () => floorNotifications.filter(notification => notification.status === 'pending'),
    [floorNotifications]
  );
  const [floorPopupNotificationId, setFloorPopupNotificationId] = useState<string | null>(null);
  const [dismissedFloorPopupIds, setDismissedFloorPopupIds] = useState<string[]>([]);
  const activeFloorPopupNotification = pendingFloorNotifications.find(notification => notification.id === floorPopupNotificationId) ?? null;

  const handleConfirmNotification = async (id: string, bounty: number) => {
    const notif = floorNotifications.find(n => n.id === id);
    if (notif?.type === 'bustout' && notif.playerId) {
      const entriesToMark = buildFloorBustoutConfirmationEntries({
        notifications: floorNotifications,
        players: tournamentPlayers,
        confirmingNotificationId: id,
        bounty,
      });

      await markPlayersOutInOrder(entriesToMark);
    }
    setFloorPopupNotificationId(current => current === id ? null : current);
    setDismissedFloorPopupIds(prev => prev.filter(notificationId => notificationId !== id));
    return confirmNotification(id, bounty);
  };

  const handleRejectNotification = async (id: string) => {
    setFloorPopupNotificationId(current => current === id ? null : current);
    setDismissedFloorPopupIds(prev => prev.filter(notificationId => notificationId !== id));
    return rejectNotification(id);
  };

  useEffect(() => {
    queueMicrotask(() => {
      if (floorPopupNotificationId && pendingFloorNotifications.some(notification => notification.id === floorPopupNotificationId)) {
        return;
      }

      const nextNotification = pendingFloorNotifications.find(notification => !dismissedFloorPopupIds.includes(notification.id));
      setFloorPopupNotificationId(nextNotification?.id ?? null);
    });
  }, [dismissedFloorPopupIds, floorPopupNotificationId, pendingFloorNotifications]);

  const chipLeaderCandidatePlayers = tournamentPlayers
    .filter(isActiveChipLeaderCandidate)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const lateRegistrationLevel = getLateRegistrationLevel(blindLevels);
  const chipLeaderTargetLevelIndex = gameState.currentLevelIndex;
  const chipLeaderDraft = chipLeaderDraftOverride?.levelIndex === chipLeaderTargetLevelIndex
    ? chipLeaderDraftOverride.rows
    : gameState.chipLeaders?.levelIndex === chipLeaderTargetLevelIndex
    ? chipLeaderDraftFromEntries(gameState.chipLeaders.entries)
    : createBlankChipLeaderDraft();

  useEffect(() => {
    if (!authed || !authoritativeReady) return;
    if (initialIdleSelectionResetRef.current) return;

    const idleBlankState =
      gameState.status === 'idle' &&
      gameState.players === 0 &&
      gameState.outs === 0 &&
      gameState.rebuys === 0 &&
      gameState.addonCount === 0 &&
      gameState.bonusCount === 0 &&
      gameState.totalStack === 0;

    if (!idleBlankState) {
      initialIdleSelectionResetRef.current = true;
      return;
    }

    if (!gameState.tournamentTitle && gameState.tournamentBotId == null) {
      initialIdleSelectionResetRef.current = true;
      return;
    }

    initialIdleSelectionResetRef.current = true;
    void (async () => {
      await prepareTournamentPlayersContext(null, '');
      await updateGameState({ tournamentTitle: '', tournamentBotId: null }, true);
    })();
  }, [
    authed,
    authoritativeReady,
    gameState.addonCount,
    gameState.bonusCount,
    gameState.outs,
    gameState.players,
    gameState.rebuys,
    gameState.status,
    gameState.totalStack,
    gameState.tournamentBotId,
    gameState.tournamentTitle,
    prepareTournamentPlayersContext,
    updateGameState,
  ]);
  const managedPlayerCountsActive = tournamentPlayers.length > 0;

  const finishReviewPlayers = [...tournamentPlayers].sort((a, b) => {
    if (a.place !== null && b.place !== null) return a.place - b.place;
    if (a.place !== null) return -1;
    if (b.place !== null) return 1;
    return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru');
  });
  const levelsPlayed = gameState.currentLevelIndex + 1;
  const archiveDetailsPayload: TournamentArchiveDetails | null = tournamentPlayers.length > 0 || finishPersonnel.length > 0
    ? {
        tournamentBotId: gameState.tournamentBotId,
        tournamentTitle: gameState.tournamentTitle,
        resultsSentAt: resultsSubmission.sentAt,
        resultsSignature: resultsSubmission.signature,
        players: tournamentPlayers.map(player => ({
          id: player.id,
          telegramId: player.telegramId,
          botRegistrationId: player.botRegistrationId,
          name: player.name,
          username: player.username,
          source: player.source,
          registrationSource: player.registrationSource,
          status: player.status,
          arrivalStatus: player.arrivalStatus,
          rebuyCount: player.rebuyCount,
          addonCount: player.addonCount,
          bonusCount: player.bonusCount,
          bounty: player.bounty,
          bonusRcPoints: player.bonusRcPoints,
          cashPaid: player.cashPaid,
          cardPaid: player.cardPaid,
          paymentDue: player.paymentDue,
          place: player.place,
          bustoutOrder: player.bustoutOrder,
          createdAt: player.createdAt,
          updatedAt: player.updatedAt,
        })),
        summary: tournamentPlayersSummary,
        savedAt: new Date().toISOString(),
        personnel: finishPersonnel.length > 0 ? mergePersonnelRecords(finishPersonnel) : undefined,
      }
    : null;
  const playersMissingFinalPlace = finishReviewPlayers.filter(player => (
    player.arrivalStatus !== 'absent' && player.status !== 'out'
  )).length;
  const duplicateResultPlaces = getDuplicatePlaces(
    finishReviewPlayers
      .filter(player => player.arrivalStatus !== 'absent')
      .map(player => player.place)
  );
  const duplicateResultPlacesLabel = duplicateResultPlaces.join(', ');
  const hasBotResultsTarget = tournamentPlayers.length > 0 && gameState.tournamentBotId != null;
  const requiresBotResults = gameState.tournamentBotId != null;
  const {
    resultsAlreadyCurrent,
    resultsNeedResubmit,
    canSubmitTournamentResults,
  } = deriveTournamentResultsUiState({
    hasBotResultsTarget,
    playersMissingFinalPlace,
    duplicatePlacesCount: duplicateResultPlaces.length,
    resultsSubmissionSignature: resultsSubmission.signature,
    currentResultsSignature,
  });
  const resultsSentLabel = resultsSubmission.sentAt
    ? new Date(resultsSubmission.sentAt).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  const visibleResultsNotice =
    resultsNotice?.tone === 'success' &&
    !resultsAlreadyCurrent &&
    Boolean(resultsSubmission.signature)
      ? null
      : resultsNotice;
  const missingBotRosterForFinish = requiresBotResults && tournamentPlayers.length === 0 && !resultsAlreadyCurrent;
  const canFinishTournamentFromReview = !finishBusy && !resultsBusy && (
    !requiresBotResults ||
    (
      playersMissingFinalPlace === 0 &&
      !missingBotRosterForFinish &&
      (resultsAlreadyCurrent || canSubmitTournamentResults)
    )
  );
  const finishReviewPrimaryLabel = resultsBusy
    ? 'Отправка...'
    : finishBusy
      ? 'Завершение...'
      : !requiresBotResults || resultsAlreadyCurrent
        ? 'Завершить турнир'
        : resultsNeedResubmit
          ? 'Завершить и отправить обновление'
          : 'Завершить и отправить в бот';
  const sendResultsButtonLabel = getTournamentResultsButtonLabel({
    resultsBusy,
    resultsAlreadyCurrent,
    resultsNeedResubmit,
  });

  const finishTournamentFlow = async () => {
    const endOk = await updateGameState({ status: 'ended' }, true);
    return endOk !== false;
  };

  const dispatchTournamentResults = async (): Promise<TournamentResultsDispatchOutcome> => {
    if (resultsNeedResubmit && resultsSubmission.sentAt) {
      const confirmed = confirm('Итоги уже отправлялись. Отправить в бот обновлённую версию результатов?');
      if (!confirmed) {
        return {
          ok: false,
          skipped: false,
          cancelled: true,
          error: null,
          resent: true,
          financeError: null,
          financeSkipped: true,
        };
      }
    }

    setResultsBusy(true);
    try {
      const exportResult = await exportTournamentResults(levelsPlayed);
      if (!exportResult.ok) {
        return {
          ok: false,
          skipped: exportResult.skipped,
          cancelled: false,
          error: exportResult.error ?? 'Не удалось отправить итоги турнира в бот.',
          resent: resultsNeedResubmit,
          financeError: null,
          financeSkipped: true,
        };
      }

      return {
        ok: true,
        skipped: false,
        cancelled: false,
        error: null,
        resent: resultsNeedResubmit,
        financeError: exportResult.financeError,
        financeSkipped: exportResult.financeSkipped,
      };
    } finally {
      setResultsBusy(false);
    }
  };

  const submitTournamentResults = async () => {
    setResultsNotice(null);

    if (duplicateResultPlaces.length > 0) {
      setResultsNotice({
        tone: 'error',
        text: `В итогах дублируются места: ${duplicateResultPlacesLabel}. Исправьте места перед отправкой в бот.`,
      });
      return false;
    }

    const dispatchResult = await dispatchTournamentResults();
    if (dispatchResult.cancelled) return false;

    if (!dispatchResult.ok) {
      if (!dispatchResult.skipped) {
        setResultsNotice({
          tone: 'error',
          text: dispatchResult.error ?? 'Не удалось отправить итоги турнира в бот.',
        });
        return false;
      }

      setResultsNotice({
        tone: 'success',
        text: 'Для этого турнира сейчас нечего отправлять в бот.',
      });
      return true;
    }

    if (dispatchResult.financeError) {
      if (gameState.status === 'ended') {
        const resetOk = await startNewTournamentFlow();
        if (!resetOk) return false;
      }

      setResultsNotice({
        tone: 'warning',
        text: `Итоги турнира отправлены в бот, турнир закрыт, но отдельный финансовый отчёт не ушёл: ${dispatchResult.financeError}`,
      });
      return true;
    }

    if (gameState.status === 'ended') {
      const resetOk = await startNewTournamentFlow();
      if (!resetOk) return false;
    }

    setResultsNotice({
      tone: 'success',
      text: dispatchResult.resent
        ? `Обновлённые итоги турнира отправлены в бот${dispatchResult.financeSkipped ? '.' : ', финансовый отчёт отправлен отдельно.'}`
        : dispatchResult.financeSkipped
          ? 'Итоги турнира отправлены в бот, турнир закрыт.'
          : 'Итоги турнира и отдельный финансовый отчёт отправлены в бот, турнир закрыт.',
    });
    return true;
  };

  const finishAndSubmitTournament = async () => {
    if (requiresBotResults && missingBotRosterForFinish) {
      setResultsNotice({
        tone: 'error',
        text: 'Для турнира из бота перед завершением нужен список игроков. Синхронизируйте состав из бота или добавьте игроков вручную.',
      });
      return false;
    }

    if (requiresBotResults && playersMissingFinalPlace > 0) {
      setResultsNotice({
        tone: 'error',
        text: 'Перед завершением переведите всех оставшихся игроков в `Выбыл` и проверьте финальные места.',
      });
      return false;
    }

    if (requiresBotResults && duplicateResultPlaces.length > 0) {
      setResultsNotice({
        tone: 'error',
        text: `В итогах дублируются места: ${duplicateResultPlacesLabel}. Исправьте места перед отправкой в бот.`,
      });
      return false;
    }

    setFinishBusy(true);
    setResultsNotice(null);
    try {
      try {
        const preparedPersonnel = await syncManualPersonnelToStaff(finishPersonnelRef.current);
        setFinishPersonnel(preparedPersonnel);
        finishPersonnelRef.current = preparedPersonnel;
        await savePersonnelDraft(floorSessionId, preparedPersonnel);
      } catch (personnelError) {
        setResultsNotice({
          tone: 'warning',
          text: `Не удалось синхронизировать данные персонала: ${personnelError instanceof Error ? personnelError.message : 'Ошибка'}. Турнир всё равно будет завершён.`,
        });
      }

      let dispatchedResults = false;
      let resentResults = false;

      if (requiresBotResults && !resultsAlreadyCurrent) {
        const dispatchResult = await dispatchTournamentResults();
        if (dispatchResult.cancelled) return false;
        if (!dispatchResult.ok) {
          setResultsNotice({
            tone: 'error',
            text: dispatchResult.skipped
              ? 'Для завершения турнира сначала подготовьте результаты для отправки в бот.'
              : dispatchResult.error ?? 'Не удалось отправить итоги турнира в бот.',
          });
          return false;
        }

        dispatchedResults = true;
        resentResults = dispatchResult.resent;
      }

      const endedOk = await finishTournamentFlow();
      if (!endedOk) {
        setResultsNotice({
          tone: 'error',
          text: requiresBotResults
            ? 'Итоги уже отправлены в бот, но турнир не удалось перевести в завершённый статус. Повторите завершение ещё раз.'
            : 'Не удалось завершить турнир. Не закрывайте страницу и попробуйте ещё раз.',
        });
        return false;
      }

      const resetOk = await startNewTournamentFlow();
      if (!resetOk) {
        setResultsNotice({
          tone: 'error',
          text: requiresBotResults
            ? 'Итоги отправлены, но завершённый турнир не удалось сбросить. Не закрывайте страницу и попробуйте ещё раз.'
            : 'Турнир завершён, но не удалось сбросить его состояние. Не закрывайте страницу и попробуйте ещё раз.',
        });
        return false;
      }

      setResultsNotice({
        tone: 'success',
        text: !requiresBotResults
          ? 'Турнир завершён и закрыт.'
          : resultsAlreadyCurrent && !dispatchedResults
            ? 'Турнир закрыт. Актуальные итоги уже были отправлены в бот.'
            : resentResults
              ? 'Обновлённые итоги отправлены в бот, турнир закрыт.'
              : 'Итоги отправлены в бот, турнир закрыт.',
      });
      return true;
    } finally {
      setFinishBusy(false);
    }
  };

  const startNewTournamentFlow = async (nextTournament?: PendingTournamentSelection) => {
    // Capture save data on the first call only — prevents duplicate archive entries if
    // resetTournament fails and the admin retries (gameState may have partially reset by then).
    if (!pendingTournamentSaveRef.current) {
      const latestArchiveDetails = await getLatestTournamentArchiveDetails();
      const personnelSnapshot = mergePersonnelRecords(finishPersonnelRef.current);
      const baseDetails = latestArchiveDetails ?? archiveDetailsPayload;
      const detailsToSave = baseDetails && personnelSnapshot.length > 0
        ? { ...baseDetails, personnel: personnelSnapshot }
        : baseDetails;
      pendingTournamentSaveRef.current = {
        saved: false,
        gs: gameState,
        levels: levelsPlayed,
        details: detailsToSave,
      };
    }

    setNewTournamentBusy(true);
    try {
      if (!pendingTournamentSaveRef.current.saved) {
        await saveTournament(
          pendingTournamentSaveRef.current.gs,
          pendingTournamentSaveRef.current.levels,
          pendingTournamentSaveRef.current.details,
        );
        pendingTournamentSaveRef.current.saved = true;
      }

      const completedPersonnelSessionId = floorSessionId;
      await personnelSaveQueueRef.current.catch(() => undefined);
      const resetOk = await resetTournament();
      if (!resetOk) {
        alert('Не удалось сохранить завершение турнира в Supabase. Не закрывайте страницу и попробуйте ещё раз.');
        return false;
      }

      // Flow completed — clear the pending save guard.
      pendingTournamentSaveRef.current = null;
      setFinishPersonnel([]);
      await deletePersonnelDraft(completedPersonnelSessionId);

      // After resetTournament, sessionIdRef has updated (React ran effects during the DB write
      // await). Explicitly initialise an empty players slot for the new session so the Players
      // tab never shows stale data from an earlier session under the same key.
      await prepareTournamentPlayersContext(
        nextTournament?.botId ?? null,
        nextTournament?.title ?? '',
      );

      if (nextTournament) {
        const selectionOk = await updateGameState({
          tournamentTitle: nextTournament.title,
          tournamentBotId: nextTournament.botId,
          tournamentBuyIn: nextTournament.buyIn ?? null,
        }, true);

        if (selectionOk === false) {
          alert('Турнир сброшен, но новую игру не удалось применить сразу. Выберите её ещё раз.');
        }
      }

      setFinishReviewOpen(false);
      setGamePickerOpen(false);
      setCustomGameOpen(false);
      setResultsNotice(null);
      setActiveTab('control');
      return true;
    } finally {
      setNewTournamentBusy(false);
    }
  };

  const confirmStartNewTournament = async (nextTournament?: PendingTournamentSelection) => {
    if (shouldBlockNewTournamentForPendingBotResults({ requiresBotResults, resultsAlreadyCurrent })) {
      setResultsNotice({
        tone: 'error',
        text: missingBotRosterForFinish
          ? 'Нельзя начать новый турнир: для игры из бота нет списка игроков. Сначала синхронизируйте состав или добавьте игроков вручную.'
          : canSubmitTournamentResults
          ? 'Сначала отправьте итоги турнира в бот. Новый турнир можно начать только после успешной отправки.'
          : 'Нельзя начать новый турнир: итоги игры из бота ещё не готовы к отправке. Проверьте места и список игроков.',
      });
      setFinishReviewOpen(true);
      setFinishStep('review');
      setActiveTab('control');
      return;
    }

    const message = nextTournament
      ? `Начать новый турнир с игрой «${nextTournament.title}»? Завершённый турнир сохранится в архив.`
      : 'Завершить текущий турнир и начать новый? Данные сохранятся в архив.';

    if (!confirm(message)) return;
    await startNewTournamentFlow(nextTournament);
  };

  const handleSelectTournament = async (title: string, botId: number | null) => {
    const selectedGame = botId != null ? botGames.find(g => g.id === botId) : undefined;
    const buyIn = selectedGame?.buy_in ?? null;

    const sameSelection = gameState.tournamentTitle === title && gameState.tournamentBotId === botId;
    if (sameSelection) {
      await prepareTournamentPlayersContext(botId, title);
      if (botId != null) {
        void refreshFromBot(true);
      }
      setGamePickerOpen(false);
      setCustomGameOpen(false);
      return;
    }

    if (gameState.status === 'ended') {
      await confirmStartNewTournament({ title, botId, buyIn });
      setGamePickerOpen(false);
      setCustomGameOpen(false);
      return;
    }

    if (gameState.status === 'running' || gameState.status === 'paused' || gameState.status === 'break') {
      setPendingGameSwitch({ title, botId, buyIn });
      setGamePickerOpen(false);
      setCustomGameOpen(false);
      return;
    }

    await prepareTournamentPlayersContext(botId, title);
    await updateGameState({ tournamentTitle: title, tournamentBotId: botId, tournamentBuyIn: buyIn }, true);
    setGamePickerOpen(false);
    setCustomGameOpen(false);
  };

  useEffect(() => {
    if (gameState.tournamentBotId == null) return;
    if (botGames.length === 0) return;
    if (tournamentPlayers.length === 0) return;

    const selectedGame = botGames.find(game => game.id === gameState.tournamentBotId);
    if (!selectedGame) return;

    const selectionKey = `${gameState.resetAt}:${gameState.tournamentBotId}:${gameState.tournamentTitle}`;
    const allPlayersPassive = tournamentPlayers.every(isPassiveBotPlayerForUpcomingGame);
    const gameStateLooksBlank =
      gameState.players === 0 &&
      gameState.outs === 0 &&
      gameState.rebuys === 0 &&
      gameState.addonCount === 0 &&
      gameState.bonusCount === 0 &&
      gameState.totalStack === 0;
    const snapshotCarriesFinishedTournamentData =
      selectedGame.status === 'upcoming' &&
      gameStateLooksBlank &&
      tournamentPlayers.some(hasLiveTournamentProgress);
    const looksLikeStaleUpcomingRoster = allPlayersPassive && tournamentPlayers.length > selectedGame.confirmed;

    if (!snapshotCarriesFinishedTournamentData && !looksLikeStaleUpcomingRoster) {
      if (rosterSanitizedSelectionRef.current === selectionKey) {
        rosterSanitizedSelectionRef.current = null;
      }
      return;
    }

    if (rosterSanitizedSelectionRef.current === selectionKey) return;
    rosterSanitizedSelectionRef.current = selectionKey;

    void (async () => {
      await prepareTournamentPlayersContext(gameState.tournamentBotId, gameState.tournamentTitle);
      await refreshFromBot(true);
    })();
  }, [
    botGames,
    gameState.addonCount,
    gameState.bonusCount,
    gameState.outs,
    gameState.players,
    gameState.resetAt,
    gameState.rebuys,
    gameState.totalStack,
    gameState.tournamentBotId,
    gameState.tournamentTitle,
    prepareTournamentPlayersContext,
    refreshFromBot,
    tournamentPlayers,
  ]);

  const playersInGame = managedPlayerCountsActive
    ? tournamentPlayersSummary.active
    : Math.max(0, gameState.players - gameState.outs);
  const playersRegistered = managedPlayerCountsActive
    ? tournamentPlayersSummary.entrants
    : Math.max(0, gameState.players);

  useTournamentBotLiveSync({
    enabled: authed && authoritativeReady && gameState.tournamentBotId != null,
    tournamentBotId: gameState.tournamentBotId,
    tournamentTitle: gameState.tournamentTitle,
    status: gameState.status,
    currentLevelIndex: gameState.currentLevelIndex,
    currentTimeLeft: gameState.timeLeft,
    playersInGame,
    playersRegistered,
    playersOut: Math.max(0, gameState.outs),
    blindLevels,
    getAuthoritativeNow,
  });

  useEffect(() => {
    blindTemplatesRef.current = blindTemplates;
  }, [blindTemplates]);

  useEffect(() => {
    gameStateSnapshotRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    backgroundLibraryRef.current = backgroundLibrary;
  }, [backgroundLibrary]);

  // ── Пробел = play/pause ────────────────────────────────────────────────
  useEffect(() => {
    if (!authed || !syncReady) return;
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') {
        e.preventDefault();
        const running = gameState.status === 'running' || gameState.status === 'break';
        if (running) pauseTimer(); else startTimer();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [authed, syncReady, gameState.status, startTimer, pauseTimer]);

  // ── Auth ──────────────────────────────────────────────────────────────
  const handleLogin = () => {
    if (pwInput === ADMIN_PASSWORD) {
      setAuthed(true);
      saveAdminAuthFlag();
    } else {
      setPwError(true);
      setTimeout(() => setPwError(false), 2000);
    }
  };

  const handleArchiveLogin = () => {
    if (archivePwInput === ARCHIVE_PASSWORD) {
      setArchiveAuthed(true);
      saveArchiveAuthFlag();
      setArchivePwInput('');
      setArchivePwError(false);
      setArchiveLoading(true);
    } else {
      setArchivePwError(true);
      setTimeout(() => setArchivePwError(false), 2000);
    }
  };

  // ── Load archive when tab opens — MUST be before any early return ──────
  useEffect(() => {
    if (activeTab !== 'archive' || !archiveAuthed) return;

    const loadArchive = async () => {
      const data = await fetchTournaments();
      setTournaments(data);
      setArchiveLoading(false);
    };

    void loadArchive();
  }, [activeTab, archiveAuthed, fetchTournaments]);

  // ── Load all archive details when switching to the Players sub-tab ──────
  const archiveDetailsByIdRef = useRef(archiveDetailsById);
  useEffect(() => { archiveDetailsByIdRef.current = archiveDetailsById; }, [archiveDetailsById]);

  useEffect(() => {
    const needsDetails = activeTab === 'archive' && archiveAuthed && (
      archiveSubTab === 'players' || archiveSubTab === 'salary' || archiveSubTab === 'staff'
    );
    if (!needsDetails) return;
    if (tournaments.length === 0) return;

    const missingIds = tournaments
      .map(t => t.id)
      .filter(id => !Object.prototype.hasOwnProperty.call(archiveDetailsByIdRef.current, id));

    if (missingIds.length === 0) return;

    setPlayerHistoryLoading(true);
    let cancelled = false;

    const loadAll = async () => {
      try {
        const results = await fetchTournamentArchiveDetailsBatch(missingIds);
        if (!cancelled) {
          setArchiveDetailsById(prev => {
            const next = { ...prev };
            for (const [id, details] of Object.entries(results)) {
              next[Number(id)] = details;
            }
            return next;
          });
          setTournaments(prev => {
            let changed = false;
            const next = prev.map(tournament => {
              const details = results[tournament.id];
              if (!details || tournament.archive_details === details) return tournament;
              changed = true;
              return { ...tournament, archive_details: details };
            });
            return changed ? next : prev;
          });
        }
      } finally {
        if (!cancelled) setPlayerHistoryLoading(false);
      }
    };

    void loadAll();
    return () => { cancelled = true; };
  }, [activeTab, archiveAuthed, archiveSubTab, tournaments, fetchTournamentArchiveDetailsBatch]);

  useEffect(() => {
    if (activeTab !== 'players' || knownPlayersLoaded) return;
    let cancelled = false;
    const load = async () => {
      const ts = await fetchTournaments();
      if (cancelled) return;
      const ids = ts.map(t => t.id);
      const detailsById = ids.length > 0 ? await fetchTournamentArchiveDetailsBatch(ids) : {};
      if (cancelled) return;
      const aggs = aggregatePlayerHistory(ts, detailsById);
      setKnownPlayersForSearch(aggs.map(a => ({ name: a.currentName, username: a.currentUsername })));
      setKnownPlayersLoaded(true);
    };
    void load();
    return () => { cancelled = true; };
  }, [activeTab, knownPlayersLoaded, fetchTournaments, fetchTournamentArchiveDetailsBatch]);

  const knownPlayersWithBot = useMemo(() => {
    if (!botPlayerList || botPlayerList.length === 0) return knownPlayersForSearch;

    const archiveNameSet = new Set(knownPlayersForSearch.map(p => p.name.toLowerCase()));
    const botOnly = botPlayerList
      .filter(p => !archiveNameSet.has(p.name.toLowerCase()))
      .map(p => ({ name: p.name, username: p.username }));

    return [...knownPlayersForSearch, ...botOnly];
  }, [knownPlayersForSearch, botPlayerList]);

  useEffect(() => {
    if (activeTab !== 'archive' || !archiveAuthed || archiveSubTab !== 'players' || contactsLoaded) return;
    let cancelled = false;
    const load = async () => {
      const [{ data: snapshotData }, { data: contactData }] = await Promise.all([
        supabase.from('blind_templates').select('id, levels').like('id', '__live_players__%'),
        supabase.from('blind_templates').select('id, levels').like('id', '__player_contact__%'),
      ]);
      if (cancelled) return;

      const map: Record<string, { realName: string | null; phone: string | null; instagram: string | null }> = {};

      const playerKey = (p: Record<string, unknown>): string => {
        const username = typeof p.username === 'string' ? p.username.replace(/^@/, '').trim().toLowerCase() : '';
        const telegramId = typeof p.telegramId === 'number' ? p.telegramId : null;
        const name = typeof p.name === 'string' ? p.name.trim().toLowerCase() : '';
        if (username) return `un:${username}`;
        if (telegramId != null) return `tg:${telegramId}`;
        return `nm:${name}`;
      };

      for (const row of snapshotData ?? []) {
        const levels = (row.levels ?? {}) as Record<string, unknown>;
        const players = Array.isArray(levels.players) ? levels.players as Record<string, unknown>[] : [];
        for (const p of players) {
          const realName = typeof p.realName === 'string' && p.realName.trim() ? p.realName.trim() : null;
          const phone = typeof p.phone === 'string' && p.phone.trim() ? p.phone.trim() : null;
          const instagram = typeof p.instagram === 'string' && p.instagram.trim() ? p.instagram.trim() : null;
          if (!realName && !phone && !instagram) continue;
          const key = playerKey(p);
          if (!map[key]) map[key] = { realName, phone, instagram };
        }
      }

      for (const row of contactData ?? []) {
        const key = (row.id as string).slice('__player_contact__:'.length);
        const l = (row.levels ?? {}) as Record<string, unknown>;
        map[key] = {
          realName: typeof l.realName === 'string' ? l.realName : null,
          phone: typeof l.phone === 'string' ? l.phone : null,
          instagram: typeof l.instagram === 'string' ? l.instagram : null,
        };
      }

      setPlayerContacts(map);
      setContactsLoaded(true);
    };
    void load();
    return () => { cancelled = true; };
  }, [activeTab, archiveAuthed, archiveSubTab, contactsLoaded]);

  const handleOpenPriceConfirm = () => {
    setPriceDraft({
      buyIn: String(gameState.tournamentBuyIn ?? 1000),
      rebuy: String(gameState.rebuyCost ?? 1000),
      addon: String(gameState.addonCost ?? 1000),
    });
    setPriceConfirmOpen(true);
  };

  const handleConfirmAndStart = async () => {
    const buyIn = parseInt(priceDraft.buyIn, 10);
    const rebuy = parseInt(priceDraft.rebuy, 10);
    const addon = parseInt(priceDraft.addon, 10);
    if (isNaN(buyIn) || isNaN(rebuy) || isNaN(addon)) return;
    if (buyIn < 0 || rebuy < 0 || addon < 0) return;
    await updateGameState({ tournamentBuyIn: buyIn, rebuyCost: rebuy, addonCost: addon });
    setPriceConfirmOpen(false);
    startTimer();
  };

  const savePlayerContact = async (playerKey: string, contact: { realName: string | null; phone: string | null; instagram: string | null }) => {
    const id = `__player_contact__:${playerKey}`;
    await supabase.from('blind_templates').upsert({ id, name: `player_contact:${playerKey}`, levels: contact });
    setPlayerContacts(prev => ({ ...prev, [playerKey]: contact }));
  };

  const fetchBotPlayerListFromApi = useCallback(async () => {
    setBotPlayerListLoading(true);
    setBotPlayerListError(null);
    const result = await fetchBotPlayerList();
    setBotPlayerListLoading(false);
    if (result.ok) {
      setBotPlayerList(result.players);
      const cachedAt = saveBotPlayerListCache(result.players);
      setBotPlayerListCachedAt(cachedAt);
    } else {
      setBotPlayerListError(result.error);
      const cache = loadBotPlayerListCache();
      if (cache) {
        setBotPlayerList(cache.players);
        setBotPlayerListCachedAt(cache.cachedAt);
      }
    }
  }, []);

  useEffect(() => {
    const shouldLoad =
      activeTab === 'players' ||
      (activeTab === 'archive' && archiveAuthed && archiveSubTab === 'players');
    if (!shouldLoad) return;
    if (botPlayerListFetchedRef.current) return;
    botPlayerListFetchedRef.current = true;

    const cache = loadBotPlayerListCache();
    if (cache && !isBotPlayerListCacheStale(cache.cachedAt)) return;

    let cancelled = false;
    const doFetch = async () => {
      const result = await fetchBotPlayerList();
      if (cancelled) return;
      if (result.ok) {
        setBotPlayerList(result.players);
        setBotPlayerListCachedAt(saveBotPlayerListCache(result.players));
      } else {
        setBotPlayerListError(result.error);
        const staleCache = loadBotPlayerListCache();
        if (staleCache) {
          setBotPlayerList(staleCache.players);
          setBotPlayerListCachedAt(staleCache.cachedAt);
        }
      }
    };
    void doFetch();
    return () => { cancelled = true; };
  }, [activeTab, archiveAuthed, archiveSubTab]);

  const handleExportXlsx = () => {
    const allAggs = aggregatePlayerHistory(tournaments, archiveDetailsById);
    const tournamentById = new Map(tournaments.map(t => [t.id, t]));
    const query = playerHistorySearch.trim().toLowerCase();

    const filtered = allAggs
      .filter(a =>
        !query ||
        matchesSearchQuery(a.currentName, query) ||
        matchesSearchQuery(a.currentUsername ?? '', query)
      )
      .map(agg => {
        const entries = filterByPeriod(
          [...agg.tournaments].sort((a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime()),
          archivePeriod
        );
        return { agg, entries };
      })
      .filter(x => x.entries.length > 0);

    const wb = XLSX.utils.book_new();

    // Sheet 1: Игроки
    const playersRows = filtered.map(({ agg, entries }) => {
      const contact = playerContacts[agg.key];
      const placed = entries.filter(e => e.place != null && e.place >= 1);

      let totalPoints = 0;
      for (const e of entries) {
        if (e.place == null || e.place < 1) continue;
        const t = tournamentById.get(e.tournamentId);
        if (!t) continue;
        const pts = getRankPoints(t.players);
        totalPoints += pts[e.place - 1] ?? 0;
      }

      const lastGame = entries.length > 0
        ? new Date(Math.max(...entries.map(e => new Date(e.finishedAt).getTime()))).toLocaleDateString('ru-RU')
        : '';

      return {
        'Имя': agg.currentName,
        'Настоящее имя': contact?.realName ?? '',
        'Ник': agg.currentUsername ? `@${agg.currentUsername.replace(/^@/, '')}` : '',
        'Телефон': contact?.phone ?? '',
        'Instagram': contact?.instagram ?? '',
        'Telegram ID': agg.telegramId ?? '',
        'Очки рейтинга': Math.round(totalPoints * 10) / 10,
        'Игр сыграно': entries.length,
        'Лучшее место': placed.length > 0 ? Math.min(...placed.map(e => e.place as number)) : '',
        'Дата последней игры': lastGame,
      };
    });

    const ws1 = XLSX.utils.json_to_sheet(playersRows);
    XLSX.utils.book_append_sheet(wb, ws1, 'Игроки');

    // Sheet 2: Статистика
    const statsRows = filtered.map(({ agg, entries }) => {
      const placed = entries.filter(e => e.place != null && e.place >= 1);
      const wins = entries.filter(e => e.place === 1).length;
      const top3 = entries.filter(e => e.place != null && e.place <= 3).length;
      const avgPlace = placed.length > 0
        ? Math.round(placed.reduce((s, e) => s + (e.place as number), 0) / placed.length * 10) / 10
        : '';

      return {
        'Игрок': agg.currentName,
        'Ник': agg.currentUsername ? `@${agg.currentUsername.replace(/^@/, '')}` : '',
        'Всего игр': entries.length,
        'Побед': wins,
        'Топ-3': top3,
        'Среднее место': avgPlace,
        'Лучшее место': placed.length > 0 ? Math.min(...placed.map(e => e.place as number)) : '',
        'Bounty': entries.reduce((s, e) => s + e.bounty, 0),
        'Rebuy': entries.reduce((s, e) => s + e.rebuyCount, 0),
        'Addon': entries.reduce((s, e) => s + e.addonCount, 0),
        'Сумма входов (₽)': entries.reduce((s, e) => s + e.cashPaid + e.cardPaid, 0),
      };
    });

    const ws2 = XLSX.utils.json_to_sheet(statsRows);
    XLSX.utils.book_append_sheet(wb, ws2, 'Статистика');

    // Sheet 3: История игр
    type HistoryRow = {
      'Игрок': string; 'Ник': string; 'Турнир': string; 'Дата': string;
      'Место': number | string; 'Rebuy': number; 'Addon': number; 'Bounty': number; 'Оплачено (₽)': number;
    };
    const historyRows: HistoryRow[] = [];
    for (const { agg, entries } of filtered) {
      for (const e of entries) {
        historyRows.push({
          'Игрок': agg.currentName,
          'Ник': agg.currentUsername ? `@${agg.currentUsername.replace(/^@/, '')}` : '',
          'Турнир': e.title,
          'Дата': new Date(e.finishedAt).toLocaleDateString('ru-RU'),
          'Место': e.place ?? '—',
          'Rebuy': e.rebuyCount,
          'Addon': e.addonCount,
          'Bounty': e.bounty,
          'Оплачено (₽)': e.cashPaid + e.cardPaid,
        });
      }
    }

    const ws3 = XLSX.utils.json_to_sheet(historyRows);
    XLSX.utils.book_append_sheet(wb, ws3, 'История игр');

    const dateStr = new Date().toISOString().slice(0, 10);
    const periodLabel = archivePeriod === 'all' ? '' : `_${archivePeriod}d`;
    XLSX.writeFile(wb, `garage_players_export_${dateStr}${periodLabel}.xlsx`);
  };

  const handleExportFinancialXlsx = async (tournamentsToExport: TournamentRecord[]) => {
    setFinancialExportBusy(true);
    try {
      const missingIds = tournamentsToExport
        .map(t => t.id)
        .filter(id => !Object.prototype.hasOwnProperty.call(archiveDetailsById, id));

      let detailsMap = { ...archiveDetailsById };
      if (missingIds.length > 0) {
        const results = await fetchTournamentArchiveDetailsBatch(missingIds);
        detailsMap = { ...detailsMap, ...results };
        setArchiveDetailsById(prev => ({ ...prev, ...results }));
      }

      const wb = XLSX.utils.book_new();

      // Sheet 1: Игры
      type GamesRow = {
        'Дата': string; 'Название': string; 'Игроков': number; 'Входов': number;
        'Ребаев': number; 'Аддонов': number; 'Бонусов': number;
        'Оплачено ₽': number; 'Наличные ₽': number; 'Карта ₽': number;
        'Расходы персонал ₽': number; 'Чистый доход ₽': number;
      };
      const gamesRows: GamesRow[] = tournamentsToExport.map(t => {
        const details = detailsMap[t.id] ?? t.archive_details ?? null;
        const players = details?.players ?? [];
        const cashTotal = players.reduce((s, p) => s + (p.cashPaid ?? (p.paymentMethod === 'cash' ? p.paymentDue : 0)), 0);
        const cardTotal = players.reduce((s, p) => s + (p.cardPaid ?? (p.paymentMethod === 'card' ? p.paymentDue : 0)), 0);
        const revenue = cashTotal + cardTotal;
        const { total: personnelCost } = personnelTotals(details?.personnel ?? []);
        return {
          'Дата': new Date(t.finished_at).toLocaleDateString('ru-RU'),
          'Название': t.title ?? 'Без названия',
          'Игроков': t.players,
          'Входов': details?.summary?.entrants ?? t.players,
          'Ребаев': t.rebuys,
          'Аддонов': t.addon_count,
          'Бонусов': t.bonus_count ?? 0,
          'Оплачено ₽': revenue,
          'Наличные ₽': cashTotal,
          'Карта ₽': cardTotal,
          'Расходы персонал ₽': personnelCost,
          'Чистый доход ₽': revenue - personnelCost,
        };
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gamesRows), 'Игры');

      // Sheet 2: Персонал
      type SalaryRow = {
        'Дата игры': string; 'Название игры': string; 'Имя сотрудника': string;
        'Статус': string; 'Сумма ₽': number;
      };
      const salaryRows: SalaryRow[] = [];
      for (const t of tournamentsToExport) {
        const details = detailsMap[t.id] ?? t.archive_details ?? null;
        for (const p of mergePersonnelRecords(details?.personnel ?? [])) {
          salaryRows.push({
            'Дата игры': new Date(t.finished_at).toLocaleDateString('ru-RU'),
            'Название игры': t.title ?? 'Без названия',
            'Имя сотрудника': p.name,
            'Статус': formatPersonnelRole(p),
            'Сумма ₽': p.cashAmount + p.cardAmount,
          });
        }
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salaryRows.length > 0 ? salaryRows : [{ 'Данные': 'Нет данных о персонале' }]), 'Персонал');

      // Sheet 3: Финансовая сводка
      const totalRevenueCash = gamesRows.reduce((s, r) => s + r['Наличные ₽'], 0);
      const totalRevenueCard = gamesRows.reduce((s, r) => s + r['Карта ₽'], 0);
      const totalRevenue = totalRevenueCash + totalRevenueCard;
      const totalPersonnel = salaryRows.reduce((s, r) => s + r['Сумма ₽'], 0);
      const summaryRows = [
        { 'Показатель': 'Общий доход', 'Сумма ₽': totalRevenue },
        { 'Показатель': '  в т.ч. наличными', 'Сумма ₽': totalRevenueCash },
        { 'Показатель': '  в т.ч. картой', 'Сумма ₽': totalRevenueCard },
        { 'Показатель': 'Расходы на персонал', 'Сумма ₽': totalPersonnel },
        { 'Показатель': 'Чистый доход', 'Сумма ₽': totalRevenue - totalPersonnel },
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Финансовая сводка');

      const dateStr = new Date().toISOString().slice(0, 10);
      const periodLabel = archivePeriod === 'all' ? '' : `_${archivePeriod}d`;
      XLSX.writeFile(wb, `garage_finance_report_${dateStr}${periodLabel}.xlsx`);
    } finally {
      setFinancialExportBusy(false);
    }
  };

  const toggleArchiveDetails = async (tournamentId: number) => {
    if (archiveOpenId === tournamentId) {
      setArchiveOpenId(null);
      return;
    }

    setArchiveOpenId(tournamentId);
    if (Object.prototype.hasOwnProperty.call(archiveDetailsById, tournamentId)) {
      return;
    }

    setArchiveDetailsLoadingId(tournamentId);
    try {
      const details = await fetchTournamentArchiveDetails(tournamentId);
      setArchiveDetailsById(prev => ({ ...prev, [tournamentId]: details }));
    } finally {
      setArchiveDetailsLoadingId(current => current === tournamentId ? null : current);
    }
  };

  const syncBlindTemplateState = useCallback((next: BlindTemplate[]) => {
    const result = saveBlindTemplates(next);
    if (!result.ok && !sharedBlindTemplateLibraryEnabled) {
      return result;
    }

    setBlindTemplates(next);
    return { ok: true as const };
  }, [sharedBlindTemplateLibraryEnabled]);

  useEffect(() => {
    if (!authed) return;

    let cancelled = false;

    const loadTemplateLibrary = async () => {
      setTemplateError(null);

      try {
        if (!sharedBlindTemplateLibraryEnabled) {
          if (!cancelled) {
            const localTemplates = loadBlindTemplates().filter(template => !template.id.startsWith('preset_'));
            const cacheResult = syncBlindTemplateState(localTemplates);
            if (!cacheResult.ok) setTemplateError(cacheResult.error);
          }
          return;
        }

        const remote = await withRetries(
          () => fetchSharedBlindTemplates(),
          SHARED_LIBRARY_TIMEOUT_MS,
          'Не удалось загрузить общие шаблоны блайндов',
          SHARED_LIBRARY_RETRY_COUNT
        );
        const local = loadBlindTemplates();
        const mergedCustom = mergeBlindTemplates(remote, local).filter(template => !template.id.startsWith('preset_'));

        if (!cancelled) {
          const cacheResult = syncBlindTemplateState(mergedCustom);
          if (!cacheResult.ok) {
            setTemplateError(cacheResult.error);
          }
        }
      } catch (err) {
        if (!cancelled) {
          const fallbackTemplates = loadBlindTemplates().filter(template => !template.id.startsWith('preset_'));
          const cacheResult = syncBlindTemplateState(fallbackTemplates);
          if (!cacheResult.ok) {
            setTemplateError(cacheResult.error);
            return;
          }

          const baseError = err instanceof Error ? err.message : 'Не удалось загрузить шаблоны блайндов';
          setTemplateError(`${baseError} Шаблоны доступны локально только на этом устройстве.`);
        }
      }
    };

    loadTemplateLibrary();

    return () => {
      cancelled = true;
    };
  }, [authed, sharedBlindTemplateLibraryEnabled, syncBlindTemplateState]);

  // ── Realtime sync: шаблоны обновляются на всех устройствах сразу ──────────
  useEffect(() => {
    if (!sharedBlindTemplateLibraryEnabled) return;

    const channel = supabase
      .channel('blind-templates-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blind_templates' }, async () => {
        try {
          const remote = await fetchSharedBlindTemplates();
          const local = loadBlindTemplates();
          const merged = mergeBlindTemplates(remote, local).filter(t => !t.id.startsWith('preset_'));
          saveBlindTemplates(merged);
          setBlindTemplates(merged);
        } catch {
          // не блокируем UI при ошибке realtime
        }
      })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [sharedBlindTemplateLibraryEnabled]);

  const persistBlindTemplates = async (next: BlindTemplate[], templateToSave?: BlindTemplate) => {
    const customTemplates = next.filter(template => !template.id.startsWith('preset_'));

    if (templateToSave) {
      const saveResult = await upsertSharedBlindTemplate(templateToSave);
      if (!saveResult.ok) {
        const cacheResult = syncBlindTemplateState(customTemplates);
        if (!cacheResult.ok) {
          setTemplateError(cacheResult.error);
          return false;
        }

        setTemplateError(`${saveResult.error} Шаблон сохранен локально только на этом устройстве.`);
        return true;
      }
    }

    const cacheResult = syncBlindTemplateState(customTemplates);
    if (!cacheResult.ok) {
      setTemplateError(cacheResult.error);
      return false;
    }

    return true;
  };

  const syncBackgroundLibraryState = useCallback((next: StoredBackground[]) => {
    const result = saveBackgroundLibrary(next);
    // Если Supabase настроен — localStorage лишь кеш, его переполнение не критично
    if (!result.ok && !sharedBackgroundLibraryEnabled) {
      return result;
    }

    setBackgroundLibrary(next);
    return { ok: true as const };
  }, [sharedBackgroundLibraryEnabled]);

  useEffect(() => {
    if (!authed || !sharedBackgroundLibraryEnabled) return;

    let cancelled = false;

    const loadSharedLibrary = async () => {
      setBackgroundUploadError(null);

      try {
        const remote = await withRetries(
          () => fetchSharedBackgroundLibrary(),
          SHARED_LIBRARY_TIMEOUT_MS,
          'Не удалось загрузить общую библиотеку фонов',
          SHARED_LIBRARY_RETRY_COUNT
        );
        const local = loadBackgroundLibrary();
        const missingLocal = local.filter(item =>
          !remote.some(remoteItem => remoteItem.url === item.url)
        );
        const merged = mergeBackgroundLibraries(remote, local).slice(0, MAX_BACKGROUND_ITEMS);
        const trimmedCount = remote.length + missingLocal.length - merged.length;
        const acceptedMissingLocal = missingLocal.filter(item =>
          merged.some(mergedItem => mergedItem.id === item.id)
        );

        if (acceptedMissingLocal.length > 0) {
          const uploadResult = await upsertSharedBackgrounds(acceptedMissingLocal);
          if (!uploadResult.ok) throw new Error(uploadResult.error);
        }

        if (!cancelled) {
          const cacheResult = syncBackgroundLibraryState(merged);
          if (!cacheResult.ok) {
            setBackgroundUploadError(cacheResult.error);
          } else if (acceptedMissingLocal.length > 0) {
            const noteParts = [`Синхронизировано локальных фонов: ${acceptedMissingLocal.length}.`];
            if (trimmedCount > 0) {
              noteParts.push(`Лишние ${trimmedCount} шт. не вошли в общий лимит ${MAX_BACKGROUND_ITEMS}.`);
            }
            setBackgroundUploadNote(noteParts.join(' '));
          }
        }
      } catch (err) {
        if (!cancelled) {
          setBackgroundUploadError(
            err instanceof Error ? err.message : 'Не удалось загрузить общую библиотеку фонов'
          );
        }
      }
    };

    loadSharedLibrary();

    return () => {
      cancelled = true;
    };
  }, [authed, sharedBackgroundLibraryEnabled, syncBackgroundLibraryState]);

  const persistBackgroundLibrary = async (next: StoredBackground[], removedIds: string[] = []) => {
    if (!sharedBackgroundLibraryEnabled) {
      const cacheResult = syncBackgroundLibraryState(next);
      if (!cacheResult.ok) {
        setBackgroundUploadError(cacheResult.error);
        return false;
      }
      return true;
    }

    const current = backgroundLibraryRef.current;
    const toAdd = next.filter(item => !current.some(existing => existing.id === item.id));

    if (toAdd.length > 0) {
      const addResult = await upsertSharedBackgrounds(toAdd);
      if (!addResult.ok) {
        setBackgroundUploadError(addResult.error);
        return false;
      }
    }

    if (removedIds.length > 0) {
      const deleteResult = await deleteSharedBackgrounds(removedIds);
      if (!deleteResult.ok) {
        setBackgroundUploadError(deleteResult.error);
        return false;
      }
    }

    const cacheResult = syncBackgroundLibraryState(next);
    if (!cacheResult.ok) {
      setBackgroundUploadError(cacheResult.error);
      return false;
    }

    return true;
  };

  const handleBackgroundUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setBackgroundUploadBusy(true);
    setBackgroundUploadError(null);
    setBackgroundUploadNote(null);

    try {
      const uploaded = await Promise.all(files.map(createBackgroundFromFile));
      const current = backgroundLibraryRef.current;
      const dedupedCurrent = current.filter(existing =>
        !uploaded.some(item => item.url === existing.url)
      );
      const merged = [...uploaded, ...dedupedCurrent].slice(0, MAX_BACKGROUND_ITEMS);
      const removedFromLibrary = current.filter(existing =>
        !merged.some(item => item.id === existing.id)
      );
      const trimmedCount = uploaded.length + dedupedCurrent.length - merged.length;

      if (await persistBackgroundLibrary(merged, removedFromLibrary.map(item => item.id))) {
        const parts = [`Загружено фонов: ${uploaded.length}.`];
        if (trimmedCount > 0) {
          parts.push(`Лишние ${trimmedCount} шт. не сохранены, лимит: ${MAX_BACKGROUND_ITEMS}.`);
        }
        if (sharedBackgroundLibraryEnabled) {
          parts.push('Библиотека синхронизирована для всех устройств.');
        }
        setBackgroundUploadNote(parts.join(' '));
      }
    } catch (err) {
      setBackgroundUploadError(err instanceof Error ? err.message : 'Не удалось загрузить изображения');
    } finally {
      setBackgroundUploadBusy(false);
      e.target.value = '';
    }
  };

  const removeBackground = async (backgroundId: string) => {
    setBackgroundUploadError(null);
    setBackgroundUploadNote(null);

    const current = backgroundLibraryRef.current;
    const toRemove = current.find(item => item.id === backgroundId);
    const next = current.filter(item => item.id !== backgroundId);

    if (!(await persistBackgroundLibrary(next, [backgroundId]))) return;

    if (toRemove && gameState.backgroundUrl === toRemove.url) {
      updateGameState({ backgroundUrl: null });
    }
  };

  const saveCurrentBlindTemplate = async () => {
    const name = templateName.trim();
    if (!name) {
      setTemplateError('Введите название шаблона');
      setTemplateNote(null);
      return;
    }

    setTemplateBusy(true);
    setTemplateError(null);
    setTemplateNote(null);

    try {
      const existing = blindTemplatesRef.current.find(
        template => template.name.trim().toLowerCase() === name.toLowerCase()
      );
      const template = buildBlindTemplate(name, blindLevels, {
        startStack: gameState.startStack,
        addonStack: gameState.addonStack,
        bonusStack: gameState.bonusStack,
      }, existing?.id);
      const next = mergeBlindTemplates(
        blindTemplatesRef.current.filter(item => item.id !== template.id),
        [template]
      );

      if (await persistBlindTemplates(next, template)) {
        setTemplateName('');
        setTemplateNote(existing ? `Шаблон «${name}» обновлен.` : `Шаблон «${name}» сохранен.`);
      }
    } finally {
      setTemplateBusy(false);
    }
  };

  const applyBlindTemplate = async (template: BlindTemplate) => {
    setTemplateError(null);
    setTemplateNote(null);

    const levels = template.levels.map(level => ({ ...level }));
    await updateBlindLevels(levels);

    const firstLevel = levels[0];
    const nextState = {
      ...gameStateSnapshotRef.current,
      startStack: template.startStack,
      addonStack: template.addonStack,
      bonusStack: template.bonusStack,
    };
    await updateGameState({
      currentLevelIndex: 0,
      timeLeft: firstLevel?.duration ?? 1200,
      status: 'paused',
      startStack: template.startStack,
      addonStack: template.addonStack,
      bonusStack: template.bonusStack,
      totalStack: calcTotalStack(nextState),
    });

    setTemplateNote(`Применен шаблон «${template.name}».`);
  };

  const removeBlindTemplate = async (templateId: string) => {
    setTemplateError(null);
    setTemplateNote(null);

    const next = blindTemplatesRef.current.filter(template => template.id !== templateId);
    const deleteResult = await deleteSharedBlindTemplates([templateId]);
    if (!deleteResult.ok) {
      const cacheResult = syncBlindTemplateState(next);
      if (!cacheResult.ok) {
        setTemplateError(cacheResult.error);
        return;
      }

      setTemplateError(`${deleteResult.error} Шаблон удален локально только на этом устройстве.`);
      return;
    }

    const cacheResult = syncBlindTemplateState(next);
    if (!cacheResult.ok) {
      setTemplateError(cacheResult.error);
      return;
    }

    setTemplateNote('Шаблон удален.');
  };

  const allBlindTemplates = mergeBlindTemplates(PRESET_BLIND_TEMPLATES, blindTemplates);
  const allBackgrounds = [...PRESET_BACKGROUNDS, ...backgroundLibrary];

  // Auto-manage addonOpen: opens during the last break for classic tournaments only
  useEffect(() => {
    if (!blindLevels.length) return;
    const currentLevel = blindLevels[gameState.currentLevelIndex];
    if (!currentLevel) return;
    const breaks = blindLevels.filter(l => l.isBreak);
    const lastBreak = breaks[breaks.length - 1];
    const shouldBeOpen = selectedTournamentIsClassic && currentLevel.isBreak && !!lastBreak && lastBreak.id === currentLevel.id;
    if (gameState.addonOpen !== shouldBeOpen) {
      void updateGameState({ addonOpen: shouldBeOpen });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.currentLevelIndex, blindLevels, selectedTournamentIsClassic]);

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center px-4">
        <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-8 w-full max-w-sm">
          <div className="text-[#C0392B] text-2xl font-bold text-center mb-6">🃏 POKER TIMER</div>
          <div className="text-[#888] text-sm mb-4 text-center">Введите пароль администратора</div>
          <input
            type="password"
            className="admin-input mb-3"
            placeholder="Пароль"
            value={pwInput}
            onChange={e => setPwInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            autoFocus
          />
          {pwError && <div className="text-red-500 text-sm text-center mb-2">Неверный пароль</div>}
          <button onClick={handleLogin} className="admin-btn-primary w-full py-3">Войти</button>
        </div>
      </div>
    );
  }

  if (!syncReady) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center px-4">
        <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-8 w-full max-w-md text-center">
          <div className="text-[#C0392B] text-2xl font-bold mb-4">Синхронизация...</div>
          <div className="text-[#888] text-sm">
            Загружаю текущее состояние турнира из Supabase. Управление откроется, как только админка получит актуальную игру.
          </div>
        </div>
      </div>
    );
  }

  if (!authoritativeReady) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center px-4">
        <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-8 w-full max-w-md text-center">
          <div className="text-[#C0392B] text-2xl font-bold mb-4">Нет связи с турниром</div>
          <div className="text-[#AAA] text-sm leading-relaxed">
            {syncError ?? 'Админка не получила текущее состояние игры из Supabase.'}
          </div>
          <div className="text-[#666] text-xs mt-3">
            Пока синхронизация не восстановится, управление заблокировано, чтобы не перезаписать живой турнир дефолтными данными.
          </div>
          <div className="text-[#666] text-xs mt-2">
            Админка сама повторяет подключение каждые 10 секунд. Кнопка ниже нужна, если хочется форсировать попытку сразу.
          </div>
          <button
            onClick={() => { void retrySync(); }}
            className="admin-btn-primary w-full py-3 mt-5"
          >
            Повторить синхронизацию
          </button>
        </div>
      </div>
    );
  }

  // ── Timer status helpers ───────────────────────────────────────────────
  const isRunning = gameState.status === 'running' || gameState.status === 'break';
  const minutes = Math.floor(gameState.timeLeft / 60);
  const seconds = gameState.timeLeft % 60;

  const currentLevel = blindLevels[gameState.currentLevelIndex];
  const regularBlindLevels = blindLevels.filter(level => !level.isBreak);
  const anteStartLevel = regularBlindLevels.find(level => level.ante > 0)?.level ?? 0;
  const currentKnockoutLabel = getKnockoutLabel(currentLevel);
  const nextKnockout = getNextKnockoutInfo(blindLevels, gameState.currentLevelIndex, gameState.timeLeft);
  const nextKnockoutTime = nextKnockout && !nextKnockout.startsNow
    ? formatApproxTimeFromNow(nextKnockout.secondsUntil)
    : null;
  const chipLeaderTargetLevel = blindLevels[chipLeaderTargetLevelIndex] ?? null;
  const chipLeadersSavedForTarget = gameState.chipLeaders?.levelIndex === chipLeaderTargetLevelIndex
    ? gameState.chipLeaders.entries.length
    : 0;
  const chipLeaderRowsReady = chipLeaderDraft.filter(row => (
    row.playerId && Math.round(Number(row.stack.replace(/\s+/g, '')) || 0) > 0
  )).length;
  const canSaveChipLeaders = chipLeaderRowsReady === 3;
  const onlineDisplayClients = displayClients.filter(client => isDisplayClientOnline(client, presenceNow));
  const offlineDisplayClients = displayClients.filter(client => !isDisplayClientOnline(client, presenceNow));

  const handleForceSyncDisplays = async () => {
    if (displayForceSyncBusy) return;

    setDisplayForceSyncBusy(true);
    setDisplayForceSyncResult(null);
    try {
      const ok = await forceSyncDisplays();
      setPresenceNow(Date.now());
      setDisplayForceSyncResult(ok !== false ? 'ok' : 'error');
    } catch {
      setDisplayForceSyncResult('error');
    } finally {
      setDisplayForceSyncBusy(false);
      setTimeout(() => setDisplayForceSyncResult(null), 3000);
    }
  };

  const updateStackState = (
    patch: Partial<Pick<GameState, 'players' | 'rebuys' | 'addonCount' | 'bonusCount' | 'startStack' | 'addonStack' | 'bonusStack' | 'extraAddonCount' | 'extraBonusCount'>>
  ) => {
    const nextState = { ...gameStateSnapshotRef.current, ...patch };
    updateGameState({ ...patch, totalStack: calcTotalStack(nextState) });
  };

  const updateChipLeaderDraft = (rowId: string, patch: Partial<ChipLeaderDraftRow>) => {
    setChipLeaderDraftOverride(current => {
      const rows = current?.levelIndex === chipLeaderTargetLevelIndex
        ? current.rows
        : chipLeaderDraft;

      return {
        levelIndex: chipLeaderTargetLevelIndex,
        rows: rows.map(row => row.id === rowId ? { ...row, ...patch } : row),
      };
    });
  };

  const selectChipLeaderPlayer = (rowId: string, playerId: string) => {
    const player = chipLeaderCandidatePlayers.find(candidate => candidate.id === playerId);
    updateChipLeaderDraft(rowId, {
      playerId,
      name: player?.name ?? '',
    });
  };

  const saveChipLeaders = async () => {
    setChipLeaderSaveError(null);
    setChipLeaderSaveNote(null);

    const entries = chipLeaderDraft
      .map((row, index): ChipLeaderEntry | null => {
        const stack = Math.max(0, Math.round(Number(row.stack.replace(/\s+/g, '')) || 0));
        const player = chipLeaderCandidatePlayers.find(candidate => candidate.id === row.playerId);
        const name = (player?.name ?? row.name).trim();
        if (!row.playerId || !name || stack <= 0) return null;

        return {
          id: row.id || `chip-${index + 1}`,
          playerId: row.playerId,
          name,
          stack,
        };
      })
      .filter((entry): entry is ChipLeaderEntry => entry !== null)
      .sort((a, b) => b.stack - a.stack)
      .slice(0, 3);

    const saved = await updateGameState({
      chipLeaders: entries.length > 0
        ? {
            levelIndex: chipLeaderTargetLevelIndex,
            hideAfterLevelIndex: getChipLeaderHideAfterLevelIndex(gameState.status, chipLeaderTargetLevelIndex),
            entries,
          }
        : null,
      chipLeaderCollectionActive: false,
    }, true);

    if (!saved) {
      setChipLeaderSaveError(
        'Не удалось сохранить чип-лидеров в Supabase. Примените supabase/chip_leaders.sql к базе и нажмите кнопку еще раз.'
      );
      return;
    }

    setChipLeaderSaveNote(
      chipLeaderTargetLevel
        ? `Сохранено для текущего уровня${chipLeaderTargetLevel.isBreak ? ' (перерыв)' : ` ${chipLeaderTargetLevel.level}`}.`
        : 'Чип-лидеры сохранены.'
    );
  };

  const startChipLeaderCollection = async () => {
    setChipLeaderSaveError(null);
    setChipLeaderSaveNote(null);

    if (floorSessionId > 0 && chipLeaderTargetLevelIndex >= 0) {
      const cleared = await deleteChipLeaderSubmissions(floorSessionId, chipLeaderTargetLevelIndex);
      if (!cleared.ok) {
        console.error('Failed to clear chip leader submissions before collection', cleared.error);
        setChipLeaderSaveError('Не удалось очистить прошлые отправки столов для текущего уровня.');
        return;
      }
    }

    await updateGameState({
      chipLeaderCollectionActive: true,
      chipLeaders: null,
    }, true);
    setChipLeaderDraftOverride({
      levelIndex: chipLeaderTargetLevelIndex,
      rows: createBlankChipLeaderDraft(),
    });
    setChipLeaderSaveNote('Сбор запущен. Кнопка появилась у дилеров.');
  };

  const clearChipLeaders = () => {
    setChipLeaderSaveError(null);
    setChipLeaderSaveNote(null);
    setChipLeaderDraftOverride({
      levelIndex: chipLeaderTargetLevelIndex,
      rows: createBlankChipLeaderDraft(),
    });
    updateGameState({ chipLeaders: null, chipLeaderCollectionActive: false }, true);
  };

  const selectTab = (tabId: AdminTab) => {
    if (tabId === 'archive' && archiveAuthed) {
      setArchiveLoading(true);
    }
    setActiveTab(tabId);
  };

  const selectArchiveSubTab = (tabId: 'games' | 'players' | 'salary' | 'staff') => {
    setArchiveSubTab(tabId);
  };

  const selectArchivePeriod = (period: PeriodFilter) => {
    setArchivePeriod(period);
  };

  const applyAnteStartLevel = (startLevel: number) => {
    updateBlindLevels(
      blindLevels.map(level => {
        if (level.isBreak) {
          return { ...level, ante: 0 };
        }

        return {
          ...level,
          ante: startLevel > 0 && level.level >= startLevel ? level.bb : 0,
        };
      })
    );
  };

  // ── Demo data ──────────────────────────────────────────────────────────
  // ── Blind levels editor ────────────────────────────────────────────────
  const addBlindLevel = () => {
    const nextPair = getNextGarageBlindPair(blindLevels);
    const lastRegularLevel = regularBlindLevels[regularBlindLevels.length - 1];
    const newLevel: BlindLevel = {
      id: Date.now().toString(),
      level: regularBlindLevels.length + 1,
      sb: nextPair.sb,
      bb: nextPair.bb,
      ante: lastRegularLevel?.ante > 0 ? nextPair.bb : 0,
      duration: 1200,
      isBreak: false,
    };
    updateBlindLevels([...blindLevels, newLevel]);
  };

  const addBreak = () => {
    const breakLevel: BlindLevel = {
      id: Date.now().toString(),
      level: 0,
      sb: 0, bb: 0, ante: 0,
      duration: 900,
      isBreak: true,
      breakLabel: 'ПЕРЕРЫВ',
    };
    updateBlindLevels([...blindLevels, breakLevel]);
  };

  const updateLevel = (idx: number, level: BlindLevel) => {
    const updated = [...blindLevels];
    updated[idx] = level;
    updateBlindLevels(updated);
  };

  const deleteLevel = (idx: number) => {
    updateBlindLevels(blindLevels.filter((_, i) => i !== idx));
  };

  const moveLevel = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= blindLevels.length) return;
    const updated = [...blindLevels];
    [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
    updateBlindLevels(updated);
  };

  const getDropLine = (y: number): number => {
    for (let i = 0; i < rowEls.current.length; i++) {
      const el = rowEls.current[i];
      if (!el) continue;
      const { top, height } = el.getBoundingClientRect();
      if (y < top + height / 2) return i;
    }
    return rowEls.current.length;
  };

  const commitDrop = () => {
    if (dragging.current && dragIdx !== null && dropLine !== null) {
      const from = dragIdx;
      const to = dropLine > from ? dropLine - 1 : dropLine;
      if (from !== to) {
        const arr = [...blindLevels];
        const [item] = arr.splice(from, 1);
        arr.splice(to, 0, item);
        updateBlindLevels(arr);
      }
    }
    dragging.current = false;
    setDragIdx(null);
    setDropLine(null);
  };

  // ── Combinations editor ────────────────────────────────────────────────
  const addCombo = () => {
    const newCombo: Combination = {
      id: Date.now().toString(),
      cards: [],
      description: '',
      enabled: true,
    };
    updateCombinations([newCombo, ...combinations]);
  };

  const updateCombo = (idx: number, combo: Combination) => {
    const updated = [...combinations];
    updated[idx] = combo;
    updateCombinations(updated);
  };

  const deleteCombo = (idx: number) => {
    updateCombinations(combinations.filter((_, i) => i !== idx));
  };

  const addCardToCombo = (comboIdx: number, card: Card) => {
    const combo = combinations[comboIdx];
    updateCombo(comboIdx, { ...combo, cards: [...combo.cards, card] });
  };

  const removeCardFromCombo = (comboIdx: number, cardIdx: number) => {
    const combo = combinations[comboIdx];
    updateCombo(comboIdx, {
      ...combo,
      cards: combo.cards.filter((_, i) => i !== cardIdx),
    });
  };

  const persistStaffDraft = async () => {
    if (!staffDraft?.name.trim()) return;
    setStaffBusy(true);
    setStaffError(null);
    try {
      const normalized = {
        ...staffDraft,
        name: staffDraft.name.trim(),
        roleLabel: staffDraft.roleLabel.trim() || (
          staffDraft.role === 'dealer' ? 'Дилер' : staffDraft.role === 'admin' ? 'Админ' : 'Другое'
        ),
        baseRate: Math.max(0, Math.round(staffDraft.baseRate || 0)),
      };
      await saveStaffMember(normalized);
      setStaffMembers(await fetchStaffDirectory());
      setStaffDraft(null);
    } catch (error) {
      setStaffError(error instanceof Error ? error.message : 'Не удалось сохранить сотрудника.');
    } finally {
      setStaffBusy(false);
    }
  };

  const toggleStaffMemberVisibility = async (member: StaffMember) => {
    setStaffBusy(true);
    setStaffError(null);
    try {
      await saveStaffMember({ ...member, active: !member.active });
      setStaffMembers(await fetchStaffDirectory());
      if (staffDraft?.id === member.id) setStaffDraft(null);
    } catch (error) {
      setStaffError(error instanceof Error ? error.message : 'Не удалось изменить видимость сотрудника.');
    } finally {
      setStaffBusy(false);
    }
  };

  const permanentlyDeleteStaffMember = async () => {
    if (!staffDeleteTarget) return;
    if (staffDeletePassword !== ARCHIVE_PASSWORD) {
      setStaffDeleteError(true);
      return;
    }

    const member = staffDeleteTarget;
    setStaffBusy(true);
    setStaffError(null);
    try {
      await deleteStaffMember(member.id);
      setStaffMembers(current => current.filter(item => item.id !== member.id));
      setSelectedStaffId(null);
      setStaffContactOpenId(null);
      setStaffDeleteTarget(null);
      setStaffDeletePassword('');
      setStaffDeleteError(false);
      if (staffDraft?.id === member.id) setStaffDraft(null);
      const deletedName = member.name.trim().toLocaleLowerCase('ru');
      const personnelWithoutDeleted = finishPersonnel.filter(record =>
        record.staffMemberId !== member.id &&
        !(record.staffMemberId == null && record.name.trim().toLocaleLowerCase('ru') === deletedName)
      );
      if (personnelWithoutDeleted.length !== finishPersonnel.length) {
        handlePersonnelChange(personnelWithoutDeleted);
      }
    } catch (error) {
      setStaffError(error instanceof Error ? error.message : 'Не удалось удалить сотрудника.');
    } finally {
      setStaffBusy(false);
    }
  };

  const syncManualPersonnelToStaff = async (records: PersonnelRecord[]) => {
    const nextRecords: PersonnelRecord[] = [];
    const knownStaff = [...staffMembers];

    for (const record of records) {
      if (record.staffMemberId) {
        nextRecords.push(record);
        continue;
      }

      const name = record.name.trim();
      const total = record.cashAmount + record.cardAmount;
      if (!name && total === 0) continue;
      if (!name) {
        nextRecords.push(record);
        continue;
      }

      const normalizedName = name.toLocaleLowerCase('ru');
      const existing = knownStaff.find(member => member.name.trim().toLocaleLowerCase('ru') === normalizedName);
      const member: StaffMember = existing
        ? {
            ...existing,
            active: true,
            baseRate: total > 0 ? total : existing.baseRate,
          }
        : {
            ...createStaffMember(),
            name,
            role: record.role,
            roleLabel: record.roleLabel,
            baseRate: total,
          };

      await saveStaffMember(member);
      if (!existing) knownStaff.push(member);
      nextRecords.push({
        ...record,
        staffMemberId: member.id,
        name: member.name,
        role: member.role,
        roleLabel: member.roleLabel,
      });
    }

    setStaffMembers(await fetchStaffDirectory());
    return nextRecords;
  };

  const finishPersonnelEditing = async () => {
    setStaffBusy(true);
    setStaffError(null);
    try {
      const nextRecords = await syncManualPersonnelToStaff(finishPersonnel);
      handlePersonnelChange(nextRecords);
      setPersonnelEditorOpen(false);
    } catch (error) {
      setPersonnelSyncError(error instanceof Error ? error.message : 'Не удалось добавить сотрудника в справочник.');
    } finally {
      setStaffBusy(false);
    }
  };

  const staffArchiveCutoff = archivePeriod === 'all'
    ? 0
    : presenceNow - Number(archivePeriod) * 24 * 60 * 60 * 1000;
  const staffArchiveTournaments = archivePeriod === 'all'
    ? tournaments
    : tournaments.filter(tournament => new Date(tournament.finished_at).getTime() >= staffArchiveCutoff);
  const staffArchivePersonnel = staffArchiveTournaments.flatMap(tournament => {
    const details = archiveDetailsById[tournament.id] ?? tournament.archive_details ?? null;
    return mergePersonnelRecords(details?.personnel ?? []);
  });
  const staffArchiveTotals = personnelTotals(staffArchivePersonnel);
  const staffArchiveLoadedCount = staffArchiveTournaments.filter(tournament =>
    Object.prototype.hasOwnProperty.call(archiveDetailsById, tournament.id)
  ).length;
  const staffArchiveLoading = playerHistoryLoading || staffArchiveLoadedCount < staffArchiveTournaments.length;

  // ── Tabs ──────────────────────────────────────────────────────────────
  const tabs = [
    { id: 'control', label: '▶ Управление' },
    { id: 'players', label: '👥 Игроки' },
    { id: 'tables',  label: '🪑 Столы' },
    { id: 'notifications', label: floorPendingCount > 0 ? `🔔 Уведомления (${floorPendingCount})` : '🔔 Уведомления' },
    { id: 'blinds',  label: '💰 Блайнды' },
    { id: 'combos',  label: '🃏 Комбо' },
    { id: 'archive', label: '📋 Архив' },
    { id: 'settings',label: '⚙️ Настройки' },
  ] as const;
  const displayHref = `${window.location.origin}${import.meta.env.BASE_URL}#/`;

  return (
    <ErrorBoundary>
    <div className={`admin-shell min-h-screen bg-[#0A0A0A] text-white ${tabletAdminLayout ? 'admin-tablet-shell' : ''}`}>
      {activeFloorPopupNotification && (
        <FloorNotificationPopup
          key={activeFloorPopupNotification.id}
          notification={activeFloorPopupNotification}
          onConfirm={handleConfirmNotification}
          onReject={handleRejectNotification}
          onOpenNotifications={() => {
            setActiveTab('notifications');
            setDismissedFloorPopupIds(prev => (
              prev.includes(activeFloorPopupNotification.id) ? prev : [...prev, activeFloorPopupNotification.id]
            ));
            setFloorPopupNotificationId(null);
          }}
          onDismiss={() => {
            setDismissedFloorPopupIds(prev => (
              prev.includes(activeFloorPopupNotification.id) ? prev : [...prev, activeFloorPopupNotification.id]
            ));
            setFloorPopupNotificationId(null);
          }}
        />
      )}

      {/* Header */}
      <div className="bg-[#111] border-b border-[#2D2D2D] px-3 sm:px-6 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-[#C0392B] font-bold text-base sm:text-lg whitespace-nowrap">🃏 ADMIN</div>
          {gameState.tournamentTitle && (
            <span className="text-[#555] text-xs sm:text-sm font-medium uppercase tracking-wide truncate">
              · {gameState.tournamentTitle}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href={displayHref}
            target="_blank"
            rel="noopener noreferrer"
            className="admin-header-link bg-[#C0392B] text-white text-xs font-bold rounded-lg px-2 py-1.5 hover:bg-[#E31E24] transition-colors whitespace-nowrap"
          >
            ↗ Табло
          </a>
        </div>
      </div>

      {/* Tabs — scrollable on mobile */}
      <div className="flex gap-1 px-3 pt-3 border-b border-[#2D2D2D] overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => selectTab(tab.id)}
            className={`admin-tab-trigger px-3 py-2 text-xs sm:text-sm rounded-t-lg transition-colors whitespace-nowrap flex-shrink-0 ${
              activeTab === tab.id
                ? 'bg-[#1A1A1A] text-white border border-b-0 border-[#2D2D2D]'
                : 'text-[#666] hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="w-full max-w-5xl mx-auto p-3 sm:p-6">

        {/* ─── CONTROL TAB ─────────────────────────────────────────────── */}
        {activeTab === 'control' && (
          <div className="flex flex-col gap-4">

            {/* ── Выбор / создание игры ──────────────────────────────── */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              {/* Заголовок с текущим выбором */}
              <button
                onClick={() => { setGamePickerOpen(o => !o); setCustomGameOpen(false); }}
                className="flex items-center justify-between w-full"
              >
                <div className="text-sm">
                  {gameState.tournamentTitle
                    ? <span className="text-white font-bold">✓ {gameState.tournamentTitle}</span>
                    : <span className="text-[#888]">Выбрать или создать игру</span>}
                </div>
                <span className="text-[#555] text-xs ml-2">{gamePickerOpen ? '▲' : '▼'}</span>
              </button>

              {gamePickerOpen && (
                <div className="mt-3 flex flex-col gap-3">
                  {/* Переключатель режима */}
                  <div className="flex gap-1 bg-[#0A0A0A] rounded-xl p-1">
                    <button
                      onClick={() => setCustomGameOpen(false)}
                      className={`flex-1 py-1.5 text-xs rounded-lg transition-colors ${!customGameOpen ? 'bg-[#1E1E1E] text-white' : 'text-[#555] hover:text-[#888]'}`}
                    >
                      Из бота
                    </button>
                    <button
                      onClick={() => setCustomGameOpen(true)}
                      className={`flex-1 py-1.5 text-xs rounded-lg transition-colors ${customGameOpen ? 'bg-[#1E1E1E] text-white' : 'text-[#555] hover:text-[#888]'}`}
                    >
                      + Создать свою
                    </button>
                  </div>

                  {/* Список игр из бота */}
                  {!customGameOpen && (
                    botGames.length === 0 ? (
                      <div className="text-[#444] text-sm">Загрузка игр из бота...</div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {botGames.map(g => {
                          const isSelected = gameState.tournamentBotId === g.id;
                          const d = new Date(g.date);
                          const dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                          return (
                            <button
                              key={g.id}
                              onClick={() => { void handleSelectTournament(g.title, g.id); }}
                              className={`flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all ${
                                isSelected
                                  ? 'border-[#C0392B] bg-[#1a0a00] text-white'
                                  : 'border-[#2D2D2D] bg-[#0A0A0A] text-[#888] hover:border-[#444]'
                              }`}
                            >
                              <div>
                                <div className={`font-bold uppercase text-sm ${isSelected ? 'text-white' : 'text-[#666]'}`}>{g.title}</div>
                                <div className="text-xs text-[#444] mt-0.5">{dateStr}</div>
                              </div>
                              <div className="text-right ml-3">
                                <div className={`text-sm font-bold ${isSelected ? 'text-[#C0392B]' : 'text-[#444]'}`}>{g.confirmed} / {g.max_players}</div>
                                {isSelected && <div className="text-[#C0392B] text-xs">✓</div>}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )
                  )}

                  {/* Создать свою игру */}
                  {customGameOpen && (
                    <div className="flex flex-col gap-2">
                      <input
                        type="text"
                        value={customGameTitle}
                        onChange={e => setCustomGameTitle(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && customGameTitle.trim()) {
                            void handleSelectTournament(customGameTitle.trim(), null);
                            setCustomGameTitle('');
                          }
                        }}
                        placeholder="Название игры..."
                        className="bg-[#0A0A0A] border border-[#2D2D2D] rounded-xl px-4 py-3 text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#C0392B]"
                      />
                      <button
                        onClick={() => {
                          if (!customGameTitle.trim()) return;
                          void handleSelectTournament(customGameTitle.trim(), null);
                          setCustomGameTitle('');
                        }}
                        disabled={!customGameTitle.trim()}
                        className="admin-btn-primary py-3 text-sm disabled:opacity-30"
                      >
                        Создать игру
                      </button>
                    </div>
                  )}

                  {/* Сбросить выбор */}
                  {gameState.tournamentTitle && (
                    <button
                      onClick={() => updateGameState({ tournamentTitle: '', tournamentBotId: null })}
                      className="text-[#444] text-xs text-center hover:text-[#888] py-1"
                    >
                      Сбросить выбор
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ── Следующая игра ──────────────────────────────────── */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <button
                onClick={() => setNextGamePickerOpen(o => !o)}
                className="flex items-center justify-between w-full"
              >
                <div className="text-sm">
                  {gameState.nextGameBotId != null
                    ? (() => {
                        const found = botGames.find(g => g.id === gameState.nextGameBotId);
                        return found
                          ? <span className="text-white font-bold">Далее: {found.title}</span>
                          : <span className="text-[#888]">Следующая игра (ID: {gameState.nextGameBotId})</span>;
                      })()
                    : <span className="text-[#888]">Выбрать следующую игру</span>}
                </div>
                <span className="text-[#555] text-xs ml-2">{nextGamePickerOpen ? '▲' : '▼'}</span>
              </button>

              {nextGamePickerOpen && (
                <div className="mt-3 flex flex-col gap-2">
                  {botGames.length === 0 ? (
                    <div className="text-[#444] text-sm">Загрузка игр из бота...</div>
                  ) : (
                    botGames.map(g => {
                      const isSelected = gameState.nextGameBotId === g.id;
                      const d = new Date(g.date);
                      const dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                      return (
                        <button
                          key={g.id}
                          onClick={() => {
                            updateGameState({
                              nextGameBotId: isSelected ? null : g.id,
                              nextGameInfo: isSelected ? gameState.nextGameInfo : formatNextGameFallback(g),
                            });
                            setNextGamePickerOpen(false);
                          }}
                          className={`flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all ${
                            isSelected
                              ? 'border-[#C0392B] bg-[#1a0a00] text-white'
                              : 'border-[#2D2D2D] bg-[#0A0A0A] text-[#888] hover:border-[#444]'
                          }`}
                        >
                          <div>
                            <div className={`font-bold uppercase text-sm ${isSelected ? 'text-white' : 'text-[#666]'}`}>{g.title}</div>
                            <div className="text-xs text-[#444] mt-0.5">{dateStr}</div>
                          </div>
                          <div className="text-right ml-3">
                            <div className={`text-sm font-bold ${isSelected ? 'text-[#C0392B]' : 'text-[#444]'}`}>{g.confirmed} / {g.max_players}</div>
                            {isSelected && <div className="text-[#C0392B] text-xs">✓</div>}
                          </div>
                        </button>
                      );
                    })
                  )}
                  {gameState.nextGameBotId != null && (
                    <button
                      onClick={() => updateGameState({ nextGameBotId: null })}
                      className="text-[#444] text-xs text-center hover:text-[#888] py-1"
                    >
                      Сбросить выбор
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ── Связь экранов ───────────────────────────────────── */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="text-white font-bold text-sm">Связь</div>
                  <div className="text-[#555] text-xs mt-0.5">
                    Supabase: {syncReady && authoritativeReady && !syncError ? 'онлайн' : 'проверка связи'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleForceSyncDisplays()}
                    disabled={displayForceSyncBusy}
                    className={`rounded-full border px-3 py-1 text-xs font-bold active:scale-95 transition-all disabled:opacity-50 ${
                      displayForceSyncResult === 'ok'
                        ? 'border-green-700 bg-green-950 text-green-300'
                        : displayForceSyncResult === 'error'
                          ? 'border-red-700 bg-red-950 text-red-300'
                          : 'border-[#C0392B]/70 bg-[#1A0A0A] text-red-200'
                    }`}
                  >
                    {displayForceSyncBusy ? 'Синхр...' : displayForceSyncResult === 'ok' ? '✓ Отправлено' : displayForceSyncResult === 'error' ? '✕ Ошибка' : 'Синхронизировать'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDisplayClientsCollapsed(prev => !prev)}
                    className="rounded-full border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-1 text-xs font-bold text-[#999] active:scale-95 transition-transform"
                  >
                    {displayClientsCollapsed ? 'Показать' : 'Скрыть'}
                  </button>
                  <div className={`rounded-full px-3 py-1 text-xs font-bold ${
                    onlineDisplayClients.length > 0
                      ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-900/60'
                      : 'bg-[#0A0A0A] text-[#777] border border-[#2D2D2D]'
                  }`}>
                    Экраны: {onlineDisplayClients.length} онлайн
                  </div>
                </div>
              </div>

              {syncError && (
                <div className="mb-3 rounded-xl border border-red-900/60 bg-red-950/30 px-3 py-2 text-red-300 text-xs">
                  {syncError}
                </div>
              )}

              {displayClientsCollapsed ? (
                <div className="rounded-xl border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-3 text-[#666] text-sm">
                  Список экранов скрыт · всего {displayClients.length}
                </div>
              ) : !displayPresenceEnabled ? (
                <div className="rounded-xl border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-3 text-[#666] text-sm">
                  Supabase не настроен, статусы экранов доступны только на рабочем сайте.
                </div>
              ) : displayClientsError ? (
                <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 px-3 py-3 text-amber-200 text-sm">
                  {displayClientsError}
                </div>
              ) : displayClients.length === 0 ? (
                <div className="rounded-xl border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-3 text-[#666] text-sm">
                  Откройте экран Display на телевизоре, и он появится здесь в течение нескольких секунд.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {[...onlineDisplayClients, ...offlineDisplayClients].slice(0, 6).map((client, index) => {
                    const online = isDisplayClientOnline(client, presenceNow);

                    return (
                      <div
                        key={client.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-white text-sm font-bold truncate">
                            {client.name} #{index + 1}
                          </div>
                          <div className="text-[#666] text-xs truncate">
                            {client.currentLevelLabel || `Уровень ${client.currentLevelIndex + 1}`} · {formatDisplayStatus(client.status)}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-xs font-bold ${online ? 'text-emerald-300' : 'text-[#777]'}`}>
                            {online ? 'онлайн' : 'офлайн'}
                          </div>
                          <div className="text-[#555] text-[11px]">
                            {formatPresenceAge(client.lastSeenAt, presenceNow)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Статус турнира ───────────────────────────────────── */}
            {gameState.status === 'ended' ? (
              /* Экран завершения */
              <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-5 text-center flex flex-col gap-4">
                <div className="text-white font-black text-xl uppercase tracking-widest">Турнир завершён</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="bg-[#0A0A0A] rounded-xl p-3">
                    <div className="text-[#555] text-xs uppercase mb-1">Игроков</div>
                    <div className="text-white font-black text-2xl">{gameState.players}</div>
                  </div>
                  <div className="bg-[#0A0A0A] rounded-xl p-3">
                    <div className="text-[#555] text-xs uppercase mb-1">Ребаев</div>
                    <div className="text-white font-black text-2xl">{gameState.rebuys ?? 0}</div>
                  </div>
                  <div className="bg-[#0A0A0A] rounded-xl p-3">
                    <div className="text-[#555] text-xs uppercase mb-1">Аддонов</div>
                    <div className="text-white font-black text-2xl">{gameState.addonCount ?? 0}</div>
                  </div>
                  <div className="bg-[#0A0A0A] rounded-xl p-3">
                    <div className="text-[#555] text-xs uppercase mb-1">Бонусов</div>
                    <div className="text-white font-black text-2xl">{gameState.bonusCount ?? 0}</div>
                  </div>
                </div>
                <div className="bg-[#0A0A0A] rounded-xl p-3">
                  <div className="text-[#555] text-xs uppercase mb-1">Всего фишек в игре</div>
                  <div className="text-[#C0392B] font-black text-3xl">{(gameState.totalStack ?? 0).toLocaleString('ru-RU')}</div>
                </div>
                {playersMissingFinalPlace > 0 && (
                  <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
                    Итоги ещё не готовы к отправке: без финального места осталось {playersMissingFinalPlace}. Откройте окно `Итоги и отправка`, проверьте результаты и довыставьте выбывших.
                  </div>
                )}
                {duplicateResultPlaces.length > 0 && (
                  <div className="rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                    Итоги ещё не готовы к отправке: дублируются места {duplicateResultPlacesLabel}. Откройте окно `Итоги и отправка` и исправьте повторы.
                  </div>
                )}
                {resultsAlreadyCurrent && (
                  <div className="rounded-xl border border-green-900/60 bg-green-950/30 px-4 py-3 text-sm text-green-200">
                    Итоги уже отправлены в бот{resultsSentLabel ? ` · ${resultsSentLabel}` : ''}. Можно открыть детали итогов или сразу начать новый турнир.
                  </div>
                )}
                {resultsNeedResubmit && (
                  <div className="rounded-xl border border-blue-900/60 bg-blue-950/30 px-4 py-3 text-sm text-blue-200">
                    После прошлой отправки результаты были изменены. Откройте окно `Итоги и отправка`, чтобы отправить обновлённую версию.
                  </div>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    onClick={() => { setFinishReviewOpen(true); setFinishStep('review'); }}
                    className="admin-btn-secondary py-4 text-sm font-bold"
                  >
                    {resultsAlreadyCurrent ? '🧾 Итоги отправлены' : '🧾 Итоги и отправка'}
                  </button>
                  <button
                    onClick={() => void confirmStartNewTournament()}
                    disabled={newTournamentBusy}
                    className="admin-btn-primary py-4 text-sm font-bold disabled:opacity-40"
                  >
                    {newTournamentBusy ? 'Сохранение...' : '↺ Новый турнир'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Timer display */}
                <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
                  {/* Прогресс уровней */}
                  {(() => {
                    const total = blindLevels.length;
                    const cur = gameState.currentLevelIndex;
                    return total > 0 ? (
                      <div className="mb-4">
                        <div className="flex justify-between text-xs text-[#444] mb-1">
                          <span>
                            {currentLevel?.isBreak
                              ? (currentLevel.breakLabel || 'ПЕРЕРЫВ')
                              : currentKnockoutLabel
                              ? `${currentKnockoutLabel} · ур. ${currentLevel?.level ?? '—'}`
                              : `Уровень ${currentLevel?.level ?? '—'}`}
                          </span>
                          <span>{cur + 1} / {total}</span>
                        </div>
                        <div className="h-1.5 bg-[#1E1E1E] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#C0392B] rounded-full transition-all"
                            style={{ width: `${((cur + 1) / total) * 100}%` }}
                          />
                        </div>
                      </div>
                    ) : null;
                  })()}

                  {/* Время + статус */}
                  <div className="flex items-center justify-between gap-3">
                    <div
                      className="font-mono font-black tabular-nums"
                      style={{ fontSize: 'clamp(44px, 12vw, 72px)', lineHeight: 1 }}
                    >
                      {gameState.status === 'idle'
                        ? <span className="text-[#444]">--:--</span>
                        : <span className={gameState.timeLeft <= 60 && isRunning ? 'text-[#C0392B]' : 'text-white'}>
                            {String(minutes).padStart(2,'0')}:{String(seconds).padStart(2,'0')}
                          </span>
                      }
                    </div>
                    <div className="text-right">
                      <StatusBadge status={gameState.status} />
                      {currentLevel && !currentLevel.isBreak && (
                        <div className="text-[#555] text-xs mt-2">
                          {currentLevel.sb} / {currentLevel.bb}
                          {currentLevel.ante > 0 ? ` + ${currentLevel.ante}` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                  {(currentKnockoutLabel || nextKnockout) && (
                    <div className="mt-4 rounded-xl border border-[#1F1F1F] bg-[#0A0A0A] px-3 py-3">
                      <div className="text-[#E31E24] text-[11px] font-bold uppercase tracking-[0.2em]">
                        Игра на вылет
                      </div>
                      {currentKnockoutLabel ? (
                        <div className="mt-1 text-white text-sm font-medium">
                          {currentKnockoutLabel} уже идёт на текущем уровне.
                        </div>
                      ) : nextKnockout && nextKnockoutTime ? (
                        <>
                          <div className="mt-1 text-white text-sm font-medium">
                            Через {Math.floor(nextKnockout.secondsUntil / 60)} мин
                            {nextKnockout.levelsUntil > 1 ? ` · через ${nextKnockout.levelsUntil - 1} уров.` : ''}
                          </div>
                          <div className="text-[#666] text-xs mt-1">
                            Примерно в {nextKnockoutTime}
                          </div>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>

                {/* Play/Pause — большая кнопка */}
                <button
                  onClick={isRunning ? pauseTimer : (gameState.status === 'idle' ? handleOpenPriceConfirm : startTimer)}
                  className={`w-full py-5 rounded-xl font-black text-2xl tracking-wide transition-colors ${
                    isRunning
                      ? 'bg-[#2D2D2D] hover:bg-[#3D3D3D] text-white'
                      : 'bg-[#C0392B] hover:bg-[#E31E24] text-white'
                  }`}
                >
                  {isRunning ? '⏸ Пауза' : gameState.status === 'idle' ? '▶ Начать ведение' : '▶ Запустить'}
                </button>

                {/* Уровни и сброс */}
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={prevLevel} className="admin-btn-secondary py-4 text-base">← Уровень</button>
                  <button onClick={nextLevel} className="admin-btn-secondary py-4 text-base">Уровень →</button>
                  <button
                    onClick={() => {
                      const lvl = blindLevels[gameState.currentLevelIndex];
                      if (lvl) updateGameState({ timeLeft: lvl.duration });
                    }}
                    className="admin-btn-secondary py-4 text-sm"
                  >
                    ↺ Сбросить время
                  </button>
                  <button
                    onClick={() => { setFinishReviewOpen(true); setFinishStep('review'); }}
                    className="admin-btn-danger py-4 text-sm"
                  >
                    ✕ Завершить
                  </button>
                </div>
              </>
            )}

            {/* Time adjustment — 3x2 grid */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <div className="text-[#888] text-xs uppercase tracking-widest mb-3">Корректировка времени</div>
              <div className="grid grid-cols-3 gap-2">
                {([-60, -300, -600, +60, +300, +600] as const).map(delta => {
                  const isNeg = delta < 0;
                  const abs = Math.abs(delta);
                  const label = `${abs / 60} мин`;
                  return (
                    <button
                      key={delta}
                      onClick={() => updateGameState({ timeLeft: Math.max(0, gameState.timeLeft + delta) })}
                      className={`py-3 rounded-lg font-bold text-sm transition-colors ${
                        isNeg
                          ? 'bg-red-900/60 hover:bg-red-800 text-red-300'
                          : 'bg-green-900/60 hover:bg-green-800 text-green-300'
                      }`}
                    >
                      {isNeg ? '−' : '+'}{label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Player / Stack */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4 flex flex-col gap-4">
              <div className="text-[#888] text-xs uppercase tracking-widest">Участники и стеки</div>
              {managedPlayerCountsActive && (
                <div className="rounded-xl border border-blue-900/40 bg-blue-950/20 px-3 py-2 text-blue-200 text-xs">
                  Игроки, ауты и ребаи считаются по вкладке «Игроки». Аддоны и бонусы можно добавлять здесь сверх тех, что привязаны к игрокам.
                </div>
              )}

              {/* Стартовый стек */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[#666] text-xs block mb-1">Стартовый стек</label>
                  <input
                    type="number"
                    className="admin-input"
                    value={gameState.startStack || ''}
                    onChange={e => {
                      updateStackState({ startStack: Number(e.target.value) });
                    }}
                    placeholder="напр. 15000"
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="text-[#666] text-xs block mb-1">Стек аддона</label>
                  <input
                    type="number"
                    className="admin-input"
                    value={gameState.addonStack || ''}
                    onChange={e => {
                      updateStackState({ addonStack: Number(e.target.value) });
                    }}
                    placeholder="напр. 20000"
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="text-[#666] text-xs block mb-1">Стек бонуса</label>
                  <input
                    type="number"
                    className="admin-input"
                    value={gameState.bonusStack || ''}
                    onChange={e => {
                      updateStackState({ bonusStack: Number(e.target.value) });
                    }}
                    placeholder="напр. 5000"
                    inputMode="numeric"
                  />
                </div>
              </div>

              {/* Игроки · Ребаи · Аддоны · Бонусы */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <CounterBlock
                  label="Игроки"
                  value={gameState.players ?? 0}
                  disabled={managedPlayerCountsActive}
                  onAdd={() => updateStackState({ players: (gameState.players ?? 0) + 1 })}
                  onRemove={() => updateStackState({ players: Math.max(0, (gameState.players ?? 0) - 1) })}
                />
                <CounterBlock
                  label="Ребаи"
                  value={gameState.rebuys ?? 0}
                  disabled={managedPlayerCountsActive}
                  onAdd={() => updateStackState({ rebuys: (gameState.rebuys ?? 0) + 1 })}
                  onRemove={() => updateStackState({ rebuys: Math.max(0, (gameState.rebuys ?? 0) - 1) })}
                />
                <ExtraCounterBlock
                  label="Аддоны"
                  total={gameState.addonCount ?? 0}
                  locked={managedPlayerCountsActive ? (gameState.addonCount ?? 0) - (gameState.extraAddonCount ?? 0) : 0}
                  extra={gameState.extraAddonCount ?? 0}
                  onAdd={() => updateStackState({ extraAddonCount: (gameState.extraAddonCount ?? 0) + 1, addonCount: (gameState.addonCount ?? 0) + 1 })}
                  onRemove={() => {
                    const extra = gameState.extraAddonCount ?? 0;
                    if (extra <= 0) return;
                    updateStackState({ extraAddonCount: extra - 1, addonCount: (gameState.addonCount ?? 0) - 1 });
                  }}
                />
                <ExtraBonusBlock
                  label="Бонусы"
                  total={gameState.bonusCount ?? 0}
                  locked={managedPlayerCountsActive ? (gameState.bonusCount ?? 0) - (gameState.extraBonusCount ?? 0) : 0}
                  extra={gameState.extraBonusCount ?? 0}
                  onAdd={() => updateStackState({ extraBonusCount: (gameState.extraBonusCount ?? 0) + 1, bonusCount: (gameState.bonusCount ?? 0) + 1 })}
                  onRemove={() => {
                    const extra = gameState.extraBonusCount ?? 0;
                    if (extra <= 0) return;
                    updateStackState({ extraBonusCount: extra - 1, bonusCount: (gameState.bonusCount ?? 0) - 1 });
                  }}
                  onSetExtra={value => {
                    const locked = managedPlayerCountsActive ? (gameState.bonusCount ?? 0) - (gameState.extraBonusCount ?? 0) : 0;
                    updateStackState({ extraBonusCount: value, bonusCount: locked + value });
                  }}
                />
              </div>

              {/* Итого */}
              {gameState.totalStack > 0 && (
                <div className="bg-[#0A0A0A] rounded-xl px-4 py-3 flex items-center justify-between">
                  <span className="text-[#666] text-sm">Общий стек</span>
                  <span className="text-white font-black text-2xl">
                    {gameState.totalStack.toLocaleString('ru-RU')}
                  </span>
                </div>
              )}
            </div>

            {/* Ауты */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <div className="text-[#888] text-xs uppercase tracking-widest mb-3">Выбыли</div>
              <div className="flex items-center gap-4">
                <div className="w-32 flex-shrink-0">
                  <CounterBlock
                    label="Ауты"
                    value={gameState.outs ?? 0}
                    disabled={managedPlayerCountsActive}
                    onAdd={() => updateGameState({ outs: Math.min((gameState.players ?? 0), (gameState.outs ?? 0) + 1) })}
                    onRemove={() => updateGameState({ outs: Math.max(0, (gameState.outs ?? 0) - 1) })}
                  />
                </div>
                {(gameState.players ?? 0) > 0 && (
                  <div className="text-sm leading-relaxed">
                    <div className="text-[#555] mb-1 text-xs">Осталось в игре</div>
                    <div>
                      <span className="text-white font-black text-4xl">
                        {(gameState.players ?? 0) - (gameState.outs ?? 0)}
                      </span>
                      <span className="text-[#444] text-xl"> / {gameState.players}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Chip leaders */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="text-[#888] text-xs uppercase tracking-widest">Чип-лидеры на табло</div>
                  <div className="text-[#555] text-xs mt-1">
                    {chipLeaderTargetLevel?.isBreak
                      ? 'Текущий перерыв: дилеры могут отправить стеки автоматически'
                      : gameState.chipLeaderCollectionActive
                      ? 'Ручной сбор активен: кнопка доступна у дилеров'
                      : 'В перерывах кнопка появляется у дилеров автоматически. Вне перерыва запустите сбор вручную.'}
                    {chipLeadersSavedForTarget > 0 ? ` · сохранено ${chipLeadersSavedForTarget}/3` : ''}
                  </div>
                </div>
                {gameState.chipLeaders && (
                  <button
                    onClick={clearChipLeaders}
                    className="text-[#666] hover:text-white text-xs px-2 py-1 rounded-lg bg-[#0A0A0A] border border-[#2D2D2D]"
                  >
                    Скрыть
                  </button>
                )}
              </div>

              {chipLeaderCandidatePlayers.length === 0 ? (
                <div className="rounded-xl border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-3 text-[#666] text-sm">
                  Нет активных игроков. Отметьте игроков во вкладке `Игроки`, чтобы они появились в списке.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => void startChipLeaderCollection()}
                    disabled={gameState.chipLeaderCollectionActive}
                    className="admin-btn-secondary py-3 text-sm disabled:opacity-40"
                  >
                    {gameState.chipLeaderCollectionActive ? 'Сбор чип-лидеров запущен' : 'Запустить сбор чип-лидеров'}
                  </button>

                  {chipLeaderDraft.map((row, index) => {
                    const selectedPlayerIds = new Set(
                      chipLeaderDraft
                        .filter(other => other.id !== row.id && other.playerId)
                        .map(other => other.playerId)
                    );

                    return (
                      <div key={row.id} className="grid grid-cols-[36px_1fr_120px] gap-2 items-center">
                        <div className="text-[#555] font-black text-lg text-center">{index + 1}</div>
                        <select
                          className="admin-input"
                          value={row.playerId}
                          onChange={e => selectChipLeaderPlayer(row.id, e.target.value)}
                        >
                          <option value="">Игрок</option>
                          {chipLeaderCandidatePlayers.map(player => (
                            <option
                              key={player.id}
                              value={player.id}
                              disabled={selectedPlayerIds.has(player.id)}
                            >
                              {player.name}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          className="admin-input"
                          value={row.stack}
                          onChange={e => updateChipLeaderDraft(row.id, { stack: e.target.value })}
                          placeholder="Фишки"
                          inputMode="numeric"
                          min={0}
                        />
                      </div>
                    );
                  })}

                  <button
                    onClick={() => void saveChipLeaders()}
                    disabled={!canSaveChipLeaders || !chipLeaderTargetLevel}
                    className="admin-btn-primary py-3 text-sm disabled:opacity-30"
                  >
                    Показать чип-лидеров на табло
                  </button>
                  {chipLeaderSaveError && (
                    <div className="rounded-xl border border-red-900/60 bg-red-950/30 px-3 py-2 text-red-300 text-xs">
                      {chipLeaderSaveError}
                    </div>
                  )}
                  {chipLeaderSaveNote && !chipLeaderSaveError && (
                    <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/20 px-3 py-2 text-emerald-300 text-xs">
                      {chipLeaderSaveNote}
                    </div>
                  )}
                  <div className="text-[#555] text-xs">
                    Табло будет чередовать очки турнира и чип-лидеров каждые 20 секунд, затем само вернётся к обычному режиму после одного уровня.
                  </div>
                </div>
              )}
            </div>

            {/* Rating toggle */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-white font-medium text-sm">Показать рейтинг на экране</div>
                  <div className="text-[#555] text-xs mt-0.5">Заменяет таймер на таблицу рейтинга</div>
                </div>
                <button
                  onClick={() => updateGameState({ showRating: !gameState.showRating, showLogo: false })}
                  className={`w-14 h-7 rounded-full transition-colors flex-shrink-0 ml-4 ${
                    gameState.showRating ? 'bg-[#C0392B]' : 'bg-[#2D2D2D]'
                  }`}
                >
                  <div className={`w-6 h-6 bg-white rounded-full mx-0.5 transition-transform ${
                    gameState.showRating ? 'translate-x-7' : 'translate-x-0'
                  }`} />
                </button>
              </div>
            </div>

            {/* Logo toggle */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-white font-medium text-sm">Показать логотип на экране</div>
                  <div className="text-[#555] text-xs mt-0.5">Заменяет таймер на логотип клуба</div>
                </div>
                <button
                  onClick={() => updateGameState({ showLogo: !gameState.showLogo, showRating: false })}
                  className={`w-14 h-7 rounded-full transition-colors flex-shrink-0 ml-4 ${
                    gameState.showLogo ? 'bg-[#C0392B]' : 'bg-[#2D2D2D]'
                  }`}
                >
                  <div className={`w-6 h-6 bg-white rounded-full mx-0.5 transition-transform ${
                    gameState.showLogo ? 'translate-x-7' : 'translate-x-0'
                  }`} />
                </button>
              </div>
            </div>

          </div>
        )}

        {activeTab === 'players' && (
          <div className="flex flex-col gap-4">
            <TournamentPlayersTab
              groupedPlayers={groupedPlayers}
              playerSyncState={playerSyncState}
              playerBackups={playerBackups}
              botSyncState={botSyncState}
              tournamentBotId={gameState.tournamentBotId}
              tournamentDate={selectedBotGame?.date ?? null}
              earlyBirdBonusEnabled={selectedTournamentIsClassic}
              isTournamentEnded={false}
              preferMobileCards={tabletAdminLayout}
              reviewPlayers={[]}
              cashAdditionalContent={(
                <div>
                  <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Персонал</div>
                      <div className="mt-1 text-xs text-[#555]">
                        Выплаты сохраняются автоматически и синхронизируются между устройствами.
                      </div>
                    </div>
                    <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:shrink-0 sm:justify-start">
                      {finishPersonnel.length > 0 && (
                        <div className="text-right">
                          <div className="text-sm font-black tabular-nums text-white">
                            {personnelTotals(finishPersonnel).total.toLocaleString('ru-RU')} ₽
                          </div>
                          <div className="text-[10px] text-[#555]">{finishPersonnel.length} чел.</div>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => personnelEditorOpen ? void finishPersonnelEditing() : setPersonnelEditorOpen(true)}
                        disabled={staffBusy}
                        className="admin-btn-secondary min-h-10 px-4 py-2 text-xs transition-transform active:scale-[0.96] disabled:opacity-40"
                      >
                        {staffBusy ? 'Сохранение...' : personnelEditorOpen ? 'Готово' : finishPersonnel.length > 0 ? 'Изменить' : '+ Добавить'}
                      </button>
                    </div>
                  </div>
                  {personnelSyncError && (
                    <div className="mb-3 rounded-xl border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                      {personnelSyncError}
                    </div>
                  )}
                  {personnelEditorOpen ? (
                    <PersonnelForm
                      value={finishPersonnel}
                      onChange={handlePersonnelChange}
                      staffMembers={staffMembers}
                    />
                  ) : finishPersonnel.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {finishPersonnel.map(record => (
                        <div key={record.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#111] px-3 py-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-white">{record.name || 'Без имени'}</div>
                            <div className="text-[10px] text-[#555]">{formatPersonnelRole(record)}</div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-sm font-black tabular-nums text-white">
                              {(record.cashAmount + record.cardAmount).toLocaleString('ru-RU')} ₽
                            </div>
                            <div className="text-[10px] text-[#555]">
                              {formatPersonnelRole(record)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl bg-[#111] px-3 py-3 text-xs text-[#555]">
                      Выплаты персоналу не добавлены.
                    </div>
                  )}
                </div>
              )}
              tableCount={gameState.tableCount}
              onOpenControlTab={() => {}}
              onRefreshFromBot={refreshFromBot}
              onAddManualPlayer={addManualPlayer}
              onRemovePlayer={removePlayer}
              onUpdatePlayerField={updatePlayerField}
              onSetPlayerArrival={setPlayerArrival}
              onMarkPlayerOut={markPlayerOut}
              onRestorePlayer={restorePlayer}
              onRestorePlayersFromBackup={restorePlayersFromBackup}
              onAssignSeat={async (playerId, tableNumber, seatNumber) => {
                await assignPlayerSeat(playerId, tableNumber, seatNumber);
              }}
              knownPlayers={knownPlayersWithBot}
            />

          </div>
        )}

        {/* ─── TABLES TAB ──────────────────────────────────────────────── */}
        {activeTab === 'tables' && (
          <TablesTab
            tableCount={gameState.tableCount}
            players={tournamentPlayers}
            onUpdateTableCount={count => void updateGameState({ tableCount: count })}
            onAssignSeat={async (playerId, tableNumber, seatNumber) => {
              await assignPlayerSeat(playerId, tableNumber, seatNumber);
            }}
            onUpdatePlayerField={updatePlayerField}
            onMarkPlayerOut={markPlayerOut}
          />
        )}

        {/* ─── NOTIFICATIONS TAB ───────────────────────────────────────── */}
        {activeTab === 'notifications' && (
          <NotificationsTab
            notifications={floorNotifications}
            onConfirm={handleConfirmNotification}
            onReject={handleRejectNotification}
          />
        )}

        {/* ─── BLINDS TAB ──────────────────────────────────────────────── */}
        {activeTab === 'blinds' && (
          <div className="flex flex-col gap-3">
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-[#888] text-xs uppercase tracking-widest">Анте</div>
                  <div className="text-[#555] text-xs mt-1">
                    Анте всегда равно BB. Здесь можно быстро включить его с нужного уровня, и эта схема сохранится в шаблонах.
                  </div>
                  <div className="text-[#555] text-xs mt-1">
                    {lateRegistrationLevel
                      ? `Поздняя регистрация сейчас отмечена до уровня ${lateRegistrationLevel.level}.`
                      : 'Позднюю регистрацию можно отметить на нужном уровне прямо в списке ниже.'}
                  </div>
                </div>

                <div className="w-full sm:w-[240px]">
                  <select
                    className="admin-input"
                    value={String(anteStartLevel)}
                    onChange={e => applyAnteStartLevel(Number(e.target.value))}
                    disabled={regularBlindLevels.length === 0}
                  >
                    <option value="0">Без анте</option>
                    {regularBlindLevels.map(level => (
                      <option key={level.id} value={level.level}>
                        С уровня {level.level}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[#888] text-xs uppercase tracking-widest">Шаблоны блайндов</div>
                    <div className="text-[#555] text-xs mt-1">
                      Сохраните текущую структуру под именем. В шаблон теперь входят уровни, стеки старта/аддона/бонуса и точка закрытия поздней регистрации.
                    </div>
                  </div>
                  <div className="rounded-full border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-1 text-[11px] uppercase tracking-wide text-[#777]">
                    {sharedBlindTemplateLibraryEnabled ? 'Общая библиотека' : 'Локально на этом устройстве'}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_220px] gap-2">
                  <input
                    className="admin-input"
                    placeholder="Название шаблона"
                    value={templateName}
                    onChange={e => setTemplateName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && void saveCurrentBlindTemplate()}
                  />
                  <button
                    onClick={() => void saveCurrentBlindTemplate()}
                    className={`admin-btn-primary px-4 py-3 text-sm ${templateBusy ? 'opacity-60 pointer-events-none' : ''}`}
                  >
                    {templateBusy ? 'Сохранение...' : 'Сохранить текущий шаблон'}
                  </button>
                </div>

                {templateError && (
                  <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                    {templateError}
                  </div>
                )}

                {templateNote && (
                  <div className="rounded-xl border border-[#3A3A3A] bg-[#0A0A0A] px-3 py-2 text-sm text-[#AAA]">
                    {templateNote}
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {allBlindTemplates.map(template => {
                    const templateLateRegistrationLevel = getLateRegistrationLevel(template.levels);

                    return (
                      <div key={template.id} className="rounded-2xl border border-[#2D2D2D] bg-[#0A0A0A] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-white font-bold text-sm">{template.name}</div>
                            <div className="text-[#666] text-xs mt-1">
                              Уровней: {template.levels.filter(level => !level.isBreak).length}
                              {template.levels.some(level => level.isBreak)
                                ? ` · Перерывов: ${template.levels.filter(level => level.isBreak).length}`
                                : ''}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#999]">
                              <span>Старт: {(template.startStack ?? 0).toLocaleString('ru-RU')}</span>
                              <span>Аддон: {(template.addonStack ?? 0).toLocaleString('ru-RU')}</span>
                              <span>Бонус: {(template.bonusStack ?? 0).toLocaleString('ru-RU')}</span>
                              {templateLateRegistrationLevel && (
                                <span>Поздняя рег. до ур. {templateLateRegistrationLevel.level}</span>
                              )}
                            </div>
                          </div>
                          {template.id.startsWith('preset_') && (
                            <span className="rounded-full bg-[#1F1F1F] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#AAA]">
                              Базовый
                            </span>
                          )}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={() => void applyBlindTemplate(template)}
                            className="admin-btn-primary px-4 py-2 text-sm"
                          >
                            Применить
                          </button>
                          {!template.id.startsWith('preset_') && (
                            <button
                              onClick={() => void removeBlindTemplate(template.id)}
                              className="admin-btn-danger px-4 py-2 text-sm"
                            >
                              Удалить
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-1">
              <button onClick={addBlindLevel} className="admin-btn-primary px-4 py-3 text-sm">+ Уровень</button>
              <button onClick={addBreak} className="admin-btn-secondary px-4 py-3 text-sm">+ Перерыв</button>
            </div>

            {blindLevels.map((level, idx) => (
              <div
                key={`${level.id}:${level.sb}:${level.bb}:${level.ante}:${level.duration}:${level.breakLabel || ''}:${level.isBreak ? 'break' : 'level'}`}
                ref={el => { rowEls.current[idx] = el; }}
                className="relative"
              >
                {/* Drop indicator line above this row */}
                {dropLine === idx && dragIdx !== null && dragIdx !== idx && (
                  <div className="absolute -top-1.5 left-10 right-0 h-0.5 bg-[#E31E24] rounded-full z-10 pointer-events-none" />
                )}

                <div className={`flex items-start gap-2 ${dragIdx === idx ? 'opacity-30' : ''}`}>
                  {/* Drag handle column */}
                  <div className="flex flex-col items-center gap-0.5 pt-2 flex-shrink-0">
                    <button
                      onClick={() => moveLevel(idx, -1)}
                      disabled={idx === 0}
                      className="w-8 h-7 flex items-center justify-center text-[#444] disabled:opacity-20 hover:text-white transition-colors text-xs"
                    >▲</button>
                    <div
                      className="w-8 h-8 flex items-center justify-center text-[#555] hover:text-[#888] text-xl select-none cursor-grab active:cursor-grabbing"
                      style={{ touchAction: 'none' }}
                      onPointerDown={e => {
                        e.preventDefault();
                        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                        dragging.current = true;
                        setDragIdx(idx);
                        setDropLine(null);
                      }}
                      onPointerMove={e => {
                        if (!dragging.current) return;
                        setDropLine(getDropLine(e.clientY));
                      }}
                      onPointerUp={commitDrop}
                      onPointerCancel={commitDrop}
                    >⠿</div>
                    <button
                      onClick={() => moveLevel(idx, 1)}
                      disabled={idx === blindLevels.length - 1}
                      className="w-8 h-7 flex items-center justify-center text-[#444] disabled:opacity-20 hover:text-white transition-colors text-xs"
                    >▼</button>
                  </div>

                  {/* Row content */}
                  <div className="flex-1 min-w-0">
                    <BlindRow
                      level={level}
                      onChange={l => updateLevel(idx, l)}
                      onDelete={() => deleteLevel(idx)}
                    />
                  </div>
                </div>
              </div>
            ))}

            {/* Drop indicator at end of list */}
            {dropLine === blindLevels.length && dragIdx !== null && (
              <div className="h-0.5 bg-[#E31E24] rounded-full ml-10" />
            )}
          </div>
        )}

        {/* ─── COMBOS TAB ──────────────────────────────────────────────── */}
        {activeTab === 'combos' && (
          <div className="flex flex-col gap-4">
            <button onClick={addCombo} className="admin-btn-primary px-4 py-3 text-sm">+ Добавить комбинацию</button>

            {combinations.map((combo, comboIdx) => (
              <div key={combo.id} className="bg-[#111] border border-[#2D2D2D] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[#888] text-sm">Комбо {comboIdx + 1}</span>
                    <button
                      onClick={() => updateCombo(comboIdx, { ...combo, enabled: !combo.enabled })}
                      className={`text-xs px-2 py-1 rounded ${combo.enabled ? 'bg-green-700 text-white' : 'bg-[#2D2D2D] text-[#666]'}`}
                    >
                      {combo.enabled ? 'Вкл' : 'Выкл'}
                    </button>
                  </div>
                  <button onClick={() => deleteCombo(comboIdx)} className="admin-btn-danger px-3 py-2 text-sm">✕</button>
                </div>

                {/* Cards */}
                <div className="flex items-center gap-1 flex-wrap mb-3">
                  {combo.cards.map((card, cardIdx) => (
                    <div key={cardIdx} className="relative group">
                      <PokerCard card={card} size="sm" />
                      <button
                        onClick={() => removeCardFromCombo(comboIdx, cardIdx)}
                        className="absolute -top-1 -right-1 bg-red-700 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center"
                      >✕</button>
                    </div>
                  ))}
                </div>
                <CardPicker onAdd={card => addCardToCombo(comboIdx, card)} />

                {/* Description */}
                <input
                  className="admin-input mt-3"
                  placeholder="Описание (напр: +5 очков к рейтингу)"
                  value={combo.description}
                  onChange={e => updateCombo(comboIdx, { ...combo, description: e.target.value })}
                />
              </div>
            ))}
          </div>
        )}

        {/* ─── ARCHIVE TAB ─────────────────────────────────────────────── */}
        {activeTab === 'archive' && (
          <div className="flex flex-col gap-3">
            <div className="text-[#555] text-xs uppercase tracking-widest mb-1">
              История завершённых турниров
            </div>

            {!archiveAuthed ? (
              <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-6 sm:p-8 w-full max-w-md">
                <div className="text-white font-black text-lg">Архив защищён</div>
                <div className="text-[#666] text-sm mt-2">
                  Чтобы открыть историю турниров и финансовые детали игроков, введите отдельный пароль архива.
                </div>
                <input
                  type="password"
                  className="admin-input mt-4"
                  value={archivePwInput}
                  onChange={e => setArchivePwInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleArchiveLogin()}
                  placeholder="Пароль архива"
                />
                {archivePwError && (
                  <div className="text-red-500 text-sm mt-3">Неверный пароль архива</div>
                )}
                <button
                  type="button"
                  onClick={handleArchiveLogin}
                  className="admin-btn-primary w-full py-3 mt-4"
                >
                  Открыть архив
                </button>
              </div>
            ) : (
              <>
                {/* Sub-tab switcher + period filter */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  {(['games', 'players', 'staff'] as const).map(tab => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => selectArchiveSubTab(tab)}
                      className={`admin-filter-button min-h-10 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors sm:px-4 ${
                        archiveSubTab === tab
                          ? 'bg-[#C0392B] text-white'
                          : 'bg-[#111] border border-[#2D2D2D] text-[#888] hover:text-white hover:border-[#555]'
                      }`}
                    >
                      {tab === 'games' ? 'Игры' : tab === 'players' ? 'Игроки' : 'Сотрудники'}
                    </button>
                  ))}
                  </div>
                  <div className="grid grid-cols-5 gap-1 sm:flex">
                    {(['7', '30', '90', '365', 'all'] as PeriodFilter[]).map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => selectArchivePeriod(p)}
                        className={`admin-filter-button min-h-10 px-2 py-2 rounded-lg text-xs font-bold transition-colors sm:px-3 ${
                          archivePeriod === p
                            ? 'bg-[#C0392B] text-white'
                            : 'bg-[#111] border border-[#2D2D2D] text-[#888] hover:text-white hover:border-[#555]'
                        }`}
                      >
                        {p === 'all' ? 'Все' : `${p}д`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── GAMES sub-tab ─────────────────────────────────────── */}
                {archiveSubTab === 'games' && (() => {
                  const cutoff = archivePeriod === 'all' ? 0 : presenceNow - Number(archivePeriod) * 24 * 60 * 60 * 1000;
                  const filteredTournaments = archivePeriod === 'all' ? tournaments : tournaments.filter(t => new Date(t.finished_at).getTime() >= cutoff);
                  return (
                  <>
                {!archiveLoading && filteredTournaments.length > 0 && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleExportFinancialXlsx(filteredTournaments)}
                      disabled={financialExportBusy}
                      className="admin-btn-secondary px-4 py-2 text-xs disabled:opacity-40"
                    >
                      {financialExportBusy ? 'Экспорт...' : '📊 Скачать финансовый отчёт'}
                    </button>
                  </div>
                )}
                {archiveLoading && (
                  <div className="text-[#444] text-sm text-center py-8">Загрузка...</div>
                )}

                {!archiveLoading && filteredTournaments.length === 0 && (
                  <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-8 text-center">
                    <div className="text-[#444] text-4xl mb-3">📋</div>
                    <div className="text-[#555] text-sm">Архив пуст</div>
                    <div className="text-[#333] text-xs mt-1">
                      После завершения турнира данные появятся здесь
                    </div>
                  </div>
                )}

                {filteredTournaments.map(t => {
                  const date = new Date(t.finished_at);
                  const dateStr = date.toLocaleDateString('ru-RU', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  });
                  const timeStr = date.toLocaleTimeString('ru-RU', {
                    hour: '2-digit', minute: '2-digit',
                  });
                  const archiveDetails = archiveDetailsById[t.id] ?? t.archive_details ?? null;
                  const archivePlayers = archiveDetails ? sortArchivePlayers(archiveDetails.players) : [];
                  const archiveCashTotal = archivePlayers.reduce((sum, p) => {
                    if (p.cashPaid != null) return sum + p.cashPaid;
                    return sum + (p.paymentMethod === 'cash' ? p.paymentDue : 0);
                  }, 0);
                  const archiveCardTotal = archivePlayers.reduce((sum, p) => {
                    if (p.cardPaid != null) return sum + p.cardPaid;
                    return sum + (p.paymentMethod === 'card' ? p.paymentDue : 0);
                  }, 0);
                  const archiveFullTotal = archivePlayers.reduce((sum, p) => {
                    if (p.arrivalStatus === 'promo' || p.arrivalStatus === 'freePromo') return sum + p.paymentDue * 2;
                    if (p.arrivalStatus === 'admin') return sum + (1 + p.rebuyCount + p.addonCount) * 1000;
                    return sum + p.paymentDue;
                  }, 0);
                  const archiveDiscountTotal = archiveFullTotal - (archiveDetails?.summary?.totalDue ?? 0);
                  return (
                    <div key={t.id} className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4 flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-white font-bold text-sm uppercase tracking-wide">
                            {t.title || 'Без названия'}
                          </div>
                          <div className="text-[#444] text-xs mt-0.5">{dateStr} · {timeStr}</div>
                        </div>
                        <div className="text-[#C0392B] font-black text-lg whitespace-nowrap">
                          {(t.total_stack ?? 0).toLocaleString('ru-RU')}
                          <span className="text-[#555] text-xs font-normal ml-1">фишек</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="bg-[#0A0A0A] rounded-xl p-2 text-center">
                          <div className="text-[#555] text-[10px] uppercase mb-0.5">Игроки</div>
                          <div className="text-white font-black text-lg">{t.players}</div>
                        </div>
                        <div className="bg-[#0A0A0A] rounded-xl p-2 text-center">
                          <div className="text-[#555] text-[10px] uppercase mb-0.5">Ребаи</div>
                          <div className="text-white font-black text-lg">{t.rebuys}</div>
                        </div>
                        <div className="bg-[#0A0A0A] rounded-xl p-2 text-center">
                          <div className="text-[#555] text-[10px] uppercase mb-0.5">Аддоны</div>
                          <div className="text-white font-black text-lg">{t.addon_count}</div>
                        </div>
                        <div className="bg-[#0A0A0A] rounded-xl p-2 text-center">
                          <div className="text-[#555] text-[10px] uppercase mb-0.5">Уровней</div>
                          <div className="text-white font-black text-lg">{t.levels_played}</div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <button
                          type="button"
                          onClick={() => void toggleArchiveDetails(t.id)}
                          className="admin-btn-secondary px-4 py-2 text-sm self-start"
                        >
                          {archiveOpenId === t.id ? 'Скрыть детали' : 'Открыть детали'}
                        </button>

                        {confirmDeleteId === t.id ? (
                          <div className="flex items-center gap-2 sm:ml-auto">
                            <span className="text-[#888] text-xs">Удалить?</span>
                            <button
                              onClick={async () => {
                                await deleteTournament(t.id);
                                setTournaments(prev => prev.filter(x => x.id !== t.id));
                                setArchiveDetailsById(prev => {
                                  const next = { ...prev };
                                  delete next[t.id];
                                  return next;
                                });
                                setArchiveOpenId(current => current === t.id ? null : current);
                                setConfirmDeleteId(null);
                              }}
                              className="text-[#C0392B] text-xs font-bold px-3 py-1 border border-[#C0392B] rounded-lg hover:bg-[#1a0a00] transition-colors"
                            >
                              Да, удалить
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-[#555] text-xs px-3 py-1 border border-[#2D2D2D] rounded-lg hover:text-[#888] transition-colors"
                            >
                              Отмена
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(t.id)}
                            className="text-[#333] text-xs hover:text-[#C0392B] transition-colors sm:ml-auto py-1"
                          >
                            Удалить
                          </button>
                        )}
                      </div>

                      {archiveOpenId === t.id && (
                        <div className="rounded-2xl border border-[#2D2D2D] bg-[#0A0A0A] p-4">
                          {archiveDetailsLoadingId === t.id ? (
                            <div className="text-[#666] text-sm">Загрузка деталей турнира...</div>
                          ) : !archiveDetails ? (
                            <div className="text-[#666] text-sm">
                              Детализация игроков для этого турнира не найдена. Подробный архив начал сохраняться только после включения новой версии.
                            </div>
                          ) : (
                            <div className="flex flex-col gap-3">
                              {archiveDetails.summary && (
                                <div className="flex flex-col gap-2">
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    <div className="bg-[#111] rounded-xl p-3">
                                      <div className="text-[#666] text-[10px] uppercase">Входов</div>
                                      <div className="text-white font-black text-lg mt-1">{archiveDetails.summary.entrants}</div>
                                    </div>
                                    <div className="bg-[#111] rounded-xl p-3">
                                      <div className="text-[#666] text-[10px] uppercase">Bounty</div>
                                      <div className="text-white font-black text-lg mt-1">{archiveDetails.summary.bountyTotal}</div>
                                    </div>
                                    <div className="bg-[#111] rounded-xl p-3">
                                      <div className="text-[#666] text-[10px] uppercase">Оплачено</div>
                                      <div className="text-white font-black text-lg mt-1">{archiveCashTotal + archiveCardTotal} ₽</div>
                                    </div>
                                    <div className="bg-[#111] rounded-xl p-3">
                                      <div className="text-[#666] text-[10px] uppercase">Сохранено</div>
                                      <div className="text-white font-black text-sm mt-1">
                                        {new Date(archiveDetails.savedAt).toLocaleString('ru-RU', {
                                          day: '2-digit',
                                          month: '2-digit',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}
                                      </div>
                                    </div>
                                  </div>
                                  <div className={`grid gap-2 grid-cols-2${archiveDiscountTotal > 0 ? ' sm:grid-cols-4' : ''}`}>
                                    <div className="bg-[#111] rounded-xl p-3">
                                      <div className="text-[#666] text-[10px] uppercase">Наличными</div>
                                      <div className="text-white font-black text-lg mt-1">{archiveCashTotal} ₽</div>
                                    </div>
                                    <div className="bg-[#111] rounded-xl p-3">
                                      <div className="text-[#666] text-[10px] uppercase">Картой</div>
                                      <div className="text-white font-black text-lg mt-1">{archiveCardTotal} ₽</div>
                                    </div>
                                    {archiveDiscountTotal > 0 && (
                                      <>
                                        <div className="bg-[#111] rounded-xl p-3">
                                          <div className="text-[#666] text-[10px] uppercase">Без скидок</div>
                                          <div className="text-white font-black text-lg mt-1">{archiveFullTotal} ₽</div>
                                        </div>
                                        <div className="bg-[#111] rounded-xl p-3">
                                          <div className="text-[#666] text-[10px] uppercase">Скидок на</div>
                                          <div className="text-[#C0392B] font-black text-lg mt-1">−{archiveDiscountTotal} ₽</div>
                                        </div>
                                      </>
                                    )}
                                  </div>

                                  {(() => {
                                    const currentPersonnel = mergePersonnelRecords(archiveDetails.personnel ?? []);
                                    const revenue = archiveCashTotal + archiveCardTotal;
                                    const { total: pTotal } = personnelTotals(currentPersonnel);
                                    const isExpanded = personnelExpandedId === t.id;
                                    const isEditing = editingPersonnelId === t.id;
                                    return (
                                      <div className="flex flex-col gap-2">
                                        <div className={`grid gap-2 ${revenue > 0 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                                          <button
                                            type="button"
                                            onClick={() => setPersonnelExpandedId(isExpanded ? null : t.id)}
                                            className="bg-[#111] rounded-xl p-3 text-left hover:bg-[#160808] transition-colors w-full"
                                          >
                                            <div className="flex items-center justify-between">
                                              <div className="text-[#666] text-[10px] uppercase">Расходы на персонал</div>
                                              <div className="text-[#444] text-[10px]">{isExpanded ? '▲' : '▼'}</div>
                                            </div>
                                            <div className={`font-black text-lg mt-1 ${pTotal > 0 ? 'text-[#C0392B]' : 'text-[#444]'}`}>
                                              {pTotal > 0 ? `${pTotal.toLocaleString('ru-RU')} ₽` : '—'}
                                            </div>
                                          </button>
                                          {revenue > 0 && (
                                            <div className="bg-[#111] rounded-xl p-3">
                                              <div className="text-[#666] text-[10px] uppercase">Чистый доход</div>
                                              <div className={`font-black text-lg mt-1 ${revenue - pTotal >= 0 ? 'text-green-400' : 'text-[#C0392B]'}`}>
                                                {(revenue - pTotal).toLocaleString('ru-RU')} ₽
                                              </div>
                                            </div>
                                          )}
                                        </div>

                                        {isExpanded && (
                                          <div className="rounded-xl border border-[#2D2D2D] bg-[#0A0A0A] p-3">
                                            <div className="flex items-center justify-between mb-2">
                                              <div className="text-[#666] text-[10px] uppercase">Кому и сколько</div>
                                              {!isEditing && (
                                                <button
                                                  type="button"
                                                  onClick={() => { setPersonnelDraft([...currentPersonnel]); setEditingPersonnelId(t.id); }}
                                                  className="text-[#555] text-xs hover:text-white transition-colors"
                                                >
                                                  {currentPersonnel.length > 0 ? 'Редактировать' : '+ Добавить'}
                                                </button>
                                              )}
                                            </div>
                                            {isEditing ? (
                                              <>
                                                <PersonnelForm value={personnelDraft} onChange={setPersonnelDraft} />
                                                <div className="flex gap-2 mt-3">
                                                  <button type="button" onClick={() => setEditingPersonnelId(null)} className="admin-btn-secondary px-4 py-2 text-sm">Отмена</button>
                                                  <button
                                                    type="button"
                                                    onClick={() => setPersonnelConfirm({
                                                      tournamentId: t.id,
                                                      finishedAt: t.finished_at,
                                                      oldPersonnel: currentPersonnel,
                                                      newPersonnel: personnelDraft,
                                                    })}
                                                    className="admin-btn-primary px-4 py-2 text-sm"
                                                  >
                                                    Сохранить
                                                  </button>
                                                </div>
                                              </>
                                            ) : currentPersonnel.length === 0 ? (
                                              <div className="text-[#444] text-xs">Не заполнено</div>
                                            ) : (
                                              <div className="flex flex-col gap-1.5">
                                                {currentPersonnel.map(p => (
                                                  <div key={p.id} className="flex flex-col gap-1 rounded-lg bg-[#111] p-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                                                    <div className="min-w-0">
                                                      <span className="text-white font-bold">{p.name || '—'}</span>
                                                      <span className="text-[#555] ml-1.5">({formatPersonnelRole(p)})</span>
                                                    </div>
                                                    <div className="shrink-0 text-[#888] text-left sm:text-right">
                                                      {(p.cashAmount + p.cardAmount).toLocaleString('ru-RU')} ₽
                                                    </div>
                                                  </div>
                                                ))}
                                                {personnelSavingId === t.id && <div className="text-[#888] text-xs mt-1">Сохранение...</div>}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </div>
                              )}

                              <div className="flex flex-col gap-2">
                                {archivePlayers.map(player => (
                                  <div key={player.id} className="rounded-xl border border-[#2D2D2D] bg-[#111] px-3 py-3">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                      <div className="min-w-0">
                                        <div className="text-white font-bold text-sm">{player.name}</div>
                                        <div className="text-[#666] text-xs mt-1">
                                          {formatArchiveStatus(player)} · {formatArchiveArrivalStatus(player.arrivalStatus)} · {formatArchivePayment(player)}
                                        </div>
                                      </div>
                                      <div className="text-left sm:text-right">
                                        <div className="text-white font-black text-lg">
                                          {player.place !== null ? `#${player.place}` : '—'}
                                        </div>
                                        <div className="text-[#666] text-[10px] uppercase">Место</div>
                                      </div>
                                    </div>

                                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                                      <div className="rounded-lg bg-[#0A0A0A] px-3 py-2 text-[#AAA]">Rebuy: <span className="text-white font-bold">{player.rebuyCount}</span></div>
                                      <div className="rounded-lg bg-[#0A0A0A] px-3 py-2 text-[#AAA]">Addon: <span className="text-white font-bold">{player.addonCount}</span></div>
                                      <div className="rounded-lg bg-[#0A0A0A] px-3 py-2 text-[#AAA]">Бонус: <span className="text-white font-bold">{player.bonusCount}</span></div>
                                      <div className="rounded-lg bg-[#0A0A0A] px-3 py-2 text-[#AAA]">Bounty: <span className="text-white font-bold">{player.bounty}</span></div>
                                      <div className="rounded-lg bg-[#0A0A0A] px-3 py-2 text-[#AAA]">
                                        К оплате: <span className="text-white font-bold">{player.paymentDue} ₽</span>
                                        {(player.arrivalStatus === 'promo' || player.arrivalStatus === 'freePromo') && (
                                          <div className="text-[#555] text-[10px] mt-0.5">без скидки: {player.paymentDue * 2} ₽</div>
                                        )}
                                        {player.arrivalStatus === 'admin' && (
                                          <div className="text-[#555] text-[10px] mt-0.5">без скидки: {(1 + player.rebuyCount + player.addonCount) * 1000} ₽</div>
                                        )}
                                      </div>
                                      <div className="rounded-lg bg-[#0A0A0A] px-3 py-2 text-[#AAA]">Оплата: <span className="text-white font-bold">{formatArchivePayment(player)}</span></div>
                                      <div className="rounded-lg bg-[#0A0A0A] px-3 py-2 text-[#AAA]">Источник: <span className="text-white font-bold">{player.source === 'manual' ? 'Вручную' : 'Бот'}</span></div>
                                      <div className="rounded-lg bg-[#0A0A0A] px-3 py-2 text-[#AAA]">Регистрация: <span className="text-white font-bold">{player.registrationSource === 'waitlist' ? 'Waitlist' : 'Основной'}</span></div>
                                    </div>
                                  </div>
                                ))}
                              </div>

                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                  </>
                  );
                })()}

                {/* ── PLAYERS sub-tab ───────────────────────────────────── */}
                {archiveSubTab === 'players' && (() => {
                  const allAggs = aggregatePlayerHistory(tournaments, archiveDetailsById);
                  const mergedAggs = mergeWithBotPlayerList(allAggs, botPlayerList ?? []);
                  const aggsWithHistory = mergedAggs.filter((a): a is MergedPlayerAggregate => !a.botOnly);
                  const botOnlyAggs = mergedAggs.filter((a): a is MergedPlayerAggregate => a.botOnly);
                  const loadedArchiveDetailsCount = tournaments.reduce((count, tournament) => (
                    archiveDetailsById[tournament.id]?.players?.length ? count + 1 : count
                  ), 0);
                  const query = playerHistorySearch.trim().toLowerCase();

                  const aggsWithStats = aggsWithHistory
                    .filter(a =>
                      !query ||
                      matchesSearchQuery(a.currentName, query) ||
                      matchesSearchQuery(a.currentUsername ?? '', query)
                    )
                    .map(agg => {
                      const entries = filterByPeriod(
                        [...agg.tournaments].sort((a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime()),
                        archivePeriod
                      );
                      const periodCash = entries.reduce((s, e) => s + e.cashPaid, 0);
                      const periodCard = entries.reduce((s, e) => s + e.cardPaid, 0);
                      const periodRebuys = entries.reduce((s, e) => s + e.rebuyCount, 0);
                      const periodAddons = entries.reduce((s, e) => s + e.addonCount, 0);
                      const periodBounty = entries.reduce((s, e) => s + e.bounty, 0);
                      const periodDiscount = entries.reduce((s, e) => {
                        if (e.arrivalStatus === 'promo' || e.arrivalStatus === 'freePromo') return s + e.paymentDue;
                        if (e.arrivalStatus === 'admin') return s + Math.max(0, (1 + e.rebuyCount + e.addonCount) * 1000 - e.paymentDue);
                        return s;
                      }, 0);
                      const placedEntries = entries.map(e => e.place).filter((p): p is number => p !== null);
                      const periodBest = placedEntries.length > 0 ? Math.min(...placedEntries) : null;
                      const avgSpend = entries.length > 0 ? (periodCash + periodCard) / entries.length : 0;
                      return { agg, entries, periodCash, periodCard, periodRebuys, periodAddons, periodBounty, periodBest, periodDiscount, avgSpend };
                    })
                    .filter(x => x.entries.length > 0)
                    .sort((a, b) => {
                      if (playerHistorySort === 'spend_desc') return (b.periodCash + b.periodCard) - (a.periodCash + a.periodCard);
                      if (playerHistorySort === 'spend_asc') return (a.periodCash + a.periodCard) - (b.periodCash + b.periodCard);
                      if (playerHistorySort === 'rebuys') return (b.periodRebuys + b.periodAddons) - (a.periodRebuys + a.periodAddons);
                      if (playerHistorySort === 'discount') return b.periodDiscount - a.periodDiscount;
                      if (playerHistorySort === 'avg_desc') return b.avgSpend - a.avgSpend;
                      return b.entries.length - a.entries.length || a.agg.currentName.localeCompare(b.agg.currentName, 'ru');
                    });

                  const botOnlyFiltered = botOnlyAggs
                    .filter(a =>
                      !query ||
                      matchesSearchQuery(a.currentName, query) ||
                      matchesSearchQuery(a.currentUsername ?? '', query)
                    )
                    .sort((a, b) => a.currentName.localeCompare(b.currentName, 'ru'));

                  const sortOptions: { key: 'games' | 'spend_desc' | 'spend_asc' | 'rebuys' | 'discount' | 'avg_desc'; label: string }[] = [
                    { key: 'games', label: 'Игры' },
                    { key: 'spend_desc', label: 'Сумма ↓' },
                    { key: 'spend_asc', label: 'Сумма ↑' },
                    { key: 'avg_desc', label: 'Ср. чек ↓' },
                    { key: 'rebuys', label: 'Ребаи' },
                    { key: 'discount', label: 'Скидки' },
                  ];

                  return (
                    <div className="flex flex-col gap-3">
                      {/* Controls */}
                      <div className="flex flex-col gap-2">
                        <input
                          type="text"
                          value={playerHistorySearch}
                          onChange={e => setPlayerHistorySearch(e.target.value)}
                          placeholder="Поиск по нику"
                          className="admin-input"
                        />
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[#444] text-[10px] uppercase tracking-wider mr-1">Сортировка:</span>
                          {sortOptions.map(({ key, label }) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setPlayerHistorySort(key)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                                playerHistorySort === key
                                  ? 'bg-[#C0392B] text-white'
                                  : 'bg-[#111] border border-[#2D2D2D] text-[#666] hover:text-white hover:border-[#555]'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[#555] text-[11px]">
                            Загружены списки игроков: {loadedArchiveDetailsCount} / {tournaments.length}
                          </div>
                          {allAggs.length > 0 && (
                            <button
                              type="button"
                              onClick={handleExportXlsx}
                              className="admin-btn-secondary px-3 py-1.5 text-xs shrink-0"
                            >
                              ↓ Выгрузить базу (.xlsx)
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => { void fetchBotPlayerListFromApi(); }}
                            disabled={botPlayerListLoading}
                            className="admin-btn-secondary px-3 py-1.5 text-xs shrink-0 disabled:opacity-50"
                          >
                            {botPlayerListLoading ? 'Загрузка...' : '↺ Обновить базу игроков'}
                          </button>
                          {botPlayerListCachedAt && !botPlayerListLoading && (
                            <span className="text-[#444] text-[11px]">
                              база из бота: {new Date(botPlayerListCachedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          {botPlayerListError && !botPlayerListLoading && (
                            <span className="text-[#C0392B] text-[11px]">{botPlayerListError}</span>
                          )}
                        </div>
                      </div>

                      {(archiveLoading || playerHistoryLoading) && (
                        <div className="text-[#444] text-sm text-center py-8">Загрузка...</div>
                      )}

                      {!archiveLoading && !playerHistoryLoading && aggsWithStats.length === 0 && botOnlyFiltered.length === 0 && (
                        <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-8 text-center">
                          <div className="text-[#555] text-sm">
                            {allAggs.length === 0 ? 'Нет данных — у турниров нет сохранённых списков игроков' : 'Никто не найден'}
                          </div>
                        </div>
                      )}

                      {aggsWithStats.map(({ agg, entries, periodCash, periodCard, periodRebuys, periodAddons, periodBounty, periodBest, periodDiscount, avgSpend }, idx) => {
                        const isExpanded = expandedPlayerKey === agg.key;

                        return (
                          <div key={agg.key} className="bg-[#111] border border-[#2D2D2D] rounded-2xl overflow-hidden">
                            <button
                              type="button"
                              onClick={() => setExpandedPlayerKey(isExpanded ? null : agg.key)}
                              className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-[#161616] transition-colors"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="shrink-0 text-[#444] text-[11px] font-mono w-5 text-right select-none">{idx + 1}</span>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <div className="text-white font-black text-sm truncate">{agg.currentName}</div>
                                    <span
                                      role="button"
                                      tabIndex={0}
                                      onClick={e => {
                                        e.stopPropagation();
                                        const contact = playerContacts[agg.key];
                                        setArchiveContactPlayer(agg);
                                        setContactEditMode(false);
                                        setContactDraft({
                                          realName: contact?.realName ?? '',
                                          phone: contact?.phone ?? '',
                                          instagram: contact?.instagram ?? '',
                                        });
                                      }}
                                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click(); }}
                                      className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full border border-[#3D3D3D] text-[#888] text-[11px] hover:border-[#888] hover:text-white transition-colors cursor-pointer"
                                      title="Контакты"
                                    >ⓘ</span>
                                  </div>
                                  {agg.currentUsername && (
                                    <div className="text-[#555] text-xs mt-0.5">@{agg.currentUsername.replace(/^@/, '')}</div>
                                  )}
                                </div>
                              </div>
                              <div className="shrink-0 flex items-center gap-3">
                                <div className="text-right">
                                  <div className="text-white font-black text-sm">{entries.length}</div>
                                  <div className="text-[#555] text-[10px] uppercase">игр</div>
                                </div>
                                {periodBest !== null && (
                                  <div className="text-right">
                                    <div className="text-white font-black text-sm">#{periodBest}</div>
                                    <div className="text-[#555] text-[10px] uppercase">лучшее</div>
                                  </div>
                                )}
                                <div className="text-[#555] text-xs font-bold">{isExpanded ? '▲' : '▼'}</div>
                              </div>
                            </button>

                            {isExpanded && (
                              <div className="border-t border-[#2D2D2D] px-4 py-3 flex flex-col gap-3">
                                {/* Aggregate stats */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                  <div className="rounded-xl bg-[#0A0A0A] px-3 py-2">
                                    <div className="text-[#555] text-[10px] uppercase">Наличными</div>
                                    <div className="text-white font-black text-base mt-0.5">{periodCash.toLocaleString('ru-RU')} ₽</div>
                                  </div>
                                  <div className="rounded-xl bg-[#0A0A0A] px-3 py-2">
                                    <div className="text-[#555] text-[10px] uppercase">Картой</div>
                                    <div className="text-white font-black text-base mt-0.5">{periodCard.toLocaleString('ru-RU')} ₽</div>
                                  </div>
                                  <div className="rounded-xl bg-[#0A0A0A] px-3 py-2">
                                    <div className="text-[#555] text-[10px] uppercase">Итого</div>
                                    <div className="text-white font-black text-base mt-0.5">{(periodCash + periodCard).toLocaleString('ru-RU')} ₽</div>
                                  </div>
                                  {avgSpend > 0 && (
                                    <div className="rounded-xl bg-[#0A0A0A] px-3 py-2">
                                      <div className="text-[#555] text-[10px] uppercase">Ср. чек</div>
                                      <div className="text-white font-black text-base mt-0.5">{Math.round(avgSpend).toLocaleString('ru-RU')} ₽</div>
                                    </div>
                                  )}
                                  <div className="rounded-xl bg-[#0A0A0A] px-3 py-2">
                                    <div className="text-[#555] text-[10px] uppercase">Ребай / Аддон</div>
                                    <div className="text-white font-black text-base mt-0.5">{periodRebuys} / {periodAddons}</div>
                                  </div>
                                  {periodBounty > 0 && (
                                    <div className="rounded-xl bg-[#0A0A0A] px-3 py-2">
                                      <div className="text-[#555] text-[10px] uppercase">Bounty</div>
                                      <div className="text-white font-black text-base mt-0.5">{periodBounty}</div>
                                    </div>
                                  )}
                                  {periodDiscount > 0 && (
                                    <div className="rounded-xl bg-[#0A0A0A] px-3 py-2">
                                      <div className="text-[#555] text-[10px] uppercase">Скидок</div>
                                      <div className="text-[#C0392B] font-black text-base mt-0.5">−{periodDiscount.toLocaleString('ru-RU')} ₽</div>
                                    </div>
                                  )}
                                </div>

                                {/* Tournament history */}
                                <div className="flex flex-col gap-1.5">
                                  {entries.map(e => {
                                    const discount = (e.arrivalStatus === 'promo' || e.arrivalStatus === 'freePromo')
                                      ? e.paymentDue
                                      : e.arrivalStatus === 'admin'
                                        ? Math.max(0, (1 + e.rebuyCount + e.addonCount) * 1000 - e.paymentDue)
                                        : 0;
                                    return (
                                      <div key={e.tournamentId} className="rounded-lg border border-[#1D1D1D] bg-[#0A0A0A] px-3 py-2">
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="min-w-0">
                                            <div className="text-white text-xs font-bold truncate">{e.title}</div>
                                            <div className="text-[#555] text-[10px] mt-0.5">
                                              {new Date(e.finishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
                                            </div>
                                          </div>
                                          <div className="shrink-0 text-right">
                                            <div className="text-white font-black text-sm">{e.place !== null ? `#${e.place}` : '—'}</div>
                                          </div>
                                        </div>
                                        <div className="mt-1.5 flex items-center justify-between gap-2">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            {e.rebuyCount > 0 && (
                                              <span className="text-[#888] text-[10px]">Ребай <span className="text-white font-bold">{e.rebuyCount}</span></span>
                                            )}
                                            {e.addonCount > 0 && (
                                              <span className="text-[#888] text-[10px]">Аддон <span className="text-white font-bold">{e.addonCount}</span></span>
                                            )}
                                            {e.bounty > 0 && (
                                              <span className="text-[#888] text-[10px]">Bounty <span className="text-white font-bold">{e.bounty}</span></span>
                                            )}
                                            {discount > 0 && (
                                              <span className="text-[#C0392B] text-[10px] font-bold">−{discount.toLocaleString('ru-RU')} ₽ скидка</span>
                                            )}
                                          </div>
                                          <div className="shrink-0 text-right">
                                            {e.cashPaid > 0 && (
                                              <div className="text-[#888] text-[10px]">нал <span className="text-white font-bold">{e.cashPaid.toLocaleString('ru-RU')} ₽</span></div>
                                            )}
                                            {e.cardPaid > 0 && (
                                              <div className="text-[#888] text-[10px]">карта <span className="text-white font-bold">{e.cardPaid.toLocaleString('ru-RU')} ₽</span></div>
                                            )}
                                            {e.cashPaid === 0 && e.cardPaid === 0 && (
                                              <div className="text-[#555] text-[10px]">{(e.arrivalStatus === 'free' || e.arrivalStatus === 'freePromo' || e.arrivalStatus === 'admin') ? 'Бесплатно' : 'не оплачено'}</div>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {botOnlyFiltered.length > 0 && (
                        <div className="flex flex-col gap-1.5 mt-2">
                          <div className="text-[#444] text-[10px] uppercase tracking-wider px-1 mt-1">
                            Зарегистрированы в боте, ни разу не играли · {botOnlyFiltered.length}
                          </div>
                          {botOnlyFiltered.map(agg => (
                            <div key={agg.key} className="bg-[#111] border border-[#2D2D2D] rounded-xl px-4 py-2.5 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-white text-sm font-bold truncate">{agg.currentName}</div>
                                {agg.currentUsername && (
                                  <div className="text-[#555] text-xs mt-0.5">@{agg.currentUsername.replace(/^@/, '')}</div>
                                )}
                                {agg.botRegisteredAt && (
                                  <div className="text-[#444] text-[10px] mt-0.5">
                                    Зарег. {new Date(agg.botRegisteredAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
                                  </div>
                                )}
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-[#555] font-black text-sm">0</div>
                                <div className="text-[#333] text-[10px] uppercase">игр</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ── SALARY sub-tab ────────────────────────────────── */}
                {archiveSubTab === 'salary' && (() => {
                  const cutoff = archivePeriod === 'all' ? 0 : presenceNow - Number(archivePeriod) * 24 * 60 * 60 * 1000;
                  const filteredTournaments = archivePeriod === 'all' ? tournaments : tournaments.filter(t => new Date(t.finished_at).getTime() >= cutoff);
                  type SalaryEntry = {
                    tournamentId: number; date: string; title: string;
                    personnel: PersonnelRecord;
                  };
                  const rows: SalaryEntry[] = [];
                  for (const t of filteredTournaments) {
                    const details = archiveDetailsById[t.id] ?? t.archive_details ?? null;
                    for (const p of mergePersonnelRecords(details?.personnel ?? [])) {
                      rows.push({
                        tournamentId: t.id,
                        date: new Date(t.finished_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }),
                        title: t.title ?? 'Без названия',
                        personnel: p,
                      });
                    }
                  }
                  const { total: grandTotal } = personnelTotals(rows.map(r => r.personnel));
                  const loadedCount = filteredTournaments.filter(t => Object.prototype.hasOwnProperty.call(archiveDetailsById, t.id)).length;
                  const isLoading = playerHistoryLoading || loadedCount < filteredTournaments.length;

                  return (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-[#555] text-xs">
                          {isLoading
                            ? `Загрузка данных... (${loadedCount}/${filteredTournaments.length})`
                            : `${rows.length} выплат по ${filteredTournaments.length} играм`}
                        </div>
                        {rows.length > 0 && (
                          <button
                            type="button"
                            onClick={() => void handleExportFinancialXlsx(filteredTournaments)}
                            disabled={financialExportBusy}
                            className="admin-btn-secondary w-full px-4 py-3 text-xs disabled:opacity-40 sm:w-auto sm:py-2"
                          >
                            {financialExportBusy ? 'Экспорт...' : '📊 Скачать зарплатный отчёт'}
                          </button>
                        )}
                      </div>

                      {rows.length === 0 && !isLoading && (
                        <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-8 text-center">
                          <div className="text-[#444] text-4xl mb-3">💰</div>
                          <div className="text-[#555] text-sm">Нет данных о персонале</div>
                          <div className="text-[#333] text-xs mt-1">
                            Добавьте данные о персонале в архивных блоках турниров
                          </div>
                        </div>
                      )}

                      {rows.length > 0 && (
                        <>
                          <div className="rounded-xl border border-[#3D1A1A] bg-[#140909] p-3 text-center">
                            <div className="text-[#888] text-[10px] uppercase mb-1">Итого выплат</div>
                            <div className="text-[#C0392B] font-black text-sm">{grandTotal.toLocaleString('ru-RU')} ₽</div>
                          </div>

                          <div className="flex flex-col gap-2">
                            {rows.map((row, idx) => {
                              const p = row.personnel;
                              const total = p.cashAmount + p.cardAmount;
                              return (
                                <div key={`${row.tournamentId}-${p.id}-${idx}`} className="bg-[#111] border border-[#2D2D2D] rounded-xl px-4 py-3">
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                      <div className="text-white font-bold text-sm break-words">{p.name || '—'}</div>
                                      <div className="text-[#555] text-xs mt-0.5">{formatPersonnelRole(p)}</div>
                                    </div>
                                    <div className="text-left shrink-0 sm:text-right">
                                      <div className="text-white font-black text-sm">{total.toLocaleString('ru-RU')} ₽</div>
                                    </div>
                                  </div>
                                  <div className="mt-2 text-[#444] text-[10px]">
                                    {row.date} · {row.title}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}

              {archiveContactPlayer && (
                <div
                  className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 sm:items-center sm:p-6"
                  onClick={() => { setArchiveContactPlayer(null); setContactEditMode(false); }}
                >
                  <div
                    className="w-full max-w-sm rounded-3xl border border-[#2D2D2D] bg-[#111] shadow-2xl"
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="border-b border-[#2D2D2D] px-5 py-4 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-white font-black text-base break-words">{archiveContactPlayer.currentName}</div>
                        {(playerContacts[archiveContactPlayer.key]?.realName || contactEditMode) && !contactEditMode && (
                          <div className="mt-0.5 text-sm text-[#999]">{playerContacts[archiveContactPlayer.key]?.realName}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (contactEditMode) {
                              setContactEditMode(false);
                            } else {
                              const contact = playerContacts[archiveContactPlayer.key];
                              setContactDraft({
                                realName: contact?.realName ?? '',
                                phone: contact?.phone ?? '',
                                instagram: contact?.instagram ?? '',
                              });
                              setContactEditMode(true);
                            }
                          }}
                          className="text-[#888] hover:text-white text-xs border border-[#3D3D3D] hover:border-[#888] rounded-full px-3 py-1 transition-colors"
                        >
                          {contactEditMode ? 'Отмена' : 'Изменить'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setArchiveContactPlayer(null); setContactEditMode(false); }}
                          className="text-[#666] hover:text-white text-lg leading-none"
                        >✕</button>
                      </div>
                    </div>

                    {contactEditMode ? (
                      <div className="px-5 py-4 flex flex-col gap-3">
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.14em] text-[#666] mb-1">Настоящее имя</div>
                          <input
                            className="admin-input"
                            placeholder="Иван Иванов"
                            value={contactDraft.realName}
                            onChange={e => setContactDraft(d => ({ ...d, realName: e.target.value }))}
                          />
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.14em] text-[#666] mb-1">Телефон</div>
                          <input
                            className="admin-input"
                            placeholder="+7 900 000 00 00"
                            value={contactDraft.phone}
                            onChange={e => setContactDraft(d => ({ ...d, phone: e.target.value }))}
                          />
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.14em] text-[#666] mb-1">Instagram</div>
                          <input
                            className="admin-input"
                            placeholder="@username"
                            value={contactDraft.instagram}
                            onChange={e => setContactDraft(d => ({ ...d, instagram: e.target.value }))}
                          />
                        </div>
                        <button
                          type="button"
                          disabled={contactSaving}
                          onClick={async () => {
                            setContactSaving(true);
                            try {
                              await savePlayerContact(archiveContactPlayer.key, {
                                realName: contactDraft.realName.trim() || null,
                                phone: contactDraft.phone.trim() || null,
                                instagram: contactDraft.instagram.trim() || null,
                              });
                              setContactEditMode(false);
                            } finally {
                              setContactSaving(false);
                            }
                          }}
                          className="admin-btn-primary w-full py-2.5"
                        >
                          {contactSaving ? 'Сохранение...' : 'Сохранить'}
                        </button>
                      </div>
                    ) : (
                      <div className="px-5 py-4 flex flex-col gap-3">
                        {(() => {
                          const contact = playerContacts[archiveContactPlayer.key];
                          return (
                            <>
                              {contact?.realName && (
                                <div className="flex items-center gap-3 rounded-2xl border border-[#2D2D2D] bg-[#0A0A0A] px-4 py-3">
                                  <span className="text-lg">👤</span>
                                  <div>
                                    <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Имя</div>
                                    <div className="text-white font-bold text-sm mt-0.5">{contact.realName}</div>
                                  </div>
                                </div>
                              )}
                              {contact?.phone ? (
                                <a
                                  href={`tel:${contact.phone}`}
                                  className="flex items-center gap-3 rounded-2xl border border-[#2D2D2D] bg-[#0A0A0A] px-4 py-3 hover:border-[#444] transition-colors"
                                >
                                  <span className="text-lg">📞</span>
                                  <div>
                                    <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Телефон</div>
                                    <div className="text-white font-bold text-sm mt-0.5">{contact.phone}</div>
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
                              {contact?.instagram && (
                                <a
                                  href={`https://instagram.com/${contact.instagram.replace(/^@/, '')}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-3 rounded-2xl border border-[#2D2D2D] bg-[#0A0A0A] px-4 py-3 hover:border-[#444] transition-colors"
                                >
                                  <span className="text-lg">📸</span>
                                  <div>
                                    <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Instagram</div>
                                    <div className="text-white font-bold text-sm mt-0.5">{contact.instagram}</div>
                                  </div>
                                </a>
                              )}
                              {archiveContactPlayer.currentUsername ? (
                                <a
                                  href={`https://t.me/${archiveContactPlayer.currentUsername}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-3 rounded-2xl border border-[#2D2D2D] bg-[#0A0A0A] px-4 py-3 hover:border-[#444] transition-colors"
                                >
                                  <span className="text-lg">✈️</span>
                                  <div>
                                    <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Telegram</div>
                                    <div className="text-white font-bold text-sm mt-0.5">@{archiveContactPlayer.currentUsername}</div>
                                  </div>
                                </a>
                              ) : archiveContactPlayer.telegramId ? (
                                <div className="flex items-center gap-3 rounded-2xl border border-[#2D2D2D] bg-[#0A0A0A] px-4 py-3">
                                  <span className="text-lg">✈️</span>
                                  <div>
                                    <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Telegram ID</div>
                                    <div className="text-white font-bold text-sm mt-0.5">{archiveContactPlayer.telegramId}</div>
                                  </div>
                                </div>
                              ) : null}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              )}
              </>
            )}
          </div>
        )}

        {/* ─── STAFF TAB ───────────────────────────────────────────────── */}
        {activeTab === 'archive' && archiveAuthed && archiveSubTab === 'staff' && (
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-[#555]">
                  {staffArchiveLoading
                    ? `Загрузка выплат... (${staffArchiveLoadedCount}/${staffArchiveTournaments.length})`
                    : `${staffArchivePersonnel.length} выплат по ${staffArchiveTournaments.length} играм`}
                </div>
                {staffArchivePersonnel.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void handleExportFinancialXlsx(staffArchiveTournaments)}
                    disabled={financialExportBusy}
                    className="admin-btn-secondary w-full min-h-10 px-4 py-2 text-xs disabled:opacity-40 sm:w-auto"
                  >
                    {financialExportBusy ? 'Экспорт...' : '📊 Скачать зарплатный отчёт'}
                  </button>
                )}
              </div>

              <div className="rounded-2xl border border-[#3D1A1A] bg-[#140909] p-3 text-center">
                <div className="text-[10px] uppercase tracking-widest text-[#888]">Итого выплат</div>
                <div className="mt-1 text-sm font-black tabular-nums text-[#C0392B]">{staffArchiveTotals.total.toLocaleString('ru-RU')} ₽</div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs font-bold uppercase tracking-widest text-[#666]">Справочник сотрудников</div>
              <button
                type="button"
                onClick={() => setStaffDraft(createStaffMember())}
                className="admin-btn-primary min-h-10 w-full px-4 py-2 text-sm transition-transform active:scale-[0.96] sm:w-auto sm:shrink-0"
              >
                + Добавить
              </button>
            </div>

            {staffError && (
              <div className="rounded-xl border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                {staffError}
              </div>
            )}

            {staffDraft && (
              <div className="flex flex-col gap-3 rounded-2xl border border-[#2D2D2D] bg-[#111] p-4">
                <div className="text-xs font-bold uppercase tracking-widest text-[#888]">
                  {staffMembers.some(member => member.id === staffDraft.id) ? 'Редактирование' : 'Новый сотрудник'}
                </div>
                <input
                  value={staffDraft.name}
                  onChange={event => setStaffDraft(current => current && ({ ...current, name: event.target.value }))}
                  placeholder="Имя сотрудника"
                  className="admin-input"
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <select
                    value={staffDraft.role}
                    onChange={event => {
                      const role = event.target.value as StaffMember['role'];
                      setStaffDraft(current => current && ({
                        ...current,
                        role,
                        roleLabel: role === 'dealer' ? 'Дилер' : role === 'admin' ? 'Админ' : '',
                      }));
                    }}
                    className="admin-input"
                  >
                    <option value="dealer">Дилер</option>
                    <option value="admin">Админ</option>
                    <option value="custom">Другое</option>
                  </select>
                  <input
                    value={staffDraft.roleLabel}
                    onChange={event => setStaffDraft(current => current && ({ ...current, roleLabel: event.target.value }))}
                    placeholder="Название роли"
                    className="admin-input"
                  />
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={staffDraft.baseRate || ''}
                    onChange={event => setStaffDraft(current => current && ({
                      ...current,
                      baseRate: Math.max(0, Math.round(Number(event.target.value) || 0)),
                    }))}
                    placeholder="Базовая ставка, ₽"
                    className="admin-input tabular-nums"
                  />
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    type="tel"
                    value={staffDraft.phone}
                    onChange={event => setStaffDraft(current => current && ({ ...current, phone: event.target.value }))}
                    placeholder="Телефон"
                    className="admin-input"
                  />
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#666]">@</span>
                    <input
                      value={staffDraft.telegramUsername}
                      onChange={event => setStaffDraft(current => current && ({
                        ...current,
                        telegramUsername: event.target.value.replace(/^@/, ''),
                      }))}
                      placeholder="telegram"
                      className="admin-input pl-7"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setStaffDraft(null)} className="admin-btn-secondary min-h-10 px-4 py-2 text-sm">
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={() => void persistStaffDraft()}
                    disabled={staffBusy || !staffDraft.name.trim()}
                    className="admin-btn-primary min-h-10 px-4 py-2 text-sm disabled:opacity-40"
                  >
                    {staffBusy ? 'Сохранение...' : 'Сохранить'}
                  </button>
                </div>
              </div>
            )}

            {staffMembers.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#2D2D2D] bg-[#111] px-4 py-10 text-center text-sm text-[#666]">
                Справочник пока пуст.
              </div>
            )}

            <div className="flex flex-col gap-2">
              {staffMembers.map(member => {
                const isSelected = selectedStaffId === member.id;
                const isContactOpen = staffContactOpenId === member.id;
                const normalizedName = member.name.trim().toLocaleLowerCase('ru');
                const history = staffArchiveTournaments.flatMap(tournament => {
                  const details = archiveDetailsById[tournament.id] ?? tournament.archive_details ?? null;
                  return mergePersonnelRecords(details?.personnel ?? [])
                    .filter(record => record.staffMemberId === member.id || (
                      !record.staffMemberId && record.name.trim().toLocaleLowerCase('ru') === normalizedName
                    ))
                    .map(record => ({ tournament, record }));
                });
                const totals = personnelTotals(history.map(entry => entry.record));

                return (
                  <div key={member.id} className={`overflow-hidden rounded-2xl border bg-[#111] ${isSelected ? 'border-[#C0392B]' : 'border-[#2D2D2D]'} ${member.active ? '' : 'opacity-60'}`}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedStaffId(isSelected ? null : member.id);
                        if (isSelected) setStaffContactOpenId(null);
                      }}
                      onKeyDown={event => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        setSelectedStaffId(isSelected ? null : member.id);
                        if (isSelected) setStaffContactOpenId(null);
                      }}
                      className="flex min-h-16 cursor-pointer items-center gap-1 px-2 py-2"
                    >
                      <div className="flex min-w-0 flex-1 items-center">
                        <div className="min-w-0 px-2 py-1 text-left">
                          <div className="truncate text-sm font-bold text-white">{member.name}</div>
                          <div className="mt-0.5 text-xs text-[#666]">
                            {member.roleLabel} · <span className="tabular-nums">{member.baseRate.toLocaleString('ru-RU')} ₽</span>
                            {!member.active && ' · скрыт'}
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={`Контакты: ${member.name}`}
                          title="Контактная информация"
                          onClick={event => {
                            event.stopPropagation();
                            setSelectedStaffId(member.id);
                            setStaffContactOpenId(isContactOpen ? null : member.id);
                          }}
                          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-base transition-colors ${
                            isContactOpen ? 'bg-[#C0392B] text-white' : 'text-[#666] hover:bg-[#1A1A1A] hover:text-white'
                          }`}
                        >
                          ⓘ
                        </button>
                      </div>
                      <div className="shrink-0 px-2 py-1 text-right">
                        <div className="text-sm font-black tabular-nums text-white">{totals.total.toLocaleString('ru-RU')} ₽</div>
                        <div className="text-[10px] text-[#555]">{history.length} игр · {isSelected ? '▲' : '▼'}</div>
                      </div>
                    </div>

                    {isSelected && (
                      <div className="border-t border-[#2D2D2D] px-4 py-4">
                        {isContactOpen && (
                        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div className="rounded-xl bg-[#0A0A0A] p-3">
                            <div className="text-[10px] uppercase tracking-widest text-[#555]">Телефон</div>
                            {member.phone
                              ? <a href={`tel:${member.phone}`} className="mt-1 block text-sm text-white hover:text-[#C0392B]">{member.phone}</a>
                              : <div className="mt-1 text-sm text-[#444]">Не указан</div>}
                          </div>
                          <div className="rounded-xl bg-[#0A0A0A] p-3">
                            <div className="text-[10px] uppercase tracking-widest text-[#555]">Telegram</div>
                            {member.telegramUsername
                              ? <a href={`https://t.me/${member.telegramUsername}`} target="_blank" rel="noreferrer" className="mt-1 block text-sm text-white hover:text-[#C0392B]">@{member.telegramUsername}</a>
                              : <div className="mt-1 text-sm text-[#444]">Не указан</div>}
                          </div>
                        </div>
                        )}

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" onClick={() => setStaffDraft({ ...member })} className="admin-btn-secondary min-h-10 px-4 py-2 text-xs">
                            Изменить
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleStaffMemberVisibility(member)}
                            disabled={staffBusy}
                            className="min-h-10 px-3 text-xs text-[#888] hover:text-[#C0392B] disabled:opacity-40"
                          >
                            {member.active ? 'Скрыть' : 'Показать'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setStaffDeleteTarget(member);
                              setStaffDeletePassword('');
                              setStaffDeleteError(false);
                            }}
                            disabled={staffBusy}
                            className="ml-auto min-h-10 px-3 text-xs text-red-400 hover:text-red-300 disabled:opacity-40"
                          >
                            Удалить навсегда
                          </button>
                        </div>

                        <div className="mt-4 text-[10px] uppercase tracking-widest text-[#666]">Архив игр и оплат</div>
                        {playerHistoryLoading ? (
                          <div className="mt-2 text-xs text-[#555]">Загрузка...</div>
                        ) : history.length === 0 ? (
                          <div className="mt-2 rounded-xl bg-[#0A0A0A] px-3 py-4 text-xs text-[#555]">Выплат пока нет.</div>
                        ) : (
                          <div className="mt-2 flex flex-col gap-2">
                            {history.map(({ tournament, record }) => (
                              <div key={`${tournament.id}-${record.id}`} className="flex flex-col gap-2 rounded-xl bg-[#0A0A0A] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <div className="text-sm font-bold text-white">{tournament.title || 'Без названия'}</div>
                                  <div className="mt-0.5 text-xs text-[#555]">{new Date(tournament.finished_at).toLocaleDateString('ru-RU')}</div>
                                </div>
                                <div className="text-left sm:text-right">
                                  <div className="text-sm font-black tabular-nums text-white">{(record.cashAmount + record.cardAmount).toLocaleString('ru-RU')} ₽</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── SETTINGS TAB ────────────────────────────────────────────── */}
        {activeTab === 'settings' && (
          <div className="flex flex-col gap-4">
            {/* Staff directory is managed in Archive → Сотрудники. */}
            <div className="hidden">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[#888] text-xs uppercase tracking-widest">Справочник сотрудников</div>
                  <div className="mt-1 text-xs text-[#555]">Ставка подставляется при добавлении сотрудника в турнир.</div>
                </div>
                <button
                  type="button"
                  onClick={() => setStaffDraft(createStaffMember())}
                  className="admin-btn-primary min-h-10 shrink-0 px-4 py-2 text-sm transition-transform active:scale-[0.96]"
                >
                  + Добавить
                </button>
              </div>

              {staffError && (
                <div className="mt-3 rounded-xl border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                  {staffError}
                </div>
              )}

              {staffDraft && (
                <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-[#0A0A0A] p-4">
                  <input
                    value={staffDraft.name}
                    onChange={event => setStaffDraft(current => current && ({ ...current, name: event.target.value }))}
                    placeholder="Имя сотрудника"
                    className="admin-input"
                  />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <select
                      value={staffDraft.role}
                      onChange={event => {
                        const role = event.target.value as StaffMember['role'];
                        setStaffDraft(current => current && ({
                          ...current,
                          role,
                          roleLabel: role === 'dealer' ? 'Дилер' : role === 'admin' ? 'Админ' : '',
                        }));
                      }}
                      className="admin-input"
                    >
                      <option value="dealer">Дилер</option>
                      <option value="admin">Админ</option>
                      <option value="custom">Другое</option>
                    </select>
                    <input
                      value={staffDraft.roleLabel}
                      onChange={event => setStaffDraft(current => current && ({ ...current, roleLabel: event.target.value }))}
                      placeholder="Название роли"
                      className="admin-input"
                    />
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={staffDraft.baseRate || ''}
                      onChange={event => setStaffDraft(current => current && ({
                        ...current,
                        baseRate: Math.max(0, Math.round(Number(event.target.value) || 0)),
                      }))}
                      placeholder="Базовая ставка, ₽"
                      className="admin-input tabular-nums"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setStaffDraft(null)} className="admin-btn-secondary min-h-10 px-4 py-2 text-sm">
                      Отмена
                    </button>
                    <button
                      type="button"
                      onClick={() => void persistStaffDraft()}
                      disabled={staffBusy || !staffDraft.name.trim()}
                      className="admin-btn-primary min-h-10 px-4 py-2 text-sm disabled:opacity-40"
                    >
                      {staffBusy ? 'Сохранение...' : 'Сохранить'}
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-col gap-2">
                {staffMembers.length === 0 && (
                  <div className="rounded-xl border border-dashed border-[#2D2D2D] bg-[#0A0A0A] px-4 py-5 text-sm text-[#666]">
                    Справочник пока пуст.
                  </div>
                )}
                {staffMembers.map(member => (
                  <div key={member.id} className={`flex items-center justify-between gap-3 rounded-xl bg-[#0A0A0A] px-4 py-3 ${member.active ? '' : 'opacity-45'}`}>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-white">{member.name}</div>
                      <div className="mt-0.5 text-xs text-[#666]">
                        {member.roleLabel} · <span className="tabular-nums">{member.baseRate.toLocaleString('ru-RU')} ₽</span>
                        {!member.active && ' · скрыт'}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => setStaffDraft({ ...member })}
                          className="min-h-10 px-3 text-xs text-[#888] hover:text-white"
                        >
                          Изменить
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleStaffMemberVisibility(member)}
                          disabled={staffBusy}
                          className="min-h-10 px-3 text-xs text-[#888] hover:text-[#C0392B] disabled:opacity-40"
                        >
                          {member.active ? 'Скрыть' : 'Показать'}
                        </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Next game info */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <div className="text-[#888] text-xs uppercase tracking-widest mb-3">Следующая игра</div>
              <input
                className="admin-input"
                placeholder="напр: Ребайный турнир · 24.04.26 · 20:00"
                value={gameState.nextGameInfo}
                onChange={e => updateGameState({ nextGameInfo: e.target.value })}
              />
              <div className="text-[#555] text-xs mt-1">Резервный текст для блока следующего турнира, если бот временно недоступен</div>
            </div>

            {/* Background */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="text-[#888] text-xs uppercase tracking-widest">Фон экрана</div>
                  <div className="text-[#555] text-xs mt-1">
                    {sharedBackgroundLibraryEnabled
                      ? 'Готовая библиотека доступна сразу. Загруженные изображения сохраняются в общей библиотеке и видны с любого устройства.'
                      : 'Готовая библиотека доступна сразу. Без Supabase свои изображения сохраняются только в браузере админа.'}
                  </div>
                </div>
                <label className={`admin-btn-primary px-4 py-2 text-sm ${backgroundUploadBusy ? 'opacity-60 pointer-events-none' : ''}`}>
                  {backgroundUploadBusy ? 'Загрузка...' : '+ Загрузить фон'}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleBackgroundUpload}
                  />
                </label>
              </div>

              {backgroundUploadError && (
                <div className="mb-3 rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                  {backgroundUploadError}
                </div>
              )}

              {backgroundUploadNote && (
                <div className="mb-3 rounded-xl border border-[#3A3A3A] bg-[#0A0A0A] px-3 py-2 text-sm text-[#AAA]">
                  {backgroundUploadNote}
                </div>
              )}

              <div className="mb-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-wide text-[#777]">
                <span className="rounded-full border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-1">
                  Готовые: {PRESET_BACKGROUNDS.length}
                </span>
                <span className="rounded-full border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-1">
                  Свои: {backgroundLibrary.length}
                </span>
                <span className="rounded-full border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-1">
                  {sharedBackgroundLibraryEnabled ? 'Общая библиотека' : 'Локально на этом устройстве'}
                </span>
              </div>

              <div className="mb-3 text-[#666] text-xs uppercase tracking-widest">Библиотека фонов</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
                <BackgroundTile
                  title="По умолчанию"
                  subtitle="Темный фон без картинки"
                  selected={!gameState.backgroundUrl}
                  onClick={() => updateGameState({ backgroundUrl: null })}
                />

                {allBackgrounds.map(background => (
                  <BackgroundTile
                    key={background.id}
                    title={background.name}
                    subtitle={
                      background.id.startsWith('preset_')
                        ? 'Готовый фон'
                        : `${background.width}×${background.height}`
                    }
                    previewUrl={background.url}
                    selected={gameState.backgroundUrl === background.url}
                    onClick={() => updateGameState({ backgroundUrl: background.url })}
                    onDelete={
                      background.id.startsWith('preset_')
                        ? undefined
                        : () => removeBackground(background.id)
                    }
                  />
                ))}
              </div>

              {backgroundLibrary.length === 0 && (
                <div className="rounded-xl border border-dashed border-[#2D2D2D] bg-[#0A0A0A] px-4 py-5 text-sm text-[#666]">
                  {sharedBackgroundLibraryEnabled
                    ? 'Пока нет своих загруженных фонов в общей библиотеке. Готовые варианты уже доступны в сетке выше, а свои можно добавить кнопкой справа.'
                    : 'Пока нет своих загруженных фонов. Готовые варианты уже доступны в сетке выше, а свои можно добавить кнопкой справа.'}
                </div>
              )}

              <div className="mt-4 border-t border-[#1F1F1F] pt-4">
                <div className="text-[#666] text-xs uppercase tracking-widest mb-2">Ручной URL</div>
                <input
                  className="admin-input"
                  placeholder="https://.../background.jpg"
                  value={gameState.backgroundUrl || ''}
                  onChange={e => updateGameState({ backgroundUrl: e.target.value || null })}
                />
                <div className="text-[#555] text-xs mt-1">
                  Если нужен внешний файл, ссылку можно вставить вручную. Загруженные выше фоны выбирать удобнее через сетку.
                </div>
              </div>
            </div>
          </div>
        )}

      </div>

      {staffDeleteTarget && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 p-3 sm:items-center sm:p-6"
          onClick={() => {
            if (staffBusy) return;
            setStaffDeleteTarget(null);
            setStaffDeletePassword('');
            setStaffDeleteError(false);
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-red-900/70 bg-[#111] shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="border-b border-[#2D2D2D] px-5 py-4">
              <div className="text-base font-black uppercase tracking-[0.12em] text-white">Удалить сотрудника</div>
              <div className="mt-2 text-sm text-[#888]">
                Сотрудник «{staffDeleteTarget.name}» будет безвозвратно удалён из справочника.
                История выплат в завершённых турнирах останется в архиве.
              </div>
            </div>
            <div className="flex flex-col gap-3 px-5 py-4">
              <label className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Пароль архива</label>
              <input
                type="password"
                autoFocus
                value={staffDeletePassword}
                onChange={event => {
                  setStaffDeletePassword(event.target.value);
                  setStaffDeleteError(false);
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') void permanentlyDeleteStaffMember();
                }}
                className="admin-input"
                placeholder="Введите пароль"
              />
              {staffDeleteError && (
                <div className="text-sm text-red-400">Неверный пароль архива.</div>
              )}
              <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setStaffDeleteTarget(null);
                    setStaffDeletePassword('');
                    setStaffDeleteError(false);
                  }}
                  disabled={staffBusy}
                  className="admin-btn-secondary min-h-10 px-4 py-2 text-sm disabled:opacity-40"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => void permanentlyDeleteStaffMember()}
                  disabled={staffBusy || !staffDeletePassword}
                  className="admin-btn-danger min-h-10 px-4 py-2 text-sm disabled:opacity-40"
                >
                  {staffBusy ? 'Удаление...' : 'Удалить навсегда'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {priceConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 sm:items-center sm:p-6"
          onClick={() => setPriceConfirmOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-[#2D2D2D] bg-[#111] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="border-b border-[#2D2D2D] px-5 py-4 flex items-center justify-between gap-3">
              <div className="text-white font-black text-base uppercase tracking-[0.12em]">Проверьте стоимости</div>
              <button type="button" onClick={() => setPriceConfirmOpen(false)} className="text-[#666] hover:text-white text-lg leading-none">✕</button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-4">
              <div className="text-[#888] text-sm">
                Эти значения будут использоваться для финансового расчёта игры.
              </div>
              {(
                [
                  { label: 'Стоимость входа', key: 'buyIn' },
                  { label: 'Стоимость rebuy', key: 'rebuy' },
                  { label: 'Стоимость addon', key: 'addon' },
                ] as { label: string; key: keyof typeof priceDraft }[]
              ).map(({ label, key }) => (
                <div key={key}>
                  <label className="block text-[10px] uppercase tracking-[0.14em] text-[#666] mb-1.5">{label}, ₽</label>
                  <input
                    type="number"
                    min={0}
                    className="admin-input"
                    value={priceDraft[key]}
                    onChange={e => setPriceDraft(d => ({ ...d, [key]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setPriceConfirmOpen(false)}
                  className="admin-btn-secondary flex-1 py-3"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={
                    priceDraft.buyIn === '' || priceDraft.rebuy === '' || priceDraft.addon === '' ||
                    parseInt(priceDraft.buyIn, 10) < 0 || parseInt(priceDraft.rebuy, 10) < 0 || parseInt(priceDraft.addon, 10) < 0
                  }
                  onClick={() => void handleConfirmAndStart()}
                  className="admin-btn-primary flex-1 py-3 disabled:opacity-40"
                >
                  Подтвердить и начать
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {finishReviewOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 sm:items-center sm:p-6">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-[#2D2D2D] bg-[#111] shadow-2xl">
            <div className="border-b border-[#2D2D2D] px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-white font-black text-lg uppercase tracking-[0.14em]">
                  {gameState.status === 'ended'
                    ? 'Итоги турнира'
                    : finishStep === 'personnel'
                      ? 'Персонал'
                      : 'Завершить турнир'}
                </div>
                {gameState.status !== 'ended' && (
                  <div className="text-[#555] text-xs tracking-widest shrink-0">
                    {finishStep === 'review' ? '1 / 2' : '2 / 2'}
                  </div>
                )}
              </div>
              <div className="text-[#888] text-sm mt-1">
                {gameState.status === 'ended'
                  ? 'Проверьте результаты прямо в этом окне, внесите правки если нужно и отправьте итог в бот отсюда же.'
                  : finishStep === 'personnel'
                    ? 'Проверьте выплаты, внесённые во время турнира. Если список пуст, добавьте сотрудника из справочника или внесите выплату вручную.'
                    : requiresBotResults
                      ? 'Проверьте результаты прямо в этом окне. После кнопки `Завершить и отправить в бот` турнир завершится только после успешной отправки.'
                      : 'Проверьте результаты прямо в этом окне и завершите турнир отсюда же.'}
              </div>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              {(gameState.status === 'ended' || finishStep === 'review') && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-[#0A0A0A] px-3 py-3 text-center">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">В игре</div>
                      <div className="mt-1 text-2xl font-black text-white">{tournamentPlayersSummary.active}</div>
                    </div>
                    <div className="rounded-xl bg-[#0A0A0A] px-3 py-3 text-center">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Выбыли</div>
                      <div className="mt-1 text-2xl font-black text-white">{tournamentPlayersSummary.bustouts}</div>
                    </div>
                    <div className="rounded-xl bg-[#0A0A0A] px-3 py-3 text-center">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-[#666]">Входов</div>
                      <div className="mt-1 text-2xl font-black text-white">{tournamentPlayersSummary.entrants}</div>
                    </div>
                  </div>

                  {missingBotRosterForFinish && (
                    <div className="mt-4 rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
                      Перед завершением игры из бота нужен список игроков. Нажмите `Синхронизировать` или добавьте игроков вручную.
                    </div>
                  )}

                  {playersMissingFinalPlace > 0 && (
                    <div className="mt-4 rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
                      Без итогового места: {playersMissingFinalPlace}. Перед отправкой переведите оставшихся игроков в `Выбыл` и при необходимости поправьте место вручную.
                    </div>
                  )}

                  {duplicateResultPlaces.length > 0 && (
                    <div className="mt-4 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                      Дублируются места: {duplicateResultPlacesLabel}. Перед отправкой у каждого участника должно быть уникальное итоговое место.
                    </div>
                  )}

                  {visibleResultsNotice && (
                    <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
                      visibleResultsNotice.tone === 'success'
                        ? 'border-green-900/60 bg-green-950/30 text-green-200'
                        : visibleResultsNotice.tone === 'warning'
                          ? 'border-amber-900/60 bg-amber-950/30 text-amber-200'
                          : 'border-red-900/60 bg-red-950/40 text-red-300'
                    }`}>
                      {visibleResultsNotice.text}
                    </div>
                  )}

                  {resultsAlreadyCurrent && (
                    <div className="mt-4 rounded-xl border border-green-900/60 bg-green-950/30 px-4 py-3 text-sm text-green-200">
                      Текущая версия итогов уже отправлена в бот{resultsSentLabel ? ` · ${resultsSentLabel}` : ''}.
                    </div>
                  )}

                  {resultsNeedResubmit && (
                    <div className="mt-4 rounded-xl border border-blue-900/60 bg-blue-950/30 px-4 py-3 text-sm text-blue-200">
                      После прошлой отправки данные менялись. Можно отправить обновлённую версию результатов.
                    </div>
                  )}

                  <div className="mt-4">
                    <TournamentPlayersTab
                      groupedPlayers={groupedPlayers}
                      playerSyncState={playerSyncState}
                      playerBackups={playerBackups}
                      botSyncState={botSyncState}
                      tournamentBotId={gameState.tournamentBotId}
                      tournamentDate={selectedBotGame?.date ?? null}
                      earlyBirdBonusEnabled={selectedTournamentIsClassic}
                      isTournamentEnded={false}
                      preferMobileCards={tabletAdminLayout}
                      reviewPlayers={[]}
                      tableCount={gameState.tableCount}
                      onOpenControlTab={() => {}}
                      onRefreshFromBot={refreshFromBot}
                      onAddManualPlayer={addManualPlayer}
                      onRemovePlayer={removePlayer}
                      onUpdatePlayerField={updatePlayerField}
                      onSetPlayerArrival={setPlayerArrival}
                      onMarkPlayerOut={markPlayerOut}
                      onRestorePlayer={restorePlayer}
                      onRestorePlayersFromBackup={restorePlayersFromBackup}
                      onAssignSeat={async (playerId, tableNumber, seatNumber) => {
                        await assignPlayerSeat(playerId, tableNumber, seatNumber);
                      }}
                      knownPlayers={knownPlayersWithBot}
                    />
                  </div>
                </>
              )}

              {gameState.status !== 'ended' && finishStep === 'personnel' && (
                <>
                  {missingBotRosterForFinish && (
                    <div className="mb-4 rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
                      Перед завершением игры из бота нужен список игроков. Нажмите `Синхронизировать` или добавьте игроков вручную.
                    </div>
                  )}
                  {playersMissingFinalPlace > 0 && (
                    <div className="mb-4 rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
                      Без итогового места: {playersMissingFinalPlace}. Перед отправкой переведите оставшихся игроков в `Выбыл`.
                    </div>
                  )}
                  {visibleResultsNotice && (
                    <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
                      visibleResultsNotice.tone === 'success'
                        ? 'border-green-900/60 bg-green-950/30 text-green-200'
                        : visibleResultsNotice.tone === 'warning'
                          ? 'border-amber-900/60 bg-amber-950/30 text-amber-200'
                          : 'border-red-900/60 bg-red-950/40 text-red-300'
                    }`}>
                      {visibleResultsNotice.text}
                    </div>
                  )}
                  <PersonnelForm
                    value={finishPersonnel}
                    onChange={handlePersonnelChange}
                    staffMembers={staffMembers}
                  />
                </>
              )}
            </div>

            <div className="border-t border-[#2D2D2D] px-5 py-4">
              {gameState.status === 'ended' ? (
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setFinishReviewOpen(false)}
                    className="admin-btn-secondary px-4 py-3 text-sm"
                  >
                    Закрыть
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitTournamentResults()}
                    disabled={!canSubmitTournamentResults || resultsBusy}
                    className="admin-btn-primary px-4 py-3 text-sm disabled:opacity-40"
                  >
                    {sendResultsButtonLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmStartNewTournament()}
                    disabled={newTournamentBusy}
                    className="admin-btn-primary px-4 py-3 text-sm disabled:opacity-40"
                  >
                    {newTournamentBusy ? 'Сохранение...' : '↺ Новый турнир'}
                  </button>
                </div>
              ) : finishStep === 'review' ? (
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setFinishReviewOpen(false)}
                    className="admin-btn-secondary px-4 py-3 text-sm"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={() => setFinishStep('personnel')}
                    disabled={!canFinishTournamentFromReview}
                    className="admin-btn-danger px-4 py-3 text-sm disabled:opacity-40"
                  >
                    Далее: Персонал →
                  </button>
                </div>
              ) : (
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setFinishStep('review')}
                    className="admin-btn-secondary px-4 py-3 text-sm"
                  >
                    ← Назад
                  </button>
                  <button
                    type="button"
                    onClick={() => { handlePersonnelChange([]); void finishAndSubmitTournament(); }}
                    disabled={!canFinishTournamentFromReview}
                    className="admin-btn-secondary px-4 py-3 text-sm disabled:opacity-40"
                  >
                    Внести позже
                  </button>
                  <button
                    type="button"
                    onClick={() => void finishAndSubmitTournament()}
                    disabled={!canFinishTournamentFromReview}
                    className="admin-btn-danger px-4 py-3 text-sm disabled:opacity-40"
                  >
                    {finishReviewPrimaryLabel}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>

    {personnelConfirm && (() => {
      const { oldPersonnel, newPersonnel, tournamentId, finishedAt } = personnelConfirm;
      const oldById = new Map(oldPersonnel.map(p => [p.id, p]));
      const newById = new Map(newPersonnel.map(p => [p.id, p]));
      const diffRows: Array<{ type: 'added' | 'removed' | 'changed'; old?: PersonnelRecord; new?: PersonnelRecord }> = [];
      for (const p of oldPersonnel) {
        const updated = newById.get(p.id);
        if (!updated) diffRows.push({ type: 'removed', old: p });
        else if (updated.name !== p.name || updated.cashAmount !== p.cashAmount || updated.cardAmount !== p.cardAmount || updated.role !== p.role || updated.roleLabel !== p.roleLabel)
          diffRows.push({ type: 'changed', old: p, new: updated });
      }
      for (const p of newPersonnel) {
        if (!oldById.has(p.id)) diffRows.push({ type: 'added', new: p });
      }
      const noChanges = diffRows.length === 0;

      return (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/80 p-3 sm:items-center sm:p-6">
          <div className="w-full max-w-md rounded-3xl border border-[#2D2D2D] bg-[#111] shadow-2xl">
            <div className="border-b border-[#2D2D2D] px-5 py-4 flex items-center justify-between gap-3">
              <div className="text-white font-black text-base uppercase tracking-[0.12em]">Подтвердить изменения</div>
              <button type="button" onClick={() => setPersonnelConfirm(null)} className="text-[#666] hover:text-white text-lg leading-none">✕</button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
              {noChanges ? (
                <div className="text-[#888] text-sm">Изменений нет. Данные уже актуальны.</div>
              ) : (
                <>
                  <div className="text-[#888] text-sm mb-1">Следующие изменения будут сохранены:</div>
                  {diffRows.map((row, idx) => (
                    <div key={idx} className={"rounded-xl p-3 text-sm " + (row.type === 'added' ? 'bg-green-950/40 border border-green-900/40' : row.type === 'removed' ? 'bg-red-950/40 border border-red-900/40' : 'bg-[#0A0A0A] border border-[#2D2D2D]')}>
                      {row.type === 'added' && (
                        <>
                          <div className="text-green-400 text-[10px] uppercase mb-1">Добавлен</div>
                          <div className="text-white font-bold">{row.new!.name || '—'} <span className="text-[#666] font-normal">({formatPersonnelRole(row.new!)})</span></div>
                          <div className="text-[#888] text-xs mt-0.5">{(row.new!.cashAmount + row.new!.cardAmount).toLocaleString('ru-RU')} ₽</div>
                        </>
                      )}
                      {row.type === 'removed' && (
                        <>
                          <div className="text-[#C0392B] text-[10px] uppercase mb-1">Удалён</div>
                          <div className="text-[#888] line-through">{row.old!.name || '—'} ({formatPersonnelRole(row.old!)})</div>
                        </>
                      )}
                      {row.type === 'changed' && (
                        <>
                          <div className="text-[#888] text-[10px] uppercase mb-1">Изменён</div>
                          <div className="text-white font-bold">{row.new!.name || '—'} <span className="text-[#666] font-normal">({formatPersonnelRole(row.new!)})</span></div>
                          <div className="flex gap-2 mt-1 text-xs">
                            <div className="text-[#555]">было: {(row.old!.cashAmount + row.old!.cardAmount).toLocaleString('ru-RU')} ₽</div>
                            <div className="text-[#888]">→</div>
                            <div className="text-white">{(row.new!.cashAmount + row.new!.cardAmount).toLocaleString('ru-RU')} ₽</div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="border-t border-[#2D2D2D] px-5 py-4 flex gap-2 justify-end">
              <button type="button" onClick={() => setPersonnelConfirm(null)} className="admin-btn-secondary px-4 py-2 text-sm">
                Отмена
              </button>
              {!noChanges && (
                <button
                  type="button"
                  disabled={personnelSavingId === tournamentId}
                  onClick={async () => {
                    setPersonnelSavingId(tournamentId);
                    try {
                      const currentDetails = archiveDetailsById[tournamentId] ?? tournaments.find(t => t.id === tournamentId)?.archive_details ?? null;
                      if (currentDetails) {
                        const updated = { ...currentDetails, personnel: mergePersonnelRecords(newPersonnel) };
                        await updateTournamentArchiveDetails(tournamentId, finishedAt, updated);
                        setArchiveDetailsById(prev => ({ ...prev, [tournamentId]: updated }));
                      }
                      setPersonnelConfirm(null);
                      setEditingPersonnelId(null);
                    } finally {
                      setPersonnelSavingId(null);
                    }
                  }}
                  className="admin-btn-primary px-4 py-2 text-sm disabled:opacity-40"
                >
                  {personnelSavingId === tournamentId ? 'Сохранение...' : 'Подтвердить'}
                </button>
              )}
            </div>
          </div>
        </div>
      );
    })()}

    {showScrollTop && (
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className="fixed bottom-5 right-5 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-[#3D3D3D] bg-[#1A1A1A] text-[#AAA] shadow-lg transition-colors hover:border-[#666] hover:text-white"
        aria-label="Наверх"
      >
        ↑
      </button>
    )}

    {pendingGameSwitch && (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 sm:items-center sm:p-6">
        <div className="w-full max-w-md rounded-3xl border border-[#2D2D2D] bg-[#111] shadow-2xl">
          <div className="border-b border-[#2D2D2D] px-5 py-4">
            <div className="text-white font-black text-lg">Сменить игру?</div>
            <div className="mt-1 text-sm text-[#777]">
              Сейчас идёт <span className="text-white font-bold">«{gameState.tournamentTitle || 'текущий турнир'}»</span>.
              Вы выбрали <span className="text-white font-bold">«{pendingGameSwitch.title}»</span>.
            </div>
          </div>
          <div className="px-5 py-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={async () => {
                const { title, botId, buyIn } = pendingGameSwitch;
                setPendingGameSwitch(null);
                await prepareTournamentPlayersContext(botId, title);
                await updateGameState({ tournamentTitle: title, tournamentBotId: botId, tournamentBuyIn: buyIn }, true);
              }}
              className="w-full py-3 rounded-2xl border border-blue-700/60 bg-blue-950/30 text-blue-200 text-sm font-bold hover:bg-blue-950/50 transition-colors text-left px-4"
            >
              <div>Сменить игру, сохранить таймер</div>
              <div className="text-blue-400/60 text-xs font-normal mt-0.5">Таймер продолжит работу, игроки останутся</div>
            </button>
            <button
              type="button"
              onClick={async () => {
                const { title, botId, buyIn } = pendingGameSwitch;
                setPendingGameSwitch(null);
                await confirmStartNewTournament({ title, botId, buyIn });
              }}
              className="w-full py-3 rounded-2xl border border-[#C0392B]/60 bg-[#C0392B]/10 text-[#FF6B6B] text-sm font-bold hover:bg-[#C0392B]/20 transition-colors text-left px-4"
            >
              <div>Сбросить и сменить</div>
              <div className="text-[#FF6B6B]/60 text-xs font-normal mt-0.5">Текущий турнир завершится, данные сохранятся в архив</div>
            </button>
            <button
              type="button"
              onClick={() => setPendingGameSwitch(null)}
              className="w-full py-3 rounded-2xl border border-[#2D2D2D] text-[#666] text-sm font-bold hover:border-[#555] hover:text-[#888] transition-colors"
            >
              Отмена
            </button>
          </div>
        </div>
      </div>
    )}
    </ErrorBoundary>
  );
}

function BackgroundTile({
  title,
  subtitle,
  previewUrl,
  selected,
  onClick,
  onDelete,
}: {
  title: string;
  subtitle: string;
  previewUrl?: string;
  selected: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border text-left transition-all ${
        selected
          ? 'border-[#C0392B] ring-1 ring-[#C0392B] bg-[#140909]'
          : 'border-[#2D2D2D] bg-[#0A0A0A] hover:border-[#4A4A4A]'
      }`}
    >
      <button type="button" onClick={onClick} className="block w-full text-left">
        {previewUrl ? (
          <div className="relative h-40 w-full bg-black">
            <img src={previewUrl} alt={title} className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
          </div>
        ) : (
          <div className="h-40 w-full bg-[radial-gradient(circle_at_top,#301010_0%,#0A0A0A_72%)]" />
        )}

        <div className="absolute left-0 right-0 top-0 flex items-start justify-between p-3">
          {selected && (
            <span className="rounded-full bg-[#C0392B] px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-white">
              Активен
            </span>
          )}
        </div>

        <div className="relative z-10 px-3 pb-3 pt-2">
          <div className="truncate text-sm font-bold text-white">{title}</div>
          <div className="mt-1 text-xs text-[#777]">{subtitle}</div>
        </div>
      </button>

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="absolute right-2 top-2 z-20 rounded-full bg-black/75 px-2 py-1 text-xs font-bold text-red-300 transition-colors hover:bg-red-900/70"
        >
          Удалить
        </button>
      )}
    </div>
  );
}

// ─── Status badge ────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; color: string }> = {
    idle:    { label: 'Не запущен', color: 'bg-[#2D2D2D] text-[#666]' },
    running: { label: '▶ Идёт игра', color: 'bg-green-900/60 text-green-400' },
    paused:  { label: '⏸ Пауза',    color: 'bg-yellow-900/60 text-yellow-400' },
    break:   { label: '☕ Перерыв', color: 'bg-blue-900/40 text-blue-300' },
    ended:   { label: 'Завершён',   color: 'bg-[#2D2D2D] text-[#666]' },
  };
  const c = cfg[status] ?? cfg.idle;
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${c.color}`}>
      {c.label}
    </span>
  );
}

function FloorNotificationPopup({
  notification,
  onConfirm,
  onReject,
  onOpenNotifications,
  onDismiss,
}: {
  notification: FloorNotification;
  onConfirm: (id: string, bounty: number) => Promise<boolean>;
  onReject: (id: string) => Promise<boolean>;
  onOpenNotifications: () => void;
  onDismiss: () => void;
}) {
  const [bountyDraft, setBountyDraft] = useState(String(notification.bounty || 0));
  const [busy, setBusy] = useState(false);
  const createdAt = new Date(notification.createdAt);
  const timeLabel = createdAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const dateLabel = createdAt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const isBustout = notification.type === 'bustout';

  const handleConfirm = async () => {
    setBusy(true);
    try {
      const bounty = isBustout ? Math.max(0, parseInt(bountyDraft, 10) || 0) : 0;
      await onConfirm(notification.id, bounty);
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    setBusy(true);
    try {
      await onReject(notification.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-6">
      <div className="w-full max-w-md rounded-2xl border border-[#C0392B] bg-[#111] shadow-2xl shadow-black/60">
        <div className="border-b border-[#2D2D2D] px-5 py-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[#C0392B]">Новое уведомление</div>
          <div className="mt-2 text-2xl font-black text-white">
            {isBustout ? 'Игрок выбыл' : 'Стол зовёт флора'}
          </div>
          <div className="mt-1 text-sm text-[#777]">
            {dateLabel}, {timeLabel}
          </div>
        </div>

        <div className="px-5 py-5">
          <div className="rounded-xl border border-[#2D2D2D] bg-[#0A0A0A] px-4 py-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-[#666]">Стол</div>
            <div className="mt-1 text-white text-3xl font-black">{notification.tableNumber}</div>
          </div>

          <div className="mt-4 text-white text-base font-bold">
            {isBustout
              ? `${notification.playerName ?? 'Игрок'} ожидает подтверждения выбывания`
              : `Стол ${notification.tableNumber} вызвал флора`}
          </div>
          {isBustout && notification.projectedPlace !== null && (
            <div className="mt-1 text-sm text-[#777]">Предварительное место: #{notification.projectedPlace}</div>
          )}

          {isBustout && (
            <label className="mt-4 block">
              <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-[#666]">Bounty</div>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={bountyDraft}
                onChange={event => setBountyDraft(event.target.value)}
                className="admin-input w-full"
                autoFocus
              />
            </label>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-[#2D2D2D] px-5 py-4 sm:flex-row">
          <button type="button" onClick={onDismiss} disabled={busy} className="admin-btn-secondary flex-1 py-3 text-sm">
            Скрыть
          </button>
          <button type="button" onClick={onOpenNotifications} disabled={busy} className="admin-btn-secondary flex-1 py-3 text-sm">
            Открыть уведомления
          </button>
          <button type="button" onClick={() => void handleReject()} disabled={busy} className="admin-btn-secondary flex-1 py-3 text-sm">
            Отменить
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy}
            className={`${isBustout ? 'admin-btn-primary' : 'admin-btn-danger'} flex-1 py-3 text-sm`}
          >
            {busy ? '...' : isBustout ? 'Подтвердить' : 'Принято'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Counter block ────────────────────────────────────────────────────────
const CounterBlock = React.memo(function CounterBlock({
  label,
  sublabel,
  value,
  disabled = false,
  onAdd,
  onRemove,
}: {
  label: string;
  sublabel?: string;
  value: number;
  disabled?: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="bg-[#0A0A0A] rounded-xl px-2 py-3 flex flex-col items-center gap-2">
      <div className="text-center">
        <div className="text-[#666] text-[10px] uppercase tracking-widest leading-tight">{label}</div>
        {sublabel && <div className="text-[#444] text-[9px] leading-tight">{sublabel}</div>}
      </div>
      <div className="text-white font-black text-3xl leading-none">{value}</div>
      <div className="flex gap-1 w-full">
        <button
          onClick={onRemove}
          disabled={disabled}
          className="flex-1 py-3 rounded-lg bg-[#2D2D2D] text-[#888] hover:bg-[#3D3D3D] font-bold text-lg transition-colors disabled:opacity-30 disabled:hover:bg-[#2D2D2D]"
        >
          −
        </button>
        <button
          onClick={onAdd}
          disabled={disabled}
          className="flex-1 py-3 rounded-lg bg-[#C0392B] text-white hover:bg-[#E31E24] font-bold text-base transition-colors disabled:opacity-30 disabled:hover:bg-[#C0392B]"
        >
          +1
        </button>
      </div>
    </div>
  );
})

const ExtraCounterBlock = React.memo(function ExtraCounterBlock({
  label, total, locked, extra, onAdd, onRemove,
}: {
  label: string; total: number; locked: number; extra: number;
  onAdd: () => void; onRemove: () => void;
}) {
  const canRemove = extra > 0;
  return (
    <div className="bg-[#0A0A0A] rounded-xl px-2 py-3 flex flex-col items-center gap-2">
      <div className="text-center">
        <div className="text-[#666] text-[10px] uppercase tracking-widest leading-tight">{label}</div>
        {locked > 0 && <div className="text-[#444] text-[9px] leading-tight">{locked} у игроков</div>}
      </div>
      <div className="text-white font-black text-3xl leading-none">{total}</div>
      <div className="flex gap-1 w-full">
        <button onClick={onRemove} disabled={!canRemove}
          className="flex-1 py-3 rounded-lg bg-[#2D2D2D] text-[#888] hover:bg-[#3D3D3D] font-bold text-lg transition-colors disabled:opacity-30 disabled:hover:bg-[#2D2D2D]">−</button>
        <button onClick={onAdd}
          className="flex-1 py-3 rounded-lg bg-[#C0392B] text-white hover:bg-[#E31E24] font-bold text-base transition-colors">+1</button>
      </div>
    </div>
  );
})

const ExtraBonusBlock = React.memo(function ExtraBonusBlock({
  label, total, locked, extra, onAdd, onRemove, onSetExtra,
}: {
  label: string; total: number; locked: number; extra: number;
  onAdd: () => void; onRemove: () => void; onSetExtra: (value: number) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const canRemove = extra > 0;

  const openEdit = () => { setDraft(String(extra)); setEditing(true); };
  const confirmEdit = () => {
    const v = Math.max(0, parseInt(draft, 10) || 0);
    onSetExtra(v);
    setEditing(false);
  };

  return (
    <div className="bg-[#0A0A0A] rounded-xl px-2 py-3 flex flex-col items-center gap-2">
      <div className="text-center">
        <div className="text-[#666] text-[10px] uppercase tracking-widest leading-tight">{label}</div>
        {locked > 0 && <div className="text-[#444] text-[9px] leading-tight">{locked} у игроков</div>}
      </div>
      {editing ? (
        <div className="flex flex-col items-center gap-1.5 w-full">
          <div className="text-[#555] text-[9px]">свободных бонусов</div>
          <input
            type="number" min="0" inputMode="numeric" autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') confirmEdit(); if (e.key === 'Escape') setEditing(false); }}
            className="w-full text-center bg-[#1A1A1A] border border-[#C0392B]/60 rounded-lg px-2 py-1 text-white font-black text-xl focus:outline-none"
          />
          <div className="text-[#444] text-[9px]">итого: {locked + (parseInt(draft, 10) || 0)}</div>
          <div className="flex gap-1 w-full">
            <button onClick={() => setEditing(false)} className="flex-1 py-1.5 rounded-lg bg-[#2D2D2D] text-[#888] text-xs font-bold">Отмена</button>
            <button onClick={confirmEdit} className="flex-1 py-1.5 rounded-lg bg-[#C0392B] text-white text-xs font-bold">Сохранить</button>
          </div>
        </div>
      ) : (
        <>
          <button onClick={openEdit} title="Нажмите чтобы задать число"
            className="text-white font-black text-3xl leading-none hover:text-[#C0392B] transition-colors cursor-pointer">
            {total}
          </button>
          <div className="flex gap-1 w-full">
            <button onClick={onRemove} disabled={!canRemove}
              className="flex-1 py-3 rounded-lg bg-[#2D2D2D] text-[#888] hover:bg-[#3D3D3D] font-bold text-lg transition-colors disabled:opacity-30 disabled:hover:bg-[#2D2D2D]">−</button>
            <button onClick={onAdd}
              className="flex-1 py-3 rounded-lg bg-[#C0392B] text-white hover:bg-[#E31E24] font-bold text-base transition-colors">+1</button>
          </div>
        </>
      )}
    </div>
  );
})
