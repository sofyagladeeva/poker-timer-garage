import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env');
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder'
);

// ─── Default data ──────────────────────────────────────────────────────────

export const DEFAULT_BLIND_LEVELS = [
  { id: '1', level: 1, sb: 100, bb: 200, ante: 200, duration: 1200, isBreak: false },
  { id: '2', level: 2, sb: 200, bb: 400, ante: 400, duration: 1200, isBreak: false },
  { id: '3', level: 3, sb: 300, bb: 600, ante: 600, duration: 1200, isBreak: false },
  { id: 'b1', level: 0, sb: 0, bb: 0, ante: 0, duration: 900, isBreak: true, breakLabel: 'ПЕРЕРЫВ' },
  { id: '4', level: 4, sb: 400, bb: 800, ante: 800, duration: 1200, isBreak: false },
  { id: '5', level: 5, sb: 500, bb: 1000, ante: 1000, duration: 1200, isBreak: false },
  { id: '6', level: 6, sb: 700, bb: 1400, ante: 1400, duration: 1200, isBreak: false },
  { id: '7', level: 7, sb: 1000, bb: 2000, ante: 2000, duration: 1200, isBreak: false },
  { id: '8', level: 8, sb: 1500, bb: 3000, ante: 3000, duration: 1200, isBreak: false },
  { id: '9', level: 9, sb: 2000, bb: 4000, ante: 4000, duration: 1200, isBreak: false },
  { id: '10', level: 10, sb: 3000, bb: 6000, ante: 6000, duration: 1200, isBreak: false },
];

export const DEFAULT_GAME_STATE = {
  status: 'idle' as const,
  currentLevelIndex: 0,
  timeLeft: 1200,
  lastTickAt: null,
  players: 0,
  outs: 0,
  rebuys: 0,
  addonCount: 0,
  startStack: 0,
  addonStack: 0,
  totalStack: 0,
  backgroundUrl: null,
  nextGameInfo: '',
  showRating: false,
  prizeAmount: 0,
  prizePlaces: 3,
  tournamentTitle: '',
  tournamentBotId: null,
};
