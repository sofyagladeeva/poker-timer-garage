import { supabase } from './supabase';
import type { PersonnelRecord, PersonnelRole, StaffMember } from './types';

const STAFF_STORAGE_KEY = 'poker_timer_staff_v1';
const DRAFT_STORAGE_PREFIX = 'personnel_draft:';
const SHARED_TABLE = 'staff';
const DRAFT_TABLE = 'blind_templates';

type StaffRow = {
  id: string;
  name: string;
  role: string;
  role_label: string;
  base_rate: number;
  phone: string;
  telegram_username: string;
  active: boolean;
  created_at: string;
};

function isSupabaseConfigured() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

function normalizeAmount(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function normalizeRole(value: unknown): PersonnelRole {
  return value === 'admin' || value === 'custom' ? value : 'dealer';
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function toStaffMember(row: StaffRow): StaffMember {
  return {
    id: row.id,
    name: row.name.trim(),
    role: normalizeRole(row.role),
    roleLabel: row.role_label.trim(),
    baseRate: normalizeAmount(row.base_rate),
    phone: row.phone?.trim() ?? '',
    telegramUsername: row.telegram_username?.replace(/^@/, '').trim() ?? '',
    active: row.active !== false,
    createdAt: row.created_at,
  };
}

function toStaffRow(member: StaffMember) {
  return {
    id: member.id,
    name: member.name.trim(),
    role: member.role,
    role_label: member.roleLabel.trim() || (member.role === 'admin' ? 'Админ' : member.role === 'dealer' ? 'Дилер' : 'Другое'),
    base_rate: normalizeAmount(member.baseRate),
    phone: member.phone.trim(),
    telegram_username: member.telegramUsername.replace(/^@/, '').trim(),
    active: member.active,
    created_at: member.createdAt,
  };
}

function normalizePersonnelRecord(raw: unknown): PersonnelRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<PersonnelRecord>;
  if (typeof item.id !== 'string' || typeof item.name !== 'string') return null;
  return {
    id: item.id,
    staffMemberId: typeof item.staffMemberId === 'string' ? item.staffMemberId : undefined,
    name: item.name,
    role: normalizeRole(item.role),
    roleLabel: typeof item.roleLabel === 'string' ? item.roleLabel : '',
    cashAmount: normalizeAmount(item.cashAmount),
    cardAmount: normalizeAmount(item.cardAmount),
  };
}

export function createStaffMember(): StaffMember {
  return {
    id: createId(),
    name: '',
    role: 'dealer',
    roleLabel: 'Дилер',
    baseRate: 0,
    phone: '',
    telegramUsername: '',
    active: true,
    createdAt: new Date().toISOString(),
  };
}

export function loadLocalStaffDirectory(): StaffMember[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STAFF_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && typeof item === 'object' && typeof item.id === 'string')
      .map(item => ({
        ...createStaffMember(),
        ...item,
        role: normalizeRole(item.role),
        baseRate: normalizeAmount(item.baseRate),
        active: item.active !== false,
      }));
  } catch {
    return [];
  }
}

function saveLocalStaffDirectory(members: StaffMember[]) {
  localStorage.setItem(STAFF_STORAGE_KEY, JSON.stringify(members));
}

export async function fetchStaffDirectory(): Promise<StaffMember[]> {
  if (!isSupabaseConfigured()) return loadLocalStaffDirectory();
  const { data, error } = await supabase
    .from(SHARED_TABLE)
    .select('id, name, role, role_label, base_rate, phone, telegram_username, active, created_at')
    .order('active', { ascending: false })
    .order('name');
  if (error) throw new Error('Не удалось загрузить справочник сотрудников. Выполните supabase/staff.sql.');
  const members = (data ?? []).map(row => toStaffMember(row as StaffRow));
  saveLocalStaffDirectory(members);
  return members;
}

export async function saveStaffMember(member: StaffMember) {
  const current = loadLocalStaffDirectory();
  const next = [...current.filter(item => item.id !== member.id), member];
  saveLocalStaffDirectory(next);
  if (!isSupabaseConfigured()) return;
  const { error } = await supabase.from(SHARED_TABLE).upsert(toStaffRow(member));
  if (error) throw new Error('Не удалось сохранить сотрудника.');
}

export async function deactivateStaffMember(member: StaffMember) {
  return saveStaffMember({ ...member, active: false });
}

export async function deleteStaffMember(id: string) {
  const current = loadLocalStaffDirectory();
  saveLocalStaffDirectory(current.filter(member => member.id !== id));
  if (!isSupabaseConfigured()) return;
  const { error } = await supabase.from(SHARED_TABLE).delete().eq('id', id);
  if (error) throw new Error('Не удалось удалить сотрудника.');
}

export function mergePersonnelRecords(records: PersonnelRecord[]): PersonnelRecord[] {
  const merged = new Map<string, PersonnelRecord>();
  for (const record of records) {
    const normalized = normalizePersonnelRecord(record);
    if (!normalized) continue;
    const key = normalized.staffMemberId ? `staff:${normalized.staffMemberId}` : `legacy:${normalized.id}`;
    const existing = merged.get(key);
    if (existing) {
      existing.cashAmount += normalized.cashAmount;
      existing.cardAmount += normalized.cardAmount;
    } else {
      merged.set(key, { ...normalized });
    }
  }
  return Array.from(merged.values());
}

function draftId(sessionId: number) {
  return `${DRAFT_STORAGE_PREFIX}${sessionId}`;
}

export function loadLocalPersonnelDraft(sessionId: number): PersonnelRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(draftId(sessionId)) ?? '[]');
    return Array.isArray(parsed) ? mergePersonnelRecords(parsed) : [];
  } catch {
    return [];
  }
}

export async function fetchPersonnelDraft(sessionId: number): Promise<PersonnelRecord[]> {
  if (!isSupabaseConfigured()) return loadLocalPersonnelDraft(sessionId);
  const { data, error } = await supabase
    .from(DRAFT_TABLE)
    .select('levels')
    .eq('id', draftId(sessionId))
    .maybeSingle();
  if (error) throw new Error('Не удалось загрузить выплаты персоналу.');
  const levels = data?.levels as { personnel?: unknown } | null;
  const records = Array.isArray(levels?.personnel) ? mergePersonnelRecords(levels.personnel as PersonnelRecord[]) : [];
  localStorage.setItem(draftId(sessionId), JSON.stringify(records));
  return records;
}

export async function savePersonnelDraft(sessionId: number, records: PersonnelRecord[]) {
  const personnel = mergePersonnelRecords(records);
  localStorage.setItem(draftId(sessionId), JSON.stringify(personnel));
  if (!isSupabaseConfigured()) return personnel;
  const { error } = await supabase.from(DRAFT_TABLE).upsert({
    id: draftId(sessionId),
    name: draftId(sessionId),
    levels: { personnel, updatedAt: new Date().toISOString() },
  });
  if (error) throw new Error('Не удалось синхронизировать выплаты персоналу.');
  return personnel;
}

export async function deletePersonnelDraft(sessionId: number) {
  localStorage.removeItem(draftId(sessionId));
  if (isSupabaseConfigured()) {
    await supabase.from(DRAFT_TABLE).delete().eq('id', draftId(sessionId));
  }
}

export function isPersonnelDraftRowId(value: unknown, sessionId: number) {
  return value === draftId(sessionId);
}
