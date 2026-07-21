import type {
  LiveTournamentRegistrationSource,
  TournamentFinancePayload,
  TournamentResultsPayload,
} from './types.ts';

const ENV = (import.meta as ImportMeta & {
  env?: {
    VITE_BOT_API_URL?: string;
    VITE_BOT_TOURNAMENT_PLAYERS_URL_TEMPLATE?: string;
    VITE_BOT_TOURNAMENT_PLAYER_ADD_URL_TEMPLATE?: string;
    VITE_BOT_TOURNAMENT_PLAYER_REMOVE_URL_TEMPLATE?: string;
    VITE_BOT_TOURNAMENT_RESULTS_URL_TEMPLATE?: string;
    VITE_BOT_TOURNAMENT_FINANCE_URL_TEMPLATE?: string;
    VITE_BOT_PLAYER_NOTIFY_URL_TEMPLATE?: string;
    VITE_BOT_ADMIN_TOKEN?: string;
  };
}).env;

const BOT_API = ENV?.VITE_BOT_API_URL || 'https://web-production-6035.up.railway.app';
const ROSTER_URL_TEMPLATE = ENV?.VITE_BOT_TOURNAMENT_PLAYERS_URL_TEMPLATE || `${BOT_API}/api/games/{id}/players`;
const ADD_PLAYER_URL_TEMPLATE = ENV?.VITE_BOT_TOURNAMENT_PLAYER_ADD_URL_TEMPLATE || `${BOT_API}/api/admin/games/{id}/players`;
const REMOVE_PLAYER_URL_TEMPLATE = ENV?.VITE_BOT_TOURNAMENT_PLAYER_REMOVE_URL_TEMPLATE || `${BOT_API}/api/admin/games/{id}/players/remove`;
const RESULTS_URL_TEMPLATE = ENV?.VITE_BOT_TOURNAMENT_RESULTS_URL_TEMPLATE || `${BOT_API}/api/games/{id}/results`;
const FINANCE_URL_TEMPLATE = ENV?.VITE_BOT_TOURNAMENT_FINANCE_URL_TEMPLATE || `${BOT_API}/api/games/{id}/finance`;
const NOTIFY_PLAYER_URL_TEMPLATE = ENV?.VITE_BOT_PLAYER_NOTIFY_URL_TEMPLATE || `${BOT_API}/api/admin/players/{telegram_id}/notify`;
const BOT_ADMIN_TOKEN = ENV?.VITE_BOT_ADMIN_TOKEN || '';

export interface ImportedTournamentPlayer {
  botRegistrationId: string | null;
  telegramId: number | null;
  name: string;
  username: string | null;
  registrationSource: LiveTournamentRegistrationSource;
  registeredAt: string | null;
  sortOrder: number;
  realName: string | null;
  phone: string | null;
  instagram: string | null;
}

export interface BotPlayerListItem {
  telegramId: number;
  name: string;
  username: string | null;
  realName: string | null;
  phone: string | null;
  instagram: string | null;
  registeredAt: string | null;
  gamesCount: number | null;
}

const PLAYERS_LIST_URL = `${BOT_API}/api/admin/players`;

function normalizeBotPlayerListItem(raw: unknown, index: number): BotPlayerListItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;

  const telegramId = toNullableNumber(source.telegram_id);
  if (telegramId === null) return null;

  const directName = toNullableString(source.name) ||
    toNullableString(source.full_name) ||
    toNullableString(source.display_name);
  const firstName = toNullableString(source.first_name);
  const lastName = toNullableString(source.last_name);
  const compositeName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  const username = toNullableString(source.username);
  const name = directName || compositeName || (username ? `@${username}` : `Игрок ${index + 1}`);

  const rawRegisteredAt = toNullableString(source.registered_at) ?? toNullableString(source.registeredAt);
  const registeredAt = rawRegisteredAt && !rawRegisteredAt.includes('Z') && !rawRegisteredAt.includes('+')
    ? rawRegisteredAt + 'Z'
    : rawRegisteredAt;

  return {
    telegramId,
    name,
    username,
    realName: toNullableString(source.real_name) ?? toNullableString(source.realName),
    phone: toNullableString(source.phone),
    instagram: toNullableString(source.instagram),
    registeredAt,
    gamesCount: toNullableNumber(source.games_count) ?? toNullableNumber(source.gamesCount),
  };
}

export async function fetchBotPlayerList(params?: { limit?: number; offset?: number }) {
  const qs: string[] = [];
  if (params?.limit != null) qs.push(`limit=${encodeURIComponent(params.limit)}`);
  if (params?.offset != null) qs.push(`offset=${encodeURIComponent(params.offset)}`);
  const url = qs.length > 0 ? `${PLAYERS_LIST_URL}?${qs.join('&')}` : PLAYERS_LIST_URL;

  try {
    const response = await fetch(url, {
      headers: BOT_ADMIN_TOKEN ? { 'X-Admin-Token': BOT_ADMIN_TOKEN } : {},
    });

    if (!response.ok) {
      return {
        ok: false as const,
        error: `Бот не отдал список игроков (HTTP ${response.status}).`,
        unsupported: response.status === 404 || response.status === 405,
        players: [] as BotPlayerListItem[],
        total: 0,
      };
    }

    const raw = await response.json() as unknown;
    let rawItems: unknown[];
    let total = 0;

    if (Array.isArray(raw)) {
      rawItems = raw;
      total = raw.length;
    } else if (raw && typeof raw === 'object') {
      const source = raw as Record<string, unknown>;
      rawItems = Array.isArray(source.players) ? source.players as unknown[]
        : Array.isArray(source.data) ? source.data as unknown[]
        : Array.isArray(source.items) ? source.items as unknown[]
        : [];
      total = toNullableNumber(source.total) ?? rawItems.length;
    } else {
      rawItems = [];
    }

    const players = rawItems
      .map((item, i) => normalizeBotPlayerListItem(item, i))
      .filter((item): item is BotPlayerListItem => item !== null);

    return { ok: true as const, players, total };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : 'Не удалось загрузить список игроков из бота.',
      unsupported: false,
      players: [] as BotPlayerListItem[],
      total: 0,
    };
  }
}

type BotTournamentPlayerMutationPayload = {
  name: string;
  username?: string | null;
  telegramId?: number | null;
  registrationSource?: LiveTournamentRegistrationSource;
};

type BotTournamentPlayerRemovePayload = {
  playerId: string;
  botRegistrationId: string | null;
  telegramId: number | null;
  name: string;
  username: string | null;
};

function fillUrlTemplate(
  template: string,
  tournamentBotId: number | null,
  params: Record<string, string | number | null | undefined> = {}
) {
  if (!template.trim()) return null;
  let url = template;
  if (url.includes('{id}')) {
    if (tournamentBotId == null) return null;
    url = url.replaceAll('{id}', encodeURIComponent(String(tournamentBotId)));
  }

  for (const [key, value] of Object.entries(params)) {
    if (!url.includes(`{${key}}`)) continue;
    if (value == null || String(value).trim() === '') return null;
    url = url.replaceAll(`{${key}}`, encodeURIComponent(String(value)));
  }

  return url;
}

async function readBotErrorDetails(response: Response) {
  const raw = await response.text();
  if (!raw.trim()) return null;

  try {
    const body = JSON.parse(raw) as {
      detail?: Array<{ loc?: Array<string | number>; msg?: string }> | string;
      error?: string;
      message?: string;
    };

    if (typeof body.detail === 'string' && body.detail.trim()) return body.detail.trim();
    if (typeof body.error === 'string' && body.error.trim()) return body.error.trim();
    if (typeof body.message === 'string' && body.message.trim()) return body.message.trim();
    if (!Array.isArray(body.detail) || body.detail.length === 0) return raw.trim();

    return body.detail
      .map(item => {
        const path = Array.isArray(item.loc) ? item.loc.slice(1).join('.') : '';
        const message = typeof item.msg === 'string' ? item.msg : 'Ошибка валидации';
        return path ? `${path}: ${message}` : message;
      })
      .join('; ');
  } catch {
    return raw.trim() || null;
  }
}

function toNullableNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return null;
}

function toNullableString(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function buildPlayerName(source: Record<string, unknown>, fallbackIndex: number) {
  const direct =
    toNullableString(source.name) ||
    toNullableString(source.full_name) ||
    toNullableString(source.display_name);
  if (direct) return direct;

  const firstName = toNullableString(source.first_name);
  const lastName = toNullableString(source.last_name);
  const composite = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (composite) return composite;

  const username = toNullableString(source.username);
  if (username) return username.startsWith('@') ? username : `@${username}`;

  return `Игрок ${fallbackIndex + 1}`;
}

function inferRegistrationSource(source: Record<string, unknown>, fallback: LiveTournamentRegistrationSource): LiveTournamentRegistrationSource {
  const explicitStatus = [
    source.registration_source,
    source.registrationStatus,
    source.status,
    source.list,
    source.queue,
    source.type,
  ]
    .map(value => (typeof value === 'string' ? value.toLowerCase() : ''))
    .find(Boolean);

  if (explicitStatus && (
    explicitStatus.includes('wait') ||
    explicitStatus.includes('лист') ||
    explicitStatus.includes('reserve')
  )) {
    return 'waitlist';
  }

  if (
    source.waitlist === true ||
    source.is_waitlist === true ||
    source.in_waitlist === true
  ) {
    return 'waitlist';
  }

  return fallback;
}

function normalizeImportedPlayer(
  raw: unknown,
  sortOrder: number,
  fallback: LiveTournamentRegistrationSource
): ImportedTournamentPlayer | null {
  if (!raw || typeof raw !== 'object') return null;

  const source = raw as Record<string, unknown>;
  const nestedUser = source.user && typeof source.user === 'object'
    ? source.user as Record<string, unknown>
    : null;

  const telegramId = toNullableNumber(source.telegram_id) ?? toNullableNumber(nestedUser?.telegram_id);
  const botRegistrationId = (
    toNullableString(source.registration_id) ||
    toNullableString(source.registrationId) ||
    toNullableString(source.id) ||
    toNullableString(source.player_id) ||
    (telegramId !== null ? String(telegramId) : null)
  );
  const username = toNullableString(source.username) || toNullableString(nestedUser?.username);

  const rawRegisteredAt = toNullableString(source.registered_at) ?? toNullableString(source.registeredAt);
  // Bot sends UTC timestamps without 'Z'; append it so JS parses as UTC, not local time
  const registeredAt = rawRegisteredAt && !rawRegisteredAt.includes('Z') && !rawRegisteredAt.includes('+')
    ? rawRegisteredAt + 'Z'
    : rawRegisteredAt;

  return {
    botRegistrationId,
    telegramId,
    name: buildPlayerName({ ...nestedUser, ...source }, sortOrder),
    username,
    registrationSource: inferRegistrationSource(source, fallback),
    registeredAt,
    sortOrder,
    realName: toNullableString(source.real_name) ?? toNullableString(nestedUser?.real_name),
    phone: toNullableString(source.phone) ?? toNullableString(nestedUser?.phone),
    instagram: toNullableString(source.instagram) ?? toNullableString(nestedUser?.instagram),
  };
}

function normalizeImportedArray(
  raw: unknown,
  fallback: LiveTournamentRegistrationSource
): ImportedTournamentPlayer[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item, index) => normalizeImportedPlayer(item, index, fallback))
    .filter((item): item is ImportedTournamentPlayer => item !== null);
}

function dedupeImportedPlayers(players: ImportedTournamentPlayer[]) {
  const byKey = new Map<string, ImportedTournamentPlayer>();

  for (const player of players) {
    const key = player.botRegistrationId || (player.telegramId !== null ? `tg:${player.telegramId}` : `name:${player.name.toLowerCase()}`);
    if (!byKey.has(key)) {
      byKey.set(key, player);
    }
  }

  return Array.from(byKey.values());
}

function normalizeRosterResponse(raw: unknown) {
  if (Array.isArray(raw)) {
    return {
      players: dedupeImportedPlayers(normalizeImportedArray(raw, 'registered')),
      waitlist: [] as ImportedTournamentPlayer[],
    };
  }

  if (!raw || typeof raw !== 'object') {
    return {
      players: [] as ImportedTournamentPlayer[],
      waitlist: [] as ImportedTournamentPlayer[],
    };
  }

  const source = raw as Record<string, unknown>;
  const players = normalizeImportedArray(
    source.players ?? source.registrations ?? source.participants ?? source.confirmed,
    'registered'
  );
  const waitlist = normalizeImportedArray(
    source.waitlist ?? source.waiting_list ?? source.reserve ?? source.reserve_list,
    'waitlist'
  );

  if (players.length > 0 || waitlist.length > 0) {
    return {
      players: dedupeImportedPlayers(players),
      waitlist: dedupeImportedPlayers(waitlist),
    };
  }

  const fallbackList = normalizeImportedArray(source.items ?? source.data, 'registered');
  return {
    players: dedupeImportedPlayers(fallbackList.filter(player => player.registrationSource === 'registered')),
    waitlist: dedupeImportedPlayers(fallbackList.filter(player => player.registrationSource === 'waitlist')),
  };
}

async function readJsonBody(response: Response) {
  const raw = await response.text();
  if (!raw.trim()) return null;

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function fetchBotTournamentRoster(tournamentBotId: number) {
  const url = fillUrlTemplate(ROSTER_URL_TEMPLATE, tournamentBotId);
  if (!url) {
    return {
      ok: false as const,
      error: 'Не настроен URL для состава турнира.',
      unsupported: true,
    };
  }

  try {
    const response = await fetch(url, {
      headers: BOT_ADMIN_TOKEN ? { 'X-Admin-Token': BOT_ADMIN_TOKEN } : {},
    });
    if (!response.ok) {
      return {
        ok: false as const,
        error: `Бот не отдал состав игроков (HTTP ${response.status}).`,
        unsupported: response.status === 404,
      };
    }

    const raw = await response.json();
    const roster = normalizeRosterResponse(raw);
    return {
      ok: true as const,
      ...roster,
      url,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : 'Не удалось загрузить состав турнира.',
      unsupported: false,
    };
  }
}

export async function addBotTournamentPlayer(
  tournamentBotId: number | null,
  payload: BotTournamentPlayerMutationPayload
) {
  const url = fillUrlTemplate(ADD_PLAYER_URL_TEMPLATE, tournamentBotId);
  if (!url) {
    return {
      ok: false as const,
      error: 'Не настроен URL для ручной записи игрока в боте.',
      unsupported: true,
    };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(BOT_ADMIN_TOKEN ? { 'X-Admin-Token': BOT_ADMIN_TOKEN } : {}),
      },
      body: JSON.stringify({
        name: payload.name,
        username: payload.username ?? null,
        telegram_id: payload.telegramId ?? null,
        registration_source: payload.registrationSource ?? 'registered',
        source: 'admin',
      }),
    });

    if (!response.ok) {
      const details = await readBotErrorDetails(response);
      return {
        ok: false as const,
        error: details
          ? `Бот не записал игрока (HTTP ${response.status}): ${details}.`
          : `Бот не записал игрока (HTTP ${response.status}).`,
        unsupported: response.status === 404 || response.status === 405,
      };
    }

    const raw = await readJsonBody(response);
    const player = normalizeImportedPlayer(raw, 0, payload.registrationSource ?? 'registered');
    return {
      ok: true as const,
      player,
      url,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : 'Не удалось записать игрока в боте.',
      unsupported: false,
    };
  }
}

export async function removeBotTournamentPlayer(
  tournamentBotId: number | null,
  payload: BotTournamentPlayerRemovePayload
) {
  const url = fillUrlTemplate(REMOVE_PLAYER_URL_TEMPLATE, tournamentBotId, {
    registrationId: payload.botRegistrationId,
    playerId: payload.playerId,
    telegramId: payload.telegramId,
  });
  if (!url) {
    return {
      ok: false as const,
      error: 'Не настроен URL для удаления игрока в боте.',
      unsupported: true,
    };
  }

  const body = JSON.stringify({
    player_id: payload.playerId,
    registration_id: payload.botRegistrationId,
    telegram_id: payload.telegramId,
    name: payload.name,
    username: payload.username,
  });

  let lastError = 'Бот не удалил игрока.';
  let unsupported = false;

  for (const request of [{ url, method: 'POST' }]) {
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: {
          'Content-Type': 'application/json',
          ...(BOT_ADMIN_TOKEN ? { 'X-Admin-Token': BOT_ADMIN_TOKEN } : {}),
        },
        body,
      });

      if (response.ok) {
        return {
          ok: true as const,
          url: request.url,
        };
      }

      const details = await readBotErrorDetails(response);
      lastError = details
        ? `Бот не удалил игрока (HTTP ${response.status}): ${details}.`
        : `Бот не удалил игрока (HTTP ${response.status}).`;
      unsupported = response.status === 404 || response.status === 405;
      if (!unsupported) break;
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : 'Не удалось удалить игрока в боте.',
        unsupported: false,
      };
    }
  }

  return {
    ok: false as const,
    error: lastError,
    unsupported,
  };
}

export async function submitBotTournamentResults(payload: TournamentResultsPayload) {
  const url = fillUrlTemplate(RESULTS_URL_TEMPLATE, payload.tournamentBotId);
  if (!url) {
    return {
      ok: false as const,
      error: 'Не настроен URL для отправки итогов турнира.',
      unsupported: true,
    };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(BOT_ADMIN_TOKEN ? { 'X-Admin-Token': BOT_ADMIN_TOKEN } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const details = await readBotErrorDetails(response);
      return {
        ok: false as const,
        error: details
          ? `Бот не принял итоги турнира (HTTP ${response.status}): ${details}.`
          : `Бот не принял итоги турнира (HTTP ${response.status}).`,
        unsupported: response.status === 404,
      };
    }

    return { ok: true as const, url };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : 'Не удалось отправить итоги турнира.',
      unsupported: false,
    };
  }
}

export async function submitBotTournamentFinance(payload: TournamentFinancePayload) {
  const url = fillUrlTemplate(FINANCE_URL_TEMPLATE, payload.tournamentBotId);
  if (!url) {
    return {
      ok: true as const,
      skipped: true as const,
      unsupported: true as const,
      error: null,
    };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(BOT_ADMIN_TOKEN ? { 'X-Admin-Token': BOT_ADMIN_TOKEN } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 404) {
      return {
        ok: true as const,
        skipped: true as const,
        unsupported: true as const,
        error: null,
      };
    }

    if (!response.ok) {
      const details = await readBotErrorDetails(response);
      return {
        ok: false as const,
        skipped: false as const,
        unsupported: false as const,
        error: details
          ? `Бот не принял финансовый отчёт турнира (HTTP ${response.status}): ${details}.`
          : `Бот не принял финансовый отчёт турнира (HTTP ${response.status}).`,
      };
    }

    return {
      ok: true as const,
      skipped: false as const,
      unsupported: false as const,
      error: null,
      url,
    };
  } catch (error) {
    return {
      ok: false as const,
      skipped: false as const,
      unsupported: false as const,
      error: error instanceof Error ? error.message : 'Не удалось отправить финансовый отчёт турнира.',
    };
  }
}

export async function sendPlayerNotification(
  telegramId: number,
  message: string
): Promise<{ ok: boolean; skipped: boolean; error: string | null }> {
  const url = NOTIFY_PLAYER_URL_TEMPLATE.replace('{telegram_id}', String(telegramId));
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(BOT_ADMIN_TOKEN ? { 'X-Admin-Token': BOT_ADMIN_TOKEN } : {}),
      },
      body: JSON.stringify({ message }),
    });
    if (response.status === 404 || response.status === 405) {
      return { ok: true, skipped: true, error: null };
    }
    if (!response.ok) {
      return { ok: false, skipped: false, error: `Бот не принял уведомление (HTTP ${response.status}).` };
    }
    return { ok: true, skipped: false, error: null };
  } catch (error) {
    return { ok: false, skipped: false, error: error instanceof Error ? error.message : 'Не удалось отправить уведомление.' };
  }
}
