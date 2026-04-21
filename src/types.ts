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
  createdAt: string;
}

export type GameStatus = 'idle' | 'running' | 'paused' | 'break' | 'ended';

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
  prizeAmount: number;
  prizePlaces: number;
  tournamentTitle: string; // название текущей игры
  tournamentBotId: number | null; // id игры в боте
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
}

// Rank points from Excel table (Покер RANK.xlsx), rounded to 1 decimal
const RANK_POINTS_TABLE: Record<number, number[]> = {
  9:  [14.2, 8.8,  6.2,  4.7,  3.0,  2.4,  2.1,  1.9,  1.7],
  10: [17.3, 10.7, 7.5,  5.8,  3.7,  3.0,  2.6,  2.3,  2.1],
  11: [20.8, 12.9, 9.0,  6.9,  4.4,  3.6,  3.1,  2.8,  2.5],
  12: [24.6, 15.2, 10.7, 8.2,  5.2,  4.2,  3.7,  3.3,  3.0],
  13: [28.7, 17.7, 12.5, 9.6,  6.1,  4.9,  4.3,  3.8,  3.5],
  14: [33.1, 20.5, 14.4, 11.0, 7.0,  5.7,  4.9,  4.4,  4.0],
  15: [37.8, 23.4, 16.4, 12.6, 8.0,  6.5,  5.6,  5.0,  4.6],
  16: [42.8, 26.5, 18.6, 14.3, 9.1,  7.3,  6.4,  5.7,  5.2],
  17: [48.2, 29.8, 21.0, 16.1, 10.3, 8.3,  7.2,  6.4,  5.8],
  18: [53.9, 33.3, 23.4, 18.0, 11.5, 9.2,  8.0,  7.2,  6.5],
  19: [59.9, 37.1, 26.0, 19.9, 12.7, 10.3, 8.9,  8.0,  7.2],
  20: [66.2, 41.0, 28.8, 22.1, 14.1, 11.3, 9.9,  8.8,  8.0],
  21: [72.8, 45.0, 31.6, 24.3, 15.5, 12.5, 10.9, 9.7,  8.8],
  22: [79.7, 49.3, 34.7, 26.6, 17.0, 13.7, 11.9, 10.6, 9.6],
  23: [86.9, 53.8, 37.8, 29.0, 18.5, 14.9, 13.0, 11.6, 10.5],
  24: [94.5, 58.5, 41.1, 31.5, 20.1, 16.2, 14.1, 12.6, 11.4],
  25: [102.4, 63.4, 44.5, 34.1, 21.8, 17.6, 15.3, 13.7, 12.3],
  26: [110.6, 68.4, 48.1, 36.9, 23.5, 19.0, 16.5, 14.7, 13.3],
  27: [119.1, 73.7, 51.8, 39.7, 25.3, 20.4, 17.8, 15.9, 14.4],
  28: [127.9, 79.2, 55.6, 42.6, 27.2, 21.9, 19.1, 17.1, 15.4],
  29: [137.0, 84.8, 59.6, 45.7, 29.1, 23.5, 20.4, 18.3, 16.5],
  30: [146.5, 90.7, 63.7, 48.8, 31.2, 25.1, 21.9, 19.5, 17.7],
  31: [156.2, 96.7, 68.0, 52.1, 33.2, 26.8, 23.3, 20.8, 18.8],
  32: [166.3, 103.0, 72.3, 55.4, 35.4, 28.5, 24.8, 22.2, 20.1],
  33: [176.7, 109.4, 76.9, 58.9, 37.6, 30.3, 26.4, 23.6, 21.3],
  34: [187.4, 116.0, 81.5, 62.5, 39.9, 32.1, 28.0, 25.0, 22.6],
  35: [198.4, 122.9, 86.3, 66.1, 42.2, 34.0, 29.6, 26.5, 23.9],
  36: [209.8, 129.9, 91.2, 69.9, 44.6, 36.0, 31.3, 28.0, 25.3],
  37: [221.4, 137.1, 96.3, 73.8, 47.1, 38.0, 33.0, 29.5, 26.7],
  38: [233.4, 144.5, 101.5, 77.8, 49.6, 40.0, 34.8, 31.1, 28.2],
  39: [245.7, 152.1, 106.9, 81.9, 52.3, 42.1, 36.7, 32.8, 29.6],
  40: [258.3, 159.9, 112.3, 86.1, 54.9, 44.3, 38.5, 34.4, 31.2],
};

export function getRankPoints(playerCount: number): number[] {
  return RANK_POINTS_TABLE[playerCount] ?? [];
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
