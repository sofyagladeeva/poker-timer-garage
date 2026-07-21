import { supabase } from './supabase.ts';
import type { PlayerGift, PlayerGiftType, PlayerGiftStatus, PlayerGiftSource, PlayerGiftValidCondition } from './types.ts';

function normalizeGiftRow(row: Record<string, unknown>): PlayerGift {
  return {
    id: String(row.id ?? ''),
    telegramId: row.telegram_id != null ? Number(row.telegram_id) : null,
    playerName: String(row.player_name ?? ''),
    username: row.username != null ? String(row.username) : null,
    type: (row.type as PlayerGiftType) ?? 'custom',
    comment: row.comment != null ? String(row.comment) : null,
    validCondition: (row.valid_condition as PlayerGiftValidCondition) ?? 'indefinite',
    validTournamentBotId: row.valid_tournament_bot_id != null ? Number(row.valid_tournament_bot_id) : null,
    validTournamentTitle: row.valid_tournament_title != null ? String(row.valid_tournament_title) : null,
    validUntil: row.valid_until != null ? String(row.valid_until) : null,
    status: (row.status as PlayerGiftStatus) ?? 'active',
    source: (row.source as PlayerGiftSource) ?? 'manual',
    sourceMonth: row.source_month != null ? String(row.source_month) : null,
    issuedAtSessionId: row.issued_at_session_id != null ? Number(row.issued_at_session_id) : null,
    issuedAtTournamentBotId: row.issued_at_tournament_bot_id != null ? Number(row.issued_at_tournament_bot_id) : null,
    issuedAtTournamentTitle: row.issued_at_tournament_title != null ? String(row.issued_at_tournament_title) : null,
    issuedBy: row.issued_by != null ? String(row.issued_by) : null,
    createdAt: String(row.created_at ?? ''),
    redeemedAt: row.redeemed_at != null ? String(row.redeemed_at) : null,
    redeemedAtSessionId: row.redeemed_at_session_id != null ? Number(row.redeemed_at_session_id) : null,
    redeemedAtTournamentBotId: row.redeemed_at_tournament_bot_id != null ? Number(row.redeemed_at_tournament_bot_id) : null,
    redeemedAtTournamentTitle: row.redeemed_at_tournament_title != null ? String(row.redeemed_at_tournament_title) : null,
    redeemedBy: row.redeemed_by != null ? String(row.redeemed_by) : null,
    notifiedAt: row.notified_at != null ? String(row.notified_at) : null,
    reminderSentAt: row.reminder_sent_at != null ? String(row.reminder_sent_at) : null,
  };
}

export function isGiftValidNow(gift: PlayerGift, tournamentBotId: number | null, tournamentTitle?: string | null, currentSessionId?: number | null): boolean {
  if (gift.status !== 'active') return false;
  if (gift.validCondition === 'next_tournament') {
    // Not applicable in the same session it was issued
    if (gift.issuedAtSessionId != null && currentSessionId != null && gift.issuedAtSessionId === currentSessionId) return false;
    return true;
  }
  if (gift.validCondition === 'until_date' || gift.validCondition === 'next_month') {
    return gift.validUntil != null && new Date(gift.validUntil) >= new Date();
  }
  if (gift.validCondition === 'specific_tournament') {
    if (gift.validTournamentBotId != null) {
      return tournamentBotId != null && gift.validTournamentBotId === tournamentBotId;
    }
    return gift.validTournamentTitle != null && gift.validTournamentTitle === tournamentTitle;
  }
  return true;
}

export async function fetchActiveGiftsByTelegramIds(telegramIds: number[], sessionId?: number | null): Promise<PlayerGift[]> {
  if (telegramIds.length === 0) return [];
  let query = supabase
    .from('player_gifts')
    .select('*')
    .in('telegram_id', telegramIds)
    .order('created_at', { ascending: true });
  if (sessionId != null) {
    query = query.or(`status.eq.active,and(status.eq.redeemed,redeemed_at_session_id.eq.${sessionId})`);
  } else {
    query = query.eq('status', 'active');
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(row => normalizeGiftRow(row as Record<string, unknown>));
}

export async function fetchGiftsByTelegramId(telegramId: number): Promise<PlayerGift[]> {
  const { data, error } = await supabase
    .from('player_gifts')
    .select('*')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(row => normalizeGiftRow(row as Record<string, unknown>));
}

export interface CreateGiftParams {
  telegramId: number | null;
  playerName: string;
  username: string | null;
  type: PlayerGiftType;
  comment: string | null;
  validCondition: PlayerGiftValidCondition;
  validTournamentBotId?: number | null;
  validTournamentTitle?: string | null;
  validUntil?: string | null;
  source?: PlayerGiftSource;
  sourceMonth?: string | null;
  issuedAtSessionId?: number | null;
  issuedAtTournamentBotId?: number | null;
  issuedAtTournamentTitle?: string | null;
  issuedBy?: string | null;
}

export async function createGift(params: CreateGiftParams): Promise<PlayerGift> {
  const { data, error } = await supabase
    .from('player_gifts')
    .insert({
      telegram_id: params.telegramId,
      player_name: params.playerName,
      username: params.username,
      type: params.type,
      comment: params.comment,
      valid_condition: params.validCondition,
      valid_tournament_bot_id: params.validTournamentBotId ?? null,
      valid_tournament_title: params.validTournamentTitle ?? null,
      valid_until: params.validUntil ?? null,
      status: 'active',
      source: params.source ?? 'manual',
      source_month: params.sourceMonth ?? null,
      issued_at_session_id: params.issuedAtSessionId ?? null,
      issued_at_tournament_bot_id: params.issuedAtTournamentBotId ?? null,
      issued_at_tournament_title: params.issuedAtTournamentTitle ?? null,
      issued_by: params.issuedBy ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return normalizeGiftRow(data as Record<string, unknown>);
}

export interface RedeemGiftParams {
  giftId: string;
  sessionId: number | null;
  tournamentBotId: number | null;
  tournamentTitle: string | null;
  redeemedBy?: string | null;
}

export async function redeemGift(params: RedeemGiftParams): Promise<void> {
  const { error } = await supabase
    .from('player_gifts')
    .update({
      status: 'redeemed',
      redeemed_at: new Date().toISOString(),
      redeemed_at_session_id: params.sessionId,
      redeemed_at_tournament_bot_id: params.tournamentBotId,
      redeemed_at_tournament_title: params.tournamentTitle,
      redeemed_by: params.redeemedBy ?? null,
    })
    .eq('id', params.giftId)
    .eq('status', 'active');
  if (error) throw error;
}

export interface UpdateGiftParams {
  giftId: string;
  type: PlayerGiftType;
  comment: string | null;
  validCondition: PlayerGiftValidCondition;
  validUntil: string | null;
  validTournamentTitle: string | null;
}

export async function updateGift(params: UpdateGiftParams): Promise<void> {
  const { error } = await supabase
    .from('player_gifts')
    .update({
      type: params.type,
      comment: params.comment,
      valid_condition: params.validCondition,
      valid_until: params.validUntil,
      valid_tournament_title: params.validTournamentTitle,
    })
    .eq('id', params.giftId)
    .eq('status', 'active');
  if (error) throw error;
}

export async function unredeemGift(giftId: string): Promise<void> {
  const { error } = await supabase
    .from('player_gifts')
    .update({
      status: 'active',
      redeemed_at: null,
      redeemed_at_session_id: null,
      redeemed_at_tournament_bot_id: null,
      redeemed_at_tournament_title: null,
      redeemed_by: null,
    })
    .eq('id', giftId)
    .eq('status', 'redeemed');
  if (error) throw error;
}

export async function reactivateGift(giftId: string): Promise<void> {
  const { error } = await supabase
    .from('player_gifts')
    .update({ status: 'active', redeemed_at: null, redeemed_by: null })
    .eq('id', giftId)
    .eq('status', 'cancelled');
  if (error) throw error;
}

export async function cancelGift(giftId: string): Promise<void> {
  const { error } = await supabase
    .from('player_gifts')
    .update({ status: 'cancelled' })
    .eq('id', giftId)
    .eq('status', 'active');
  if (error) throw error;
}

export async function markGiftNotified(giftId: string): Promise<void> {
  const { error } = await supabase
    .from('player_gifts')
    .update({ notified_at: new Date().toISOString() })
    .eq('id', giftId)
    .is('notified_at', null);
  if (error) throw error;
}

export async function fetchAllGifts(): Promise<PlayerGift[]> {
  const { data, error } = await supabase
    .from('player_gifts')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(row => normalizeGiftRow(row as Record<string, unknown>));
}
