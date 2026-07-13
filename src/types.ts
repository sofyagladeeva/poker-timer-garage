export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs' | 'any';
export type Rank = 'A' | 'K' | 'Q' | 'J' | 'T' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export interface Combination {
  id: string;
  cards: Card[];
  description: string;
  enabled: boolean;
}

export interface BlindLevel {
  id: string;
  level: number;
  sb: number;
  bb: number;
  ante: number;
  duration: number; // seconds
  isBreak: boolean;
  breakLabel?: string;
}

export interface BlindTemplate {
  id: string;
  name: string;
  levels: BlindLevel[];
  startStack: number;
  addonStack: number;
  bonusStack: number;
  createdAt: string;
}

export type GameStatus = 'idle' | 'running' | 'paused' | 'break' | 'ended';

export interface ChipLeaderEntry {
  id: string;
  playerId: string;
  name: string;
  stack: number;
  tableNumber?: number | null;
  seatNumber?: number | null;
}

export interface ChipLeadersState {
  levelIndex: number;
  hideAfterLevelIndex?: number;
  entries: ChipLeaderEntry[];
}

export interface ChipLeaderSubmissionEntry {
  playerId: string;
  name: string;
  stack: number;
  tableNumber: number;
  seatNumber: number | null;
}

export interface ChipLeaderSubmission {
  sessionId: number;
  levelIndex: number;
  tableNumber: number;
  entries: ChipLeaderSubmissionEntry[];
  submittedAt: string;
}

export interface GameState {
  status: GameStatus;
  currentLevelIndex: number;
  timeLeft: number; // seconds remaining
  lastTickAt: number | null; // unix ms timestamp when last server-side tick noted
  players: number;
  outs: number;
  rebuys: number;
  addonCount: number;
  bonusCount: number;
  startStack: number;   // фишек на старт (= стоимость ребая)
  addonStack: number;   // фишек за аддон
  bonusStack: number;   // фишек за бонус
  totalStack: number;   // авто: (players+rebuys)*startStack + addonCount*addonStack + bonusCount*bonusStack
  backgroundUrl: string | null;
  nextGameInfo: string;
  showRating: boolean;
  showLogo: boolean;
  prizeAmount: number;
  prizePlaces: number;
  tournamentTitle: string; // название текущей игры
  tournamentBotId: number | null; // id игры в боте
  nextGameBotId: number | null; // id следующей игры (выбирается вручную в админке)
  tournamentBuyIn: number | null; // стоимость входа из бота (null = использовать дефолт 1000)
  rebuyCost: number | null;        // null = использовать tournamentBuyIn или дефолт 1000
  addonCost: number | null;        // null = использовать tournamentBuyIn или дефолт 1000
  chipLeaders: ChipLeadersState | null; // показываются на табло ограниченное число уровней
  chipLeaderCollectionActive: boolean; // ручной сбор стеков дилерами вне перерыва
  resetAt: number; // unix ms timestamp of last resetTournament() — used to detect stale admin devices
  tableCount: number; // количество открытых столов для дилерских планшетов
  addonOpen: boolean; // активирован ли приём аддонов
  extraAddonCount: number; // аддоны вне игроков, добавленные вручную из «Управления»
  extraBonusCount: number; // бонусы вне игроков, добавленные вручную из «Управления»
}

export type LiveTournamentPlayerSource = 'bot' | 'manual';
export type LiveTournamentRegistrationSource = 'registered' | 'waitlist';
export type LiveTournamentPlayerStatus = 'registered' | 'waitlist' | 'active' | 'out';
export type LiveTournamentArrivalStatus = 'absent' | 'paid' | 'free' | 'promo' | 'freePromo' | 'admin';
export type LiveTournamentPaymentMethod = 'unpaid' | 'cash' | 'card' | 'split';

export interface LiveTournamentPlayer {
  id: string;
  sessionId: number;
  tournamentBotId: number | null;
  botRegistrationId: string | null;
  telegramId: number | null;
  name: string;
  username: string | null;
  realName: string | null;
  phone: string | null;
  instagram: string | null;
  source: LiveTournamentPlayerSource;
  registrationSource: LiveTournamentRegistrationSource;
  status: LiveTournamentPlayerStatus;
  arrivalStatus: LiveTournamentArrivalStatus;
  rebuyCount: number;
  addonCount: number;
  bonusCount: number;
  bounty: number;
  bonusRcPoints: number;
  cashPaid: number;
  cardPaid: number;
  paymentDue: number;
  paymentDueOverride: boolean;
  place: number | null;
  placeOverride: boolean;
  bustoutOrder: number | null;
  sortOrder: number;
  registeredAt: string | null;
  createdAt: string;
  updatedAt: string;
  tableNumber: number | null;
  seatNumber: number | null;
}

export type FloorNotificationType = 'floor_call' | 'bustout';
export type FloorNotificationStatus = 'pending' | 'confirmed';

export interface FloorNotification {
  id: string;
  sessionId: number;
  type: FloorNotificationType;
  tableNumber: number;
  playerId: string | null;
  playerName: string | null;
  projectedPlace: number | null;
  bounty: number;
  status: FloorNotificationStatus;
  createdAt: string;
  confirmedAt: string | null;
}

export interface TournamentPlayersSummary {
  entrants: number;
  active: number;
  bustouts: number;
  pending: number;
  waitlist: number;
  rebuys: number;
  addons: number;
  bonuses: number;
  bountyTotal: number;
  paidEntries: number;
  freeEntries: number;
  totalDue: number;
}

export interface RatingPlayer {
  id: string;
  name: string;
  points: number;
  place?: number;
}

export interface Tournament {
  id: string;
  startedAt: string;
  endedAt: string | null;
  players: number;
  totalStack: number;
  blindStructure: BlindLevel[];
  status: 'ongoing' | 'completed';
}

export interface TournamentRecord {
  id: number;
  finished_at: string;
  title: string | null;
  players: number;
  rebuys: number;
  addon_count: number;
  bonus_count?: number;
  bonus_stack?: number;
  total_stack: number;
  levels_played: number;
  archive_details?: TournamentArchiveDetails | null;
}

export interface TournamentArchivePlayerRecord {
  id: string;
  telegramId?: number | null;
  botRegistrationId?: string | null;
  name: string;
  username: string | null;
  source: LiveTournamentPlayerSource;
  registrationSource: LiveTournamentRegistrationSource;
  status: LiveTournamentPlayerStatus;
  arrivalStatus: LiveTournamentArrivalStatus;
  rebuyCount: number;
  addonCount: number;
  bonusCount: number;
  bounty: number;
  bonusRcPoints: number;
  cashPaid?: number;
  cardPaid?: number;
  paymentMethod?: LiveTournamentPaymentMethod;
  paymentDue: number;
  place: number | null;
  bustoutOrder: number | null;
  createdAt: string;
  updatedAt: string;
}

export type PersonnelRole = 'dealer' | 'admin' | 'custom';

export interface StaffMember {
  id: string;
  name: string;
  role: PersonnelRole;
  roleLabel: string;
  baseRate: number;
  phone: string;
  telegramUsername: string;
  active: boolean;
  createdAt: string;
}

export interface PersonnelRecord {
  id: string;
  staffMemberId?: string;
  name: string;
  role: PersonnelRole;
  roleLabel: string;
  cashAmount: number;
  cardAmount: number;
}

export interface TournamentArchiveDetails {
  tournamentBotId?: number | null;
  tournamentTitle?: string;
  resultsSentAt?: string | null;
  resultsSignature?: string | null;
  players: TournamentArchivePlayerRecord[];
  summary: TournamentPlayersSummary | null;
  savedAt: string;
  personnel?: PersonnelRecord[];
}

export interface TournamentFinancePlayerRecord {
  id: string;
  botRegistrationId: string | null;
  telegramId: number | null;
  name: string;
  username: string | null;
  source: LiveTournamentPlayerSource;
  registrationSource: LiveTournamentRegistrationSource;
  arrivalStatus: LiveTournamentArrivalStatus;
  paymentMethod: LiveTournamentPaymentMethod;
  cashPaid: number;
  cardPaid: number;
  paymentDue: number;
  rebuyCount: number;
  addonCount: number;
  bonusCount: number;
  bounty: number;
  status: LiveTournamentPlayerStatus;
  place: number | null;
  bustoutOrder: number | null;
}

export interface TournamentFinancePayload {
  sessionId: number;
  tournamentBotId: number | null;
  tournamentTitle: string;
  tournamentMode?: string;
  finishedAt: string;
  levelsPlayed: number;
  gameStatus: string;
  summary: {
    entrants: number;
    active: number;
    bustouts: number;
    pending: number;
    waitlist: number;
    rebuys: number;
    addons: number;
    bonusCount: number;
    bountyTotal: number;
    paidEntries: number;
    freeEntries: number;
    totalDue: number;
    cashTotal: number;
    cardTotal: number;
    totalPaid: number;
    discountTotal: number;
  };
  players: TournamentFinancePlayerRecord[];
}

export interface TournamentResultsPlayerRecord {
  id: string;
  botRegistrationId: string | null;
  telegramId: number | null;
  name: string;
  username: string | null;
  source: LiveTournamentPlayerSource;
  registrationSource: LiveTournamentRegistrationSource;
  arrivalStatus: LiveTournamentArrivalStatus;
  paymentMethod: LiveTournamentPaymentMethod;
  cashPaid: number;
  cardPaid: number;
  paymentDue: number;
  rebuyCount: number;
  addonCount: number;
  bounty: number;
  bonusRcPoints: number;
  status: LiveTournamentPlayerStatus;
  place: number | null;
  bustoutOrder: number | null;
  points: number;
}

export interface TournamentResultsPayload {
  sessionId: number;
  tournamentBotId: number | null;
  tournamentTitle: string;
  tournamentMode?: string;
  finishedAt: string;
  levelsPlayed: number;
  gameStatus: string;
  summary: {
    entrants: number;
    active: number;
    bustouts: number;
    pending: number;
    waitlist: number;
    rebuys: number;
    addons: number;
    bountyTotal: number;
    paidEntries: number;
    freeEntries: number;
    totalDue: number;
    bonusCount: number;
    totalStack: number;
    lateRegistrationPlayers?: number | null;
    ratingPlayerCount?: number | null;
  };
  players: TournamentResultsPlayerRecord[];
}

// Rank points from Excel table (Покер RANK.xlsx):
// total points are distributed across top-9 with fixed shares.
const RANK_POINT_SHARES = [0.315, 0.195, 0.137, 0.105, 0.067, 0.054, 0.047, 0.042, 0.038] as const;
const MIN_RANKED_PLAYERS = 9;

export function getRankPoints(playerCount: number): number[] {
  if (playerCount < MIN_RANKED_PLAYERS) return [];

  const coefficient = 1 + Math.floor(playerCount / 10) * 0.1;
  const totalPoints = 5000 * coefficient;
  return RANK_POINT_SHARES.map(share => Number((totalPoints * share).toFixed(1)));
}

export function calcPrizePool(total: number, places: number): number[] {
  // Distribution percentages by places
  const distributions: Record<number, number[]> = {
    3: [0.5, 0.3, 0.2],
    5: [0.4, 0.25, 0.18, 0.1, 0.07],
    7: [0.35, 0.22, 0.15, 0.1, 0.08, 0.06, 0.04],
  };
  const dist = distributions[places] || distributions[3];
  return dist.map(p => Math.round(total * p));
}

export const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  any: '?',
};

export const RED_SUITS: Suit[] = ['hearts', 'diamonds'];
