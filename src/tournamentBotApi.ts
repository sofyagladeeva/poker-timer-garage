import type {
  LiveTournamentRegistrationSource,
  TournamentFinancePayload,
  TournamentResultsPayload,
} from './types.ts';

const ENV = (import.meta as ImportMeta & {
  env?: {
    VITE_BOT_API_URL?: string;
    VITE_BOT_TOURNAMENT_PLAYERS_URL_TEMPLATE?: string;
    VITE_BOT_TOURNAMENT_RESULTS_URL_TEMPLATE?: string;
    VITE_BOT_TOURNAMENT_FINANCE_URL_TEMPLATE?: string;
    VITE_BOT_ADMIN_TOKEN?: string;
  };
}).env;

const BOT_API = ENV?.VITE_BOT_API_URL || 'https://web-production-6035.up.railway.app';
const ROSTER_URL_TEMPLATE = ENV?.VITE_BOT_TOURNAMENT_PLAYERS_URL_TEMPLATE || `${BOT_API}/api/games/{id}/players`;
const RESULTS_URL_TEMPLATE = ENV?.VITE_BOT_TOURNAMENT_RESULTS_URL_TEMPLATE || `${BOT_API}/api/games/{id}/results`;
const FINANCE_URL_TEMPLATE = ENV?.VITE_BOT_TOURNAMENT_FINANCE_URL_TEMPLATE || `${BOT_API}/api/games/{id}/finance`;
const BOT_ADMIN_TOKEN = ENV?.VITE_BOT_ADMIN_TOKEN || '';

export interface ImportedTournamentPlayer {
  botRegistrationId: string | null;
  telegramId: number | null;
  name: string;
  username: string | null;
  registrationSource: LiveTournamentRegistrationSource;
  sortOrder: number;
}

function fillUrlTemplate(template: string, tournamentBotId: number | null) {
  if (!template.trim()) return null;
  if (!template.includes('{id}')) return template;
  if (tournamentBotId == null) return null;
  return template.replaceAll('{id}', String(tournamentBotId));
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

  return {
    botRegistrationId,
    telegramId,
    name: buildPlayerName({ ...nestedUser, ...source }, sortOrder),
    username,
    registrationSource: inferRegistrationSource(source, fallback),
    sortOrder,
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
