import { createClient } from '@supabase/supabase-js';
import { createGarageBlindTemplate } from './blindStructure.ts';

const ENV = (import.meta as ImportMeta & {
  env?: {
    VITE_SUPABASE_URL?: string;
    VITE_SUPABASE_ANON_KEY?: string;
  };
}).env;

const supabaseUrl = ENV?.VITE_SUPABASE_URL || '';
const supabaseAnonKey = ENV?.VITE_SUPABASE_ANON_KEY || '';

if ((typeof window !== 'undefined' || typeof document !== 'undefined') && (!supabaseUrl || !supabaseAnonKey)) {
  console.warn('Supabase credentials missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env');
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder'
);

// ─── Default data ──────────────────────────────────────────────────────────

export const DEFAULT_BLIND_LEVELS = createGarageBlindTemplate();

export const DEFAULT_GAME_STATE = {
  status: 'idle' as const,
  currentLevelIndex: 0,
  timeLeft: 1200,
  lastTickAt: null,
  players: 0,
  outs: 0,
  rebuys: 0,
  addonCount: 0,
  bonusCount: 0,
  startStack: 0,
  addonStack: 0,
  bonusStack: 0,
  totalStack: 0,
  backgroundUrl: null,
  nextGameInfo: '',
  showRating: false,
  prizeAmount: 0,
  prizePlaces: 3,
  tournamentTitle: '',
  tournamentBotId: null,
  nextGameBotId: null,
  resetAt: 0,
};
