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
  startStack: number;   // фишек на старт (= стоимость ребая)
  addonStack: number;   // фишек за аддон
  totalStack: number;   // авто: (players+rebuys)*startStack + addonCount*addonStack
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
  total_stack: number;
  levels_played: number;
}

// Rank points based on actual Excel formula:
// Total pool = n*(n+1)/2 where n = number of players
// Points per place = pool * percentage (only top 9 places get points)
const PLACE_PERCENTAGES = [0.315, 0.195, 0.137, 0.105, 0.067, 0.054, 0.047, 0.042, 0.038];

export function getRankPoints(playerCount: number): number[] {
  if (playerCount < 2) return [];
  const pool = (playerCount * (playerCount + 1)) / 2;
  return PLACE_PERCENTAGES.map(pct => Math.round(pool * pct));
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
