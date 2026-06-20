import { supabase } from './supabase';
import type { GameState } from './types';

export interface DisplayClient {
  id: string;
  name: string;
  route: string;
  userAgent: string;
  lastSeenAt: string;
  currentLevelIndex: number;
  currentLevelLabel: string | null;
  status: GameState['status'];
}

interface DisplayClientRow {
  id: string;
  name: string | null;
  route: string | null;
  user_agent: string | null;
  last_seen_at: string;
  current_level_index: number | null;
  current_level_label: string | null;
  status: GameState['status'] | null;
}

const TABLE = 'display_clients';
const DISPLAY_CLIENT_ID_KEY = 'poker_display_client_id';
const HEARTBEAT_VISIBLE_MS = 5_000;
const HEARTBEAT_HIDDEN_MS = 15_000;
const DISPLAY_ONLINE_MS = 90_000;
const DISPLAY_CLIENT_RETENTION_MS = 60 * 60 * 1_000;

export const DISPLAY_PRESENCE_ONLINE_MS = DISPLAY_ONLINE_MS;

export function isDisplayPresenceEnabled() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

function createClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `display_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getDisplayClientId() {
  try {
    const existing = localStorage.getItem(DISPLAY_CLIENT_ID_KEY);
    if (existing) return existing;

    const next = createClientId();
    localStorage.setItem(DISPLAY_CLIENT_ID_KEY, next);
    return next;
  } catch {
    return createClientId();
  }
}

export function getDisplayHeartbeatInterval() {
  return document.visibilityState === 'visible' ? HEARTBEAT_VISIBLE_MS : HEARTBEAT_HIDDEN_MS;
}

function toDisplayClient(row: DisplayClientRow): DisplayClient {
  return {
    id: row.id,
    name: row.name || 'TV экран',
    route: row.route || 'display',
    userAgent: row.user_agent || '',
    lastSeenAt: row.last_seen_at,
    currentLevelIndex: row.current_level_index ?? 0,
    currentLevelLabel: row.current_level_label,
    status: row.status || 'idle',
  };
}

function isDisplayClientRetained(row: DisplayClientRow, now = Date.now()) {
  const seenAt = Date.parse(row.last_seen_at);
  return Number.isFinite(seenAt) && now - seenAt < DISPLAY_CLIENT_RETENTION_MS;
}

export async function sendDisplayHeartbeat(input: {
  id: string;
  name: string;
  gameState: GameState;
  currentLevelLabel: string | null;
}) {
  if (!isDisplayPresenceEnabled()) return { ok: true, error: null };

  const { error } = await supabase.from(TABLE).upsert({
    id: input.id,
    name: input.name,
    route: 'display',
    user_agent: navigator.userAgent,
    last_seen_at: new Date().toISOString(),
    current_level_index: input.gameState.currentLevelIndex,
    current_level_label: input.currentLevelLabel,
    status: input.gameState.status,
  });

  return { ok: !error, error };
}

export async function fetchDisplayClients() {
  if (!isDisplayPresenceEnabled()) return { clients: [] as DisplayClient[], error: null };

  const now = Date.now();
  const staleBefore = new Date(now - DISPLAY_CLIENT_RETENTION_MS).toISOString();
  await supabase
    .from(TABLE)
    .delete()
    .lt('last_seen_at', staleBefore);

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('last_seen_at', { ascending: false })
    .limit(20);

  return {
    clients: ((data ?? []) as DisplayClientRow[]).filter(row => isDisplayClientRetained(row, now)).map(toDisplayClient),
    error,
  };
}
