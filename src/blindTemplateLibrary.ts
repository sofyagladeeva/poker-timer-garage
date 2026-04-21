import { createGarageBlindTemplate } from './blindStructure';
import { supabase } from './supabase';
import type { BlindLevel, BlindTemplate } from './types';

interface BlindTemplateRow {
  id: string;
  name: string;
  levels: unknown;
  created_at: string;
}

const STORAGE_KEY = 'poker_timer_blind_templates_v1';
const SHARED_TABLE = 'blind_templates';

function isBlindLevel(value: unknown): value is BlindLevel {
  if (!value || typeof value !== 'object') return false;

  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.level === 'number' &&
    typeof item.sb === 'number' &&
    typeof item.bb === 'number' &&
    typeof item.ante === 'number' &&
    typeof item.duration === 'number' &&
    typeof item.isBreak === 'boolean'
  );
}

function isBlindTemplate(value: unknown): value is BlindTemplate {
  if (!value || typeof value !== 'object') return false;

  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    Array.isArray(item.levels) &&
    item.levels.every(isBlindLevel) &&
    typeof item.createdAt === 'string'
  );
}

function isSupabaseConfigured() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function toTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortTemplates(items: BlindTemplate[]) {
  return [...items].sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));
}

function cloneLevels(levels: BlindLevel[]) {
  return levels.map(level => ({ ...level }));
}

function normalizeTemplateName(name: string) {
  return name.trim();
}

function toRow(template: BlindTemplate): BlindTemplateRow {
  return {
    id: template.id,
    name: template.name,
    levels: cloneLevels(template.levels),
    created_at: template.createdAt,
  };
}

function toTemplate(row: BlindTemplateRow): BlindTemplate | null {
  if (!Array.isArray(row.levels) || !row.levels.every(isBlindLevel)) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    levels: cloneLevels(row.levels),
    createdAt: row.created_at,
  };
}

function formatSharedTemplateError(action: string, error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  if (code === '42P01') {
    return `В Supabase еще нет таблицы ${SHARED_TABLE}. Выполните SQL из supabase/blind_templates.sql, затем повторите ${action}.`;
  }

  if (code === '42501') {
    return `Supabase не разрешает ${action} шаблоны блайндов. Проверьте policies для таблицы ${SHARED_TABLE}.`;
  }

  return `Не удалось ${action} шаблоны блайндов.`;
}

export const PRESET_BLIND_TEMPLATES: BlindTemplate[] = [
  {
    id: 'preset_garage_base',
    name: 'Garage Base',
    levels: createGarageBlindTemplate(),
    createdAt: 'preset',
  },
];

export function isSharedBlindTemplateLibraryEnabled() {
  return isSupabaseConfigured();
}

export function loadBlindTemplates(): BlindTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return sortTemplates(parsed.filter(isBlindTemplate));
  } catch {
    return [];
  }
}

export function saveBlindTemplates(items: BlindTemplate[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sortTemplates(items)));
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      error: 'Не удалось сохранить шаблоны блайндов в браузере.',
    };
  }
}

export function mergeBlindTemplates(...collections: BlindTemplate[][]) {
  const unique = new Map<string, BlindTemplate>();

  collections.flat().forEach(template => {
    if (!unique.has(template.id)) unique.set(template.id, template);
  });

  return sortTemplates(Array.from(unique.values()));
}

export function buildBlindTemplate(name: string, levels: BlindLevel[], existingId?: string): BlindTemplate {
  return {
    id: existingId || createId(),
    name: normalizeTemplateName(name),
    levels: cloneLevels(levels),
    createdAt: new Date().toISOString(),
  };
}

export async function fetchSharedBlindTemplates() {
  if (!isSupabaseConfigured()) {
    return loadBlindTemplates();
  }

  const { data, error } = await supabase
    .from(SHARED_TABLE)
    .select('id, name, levels, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(formatSharedTemplateError('загрузить', error));
  }

  return sortTemplates(
    (data ?? [])
      .map(row => toTemplate(row as BlindTemplateRow))
      .filter((template): template is BlindTemplate => Boolean(template))
  );
}

export async function upsertSharedBlindTemplate(template: BlindTemplate) {
  const localResult = saveBlindTemplates(mergeBlindTemplates(loadBlindTemplates(), [template]));
  if (!localResult.ok || !isSupabaseConfigured()) return localResult;

  const { error } = await supabase.from(SHARED_TABLE).upsert(toRow(template));
  if (error) {
    return {
      ok: false as const,
      error: formatSharedTemplateError('сохранить', error),
    };
  }

  return { ok: true as const };
}

export async function deleteSharedBlindTemplates(ids: string[]) {
  if (ids.length === 0) return { ok: true as const };

  if (!isSupabaseConfigured()) {
    const current = loadBlindTemplates();
    return saveBlindTemplates(current.filter(item => !ids.includes(item.id)));
  }

  const { error } = await supabase.from(SHARED_TABLE).delete().in('id', ids);
  if (error) {
    return {
      ok: false as const,
      error: formatSharedTemplateError('удалить', error),
    };
  }

  return { ok: true as const };
}
