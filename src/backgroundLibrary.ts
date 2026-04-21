import { supabase } from './supabase';

export interface StoredBackground {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  createdAt: string;
}

interface BackgroundLibraryRow {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  created_at: string;
}

const STORAGE_KEY = 'poker_timer_background_library_v1';
const MAX_WIDTH = 1600;
const MAX_HEIGHT = 900;
const OUTPUT_QUALITY = 0.84;
const PRESET_WIDTH = 1600;
const PRESET_HEIGHT = 900;
const SHARED_TABLE = 'background_library';

function isStoredBackground(value: unknown): value is StoredBackground {
  if (!value || typeof value !== 'object') return false;

  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.url === 'string' &&
    typeof item.width === 'number' &&
    typeof item.height === 'number' &&
    typeof item.createdAt === 'string'
  );
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeName(fileName: string) {
  const cleaned = fileName.replace(/\.[^.]+$/, '').trim();
  return cleaned || 'Новый фон';
}

function svgToDataUrl(svg: string) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function createPresetBackground(id: string, name: string, svg: string): StoredBackground {
  return {
    id: `preset_${id}`,
    name,
    url: svgToDataUrl(svg),
    width: PRESET_WIDTH,
    height: PRESET_HEIGHT,
    createdAt: 'preset',
  };
}

function buildPresetSvg(base: string, accent: string, highlight: string, grid: string) {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PRESET_WIDTH} ${PRESET_HEIGHT}">
      <defs>
        <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${base}" />
          <stop offset="55%" stop-color="${accent}" />
          <stop offset="100%" stop-color="#050505" />
        </linearGradient>
        <radialGradient id="glowTop" cx="25%" cy="18%" r="60%">
          <stop offset="0%" stop-color="${highlight}" stop-opacity="0.9" />
          <stop offset="100%" stop-color="${highlight}" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="glowBottom" cx="82%" cy="88%" r="58%">
          <stop offset="0%" stop-color="${grid}" stop-opacity="0.28" />
          <stop offset="100%" stop-color="${grid}" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="${PRESET_WIDTH}" height="${PRESET_HEIGHT}" fill="url(#base)" />
      <rect width="${PRESET_WIDTH}" height="${PRESET_HEIGHT}" fill="url(#glowTop)" />
      <rect width="${PRESET_WIDTH}" height="${PRESET_HEIGHT}" fill="url(#glowBottom)" />
      <path d="M-120 760 C240 520 560 500 900 640 S1450 860 1720 580" fill="none" stroke="${grid}" stroke-opacity="0.2" stroke-width="130" stroke-linecap="round" />
      <path d="M220 60 H1380" stroke="${highlight}" stroke-opacity="0.22" stroke-width="3" />
      <path d="M220 840 H1380" stroke="${highlight}" stroke-opacity="0.16" stroke-width="3" />
      <circle cx="1290" cy="170" r="180" fill="${highlight}" fill-opacity="0.16" />
      <circle cx="360" cy="740" r="260" fill="${grid}" fill-opacity="0.08" />
    </svg>
  `.trim();
}

export const PRESET_BACKGROUNDS: StoredBackground[] = [
  createPresetBackground(
    'red_stage',
    'Красный неон',
    buildPresetSvg('#220707', '#5A0E0E', '#F05B5B', '#B31B1B')
  ),
];

function isSupabaseConfigured() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

function toTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortBackgrounds(items: StoredBackground[]) {
  return [...items].sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));
}

function toRow(item: StoredBackground): BackgroundLibraryRow {
  return {
    id: item.id,
    name: item.name,
    url: item.url,
    width: item.width,
    height: item.height,
    created_at: item.createdAt,
  };
}

function toStoredBackground(row: BackgroundLibraryRow): StoredBackground {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
  };
}

function formatSharedLibraryError(action: string, error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  if (code === '42P01') {
    return `В Supabase еще нет таблицы ${SHARED_TABLE}. Выполните SQL из supabase/background_library.sql, затем повторите ${action}.`;
  }

  if (code === '42501') {
    return `Supabase не разрешает ${action} фоны. Проверьте policies для таблицы ${SHARED_TABLE}.`;
  }

  return `Не удалось ${action} фоны в общей библиотеке.`;
}

export function isSharedBackgroundLibraryEnabled() {
  return isSupabaseConfigured();
}

export function mergeBackgroundLibraries(...collections: StoredBackground[][]) {
  const unique = new Map<string, StoredBackground>();

  collections.flat().forEach(item => {
    const key = item.url || item.id;
    if (!unique.has(key)) unique.set(key, item);
  });

  return sortBackgrounds(Array.from(unique.values()));
}

function fitToBounds(width: number, height: number) {
  const scale = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height, 1);

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToDataUrl(canvas: HTMLCanvasElement) {
  const webp = canvas.toDataURL('image/webp', OUTPUT_QUALITY);
  if (webp.startsWith('data:image/webp')) return webp;
  return canvas.toDataURL('image/jpeg', OUTPUT_QUALITY);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Не удалось прочитать файл ${file.name}`));
    };

    image.src = objectUrl;
  });
}

export function loadBackgroundLibrary(): StoredBackground[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isStoredBackground);
  } catch {
    return [];
  }
}

export function saveBackgroundLibrary(items: StoredBackground[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sortBackgrounds(items)));
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      error: 'Не удалось сохранить фоны в браузере. Скорее всего, закончилось место в localStorage.',
    };
  }
}

export async function fetchSharedBackgroundLibrary() {
  if (!isSupabaseConfigured()) {
    return loadBackgroundLibrary();
  }

  const { data, error } = await supabase
    .from(SHARED_TABLE)
    .select('id, name, url, width, height, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(formatSharedLibraryError('загрузить', error));
  }

  return sortBackgrounds((data ?? []).map(row => toStoredBackground(row as BackgroundLibraryRow)));
}

export async function upsertSharedBackgrounds(items: StoredBackground[]) {
  if (items.length === 0) return { ok: true as const };

  const localResult = saveBackgroundLibrary(mergeBackgroundLibraries(items, loadBackgroundLibrary()));
  if (!isSupabaseConfigured()) return localResult;

  const { error } = await supabase.from(SHARED_TABLE).upsert(items.map(toRow));
  if (error) {
    return {
      ok: false as const,
      error: formatSharedLibraryError('сохранить', error),
    };
  }

  return { ok: true as const };
}

export async function deleteSharedBackgrounds(ids: string[]) {
  if (ids.length === 0) return { ok: true as const };

  if (!isSupabaseConfigured()) {
    const current = loadBackgroundLibrary();
    return saveBackgroundLibrary(current.filter(item => !ids.includes(item.id)));
  }

  const { error } = await supabase.from(SHARED_TABLE).delete().in('id', ids);
  if (error) {
    return {
      ok: false as const,
      error: formatSharedLibraryError('удалить', error),
    };
  }

  return { ok: true as const };
}

export async function createBackgroundFromFile(file: File): Promise<StoredBackground> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`Файл ${file.name} не похож на изображение`);
  }

  const image = await loadImage(file);
  const { width, height } = fitToBounds(image.naturalWidth || image.width, image.naturalHeight || image.height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Браузер не дал подготовить изображение');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);

  return {
    id: createId(),
    name: normalizeName(file.name),
    url: canvasToDataUrl(canvas),
    width,
    height,
    createdAt: new Date().toISOString(),
  };
}
