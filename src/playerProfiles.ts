import { supabase } from './supabase.ts';
import type { PlayerProfile, PlayerProfileDefaultStatus } from './types.ts';

function normalizeProfileRow(row: Record<string, unknown>): PlayerProfile {
  return {
    id: String(row.id ?? ''),
    telegramId: row.telegram_id != null ? Number(row.telegram_id) : null,
    playerName: String(row.player_name ?? ''),
    username: row.username != null ? String(row.username) : null,
    phone: row.phone != null ? String(row.phone) : null,
    defaultArrivalStatus: (row.default_arrival_status as PlayerProfileDefaultStatus) ?? 'paid',
    notes: row.notes != null ? String(row.notes) : null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export function buildProfilesMapByTelegramId(profiles: PlayerProfile[]): Map<number, PlayerProfile> {
  const map = new Map<number, PlayerProfile>();
  for (const p of profiles) {
    if (p.telegramId != null) map.set(p.telegramId, p);
  }
  return map;
}

export async function fetchPlayerProfiles(): Promise<PlayerProfile[]> {
  const { data, error } = await supabase
    .from('player_profiles')
    .select('*')
    .order('player_name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(row => normalizeProfileRow(row as Record<string, unknown>));
}

export async function upsertPlayerProfile(
  profile: Omit<PlayerProfile, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<PlayerProfile> {
  const row: Record<string, unknown> = {
    telegram_id: profile.telegramId,
    player_name: profile.playerName.trim(),
    username: profile.username?.trim() || null,
    phone: profile.phone?.trim() || null,
    default_arrival_status: profile.defaultArrivalStatus,
    notes: profile.notes?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (profile.id) row.id = profile.id;

  const { data, error } = await supabase
    .from('player_profiles')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return normalizeProfileRow(data as Record<string, unknown>);
}

export async function deletePlayerProfile(id: string): Promise<void> {
  const { error } = await supabase.from('player_profiles').delete().eq('id', id);
  if (error) throw error;
}
