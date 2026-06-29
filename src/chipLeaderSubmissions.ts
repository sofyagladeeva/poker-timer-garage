import { supabase } from './supabase.ts';
import type {
  ChipLeaderEntry,
  ChipLeaderSubmission,
  ChipLeaderSubmissionEntry,
  LiveTournamentPlayer,
} from './types';

const TABLE = 'chip_leader_submissions';

type SubmissionRow = {
  session_id: number;
  level_index: number;
  table_number: number;
  entries: unknown;
  submitted_at: string;
};

function clampWhole(value: number) {
  return Math.max(0, Math.round(value));
}

function normalizeSubmissionEntry(raw: unknown): ChipLeaderSubmissionEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const playerId = typeof source.playerId === 'string' ? source.playerId : '';
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  const stack = typeof source.stack === 'number' && Number.isFinite(source.stack)
    ? clampWhole(source.stack)
    : 0;
  const tableNumber = typeof source.tableNumber === 'number' && Number.isFinite(source.tableNumber)
    ? Math.max(1, Math.round(source.tableNumber))
    : 0;
  const seatNumber = typeof source.seatNumber === 'number' && Number.isFinite(source.seatNumber)
    ? Math.max(1, Math.round(source.seatNumber))
    : null;

  if (!playerId || !name || stack <= 0 || tableNumber <= 0) return null;
  return { playerId, name, stack, tableNumber, seatNumber };
}

function toSubmission(row: SubmissionRow): ChipLeaderSubmission {
  const entries = Array.isArray(row.entries)
    ? row.entries.map(normalizeSubmissionEntry).filter((entry): entry is ChipLeaderSubmissionEntry => entry !== null)
    : [];

  return {
    sessionId: Math.max(1, Math.round(row.session_id || 0)),
    levelIndex: Math.max(0, Math.round(row.level_index || 0)),
    tableNumber: Math.max(1, Math.round(row.table_number || 0)),
    entries,
    submittedAt: row.submitted_at,
  };
}

export function getActiveChipLeaderTables(players: LiveTournamentPlayer[]) {
  return Array.from(new Set(
    players
      .filter(player => (
        player.arrivalStatus !== 'absent' &&
        player.status !== 'out' &&
        typeof player.tableNumber === 'number' &&
        player.tableNumber > 0
      ))
      .map(player => Math.round(player.tableNumber as number))
  )).sort((a, b) => a - b);
}

export function getRequiredStackCountForTable(tablePlayers: LiveTournamentPlayer[]) {
  const activeCount = tablePlayers.filter(player => player.arrivalStatus !== 'absent' && player.status !== 'out').length;
  return Math.min(3, activeCount);
}

export function haveAllActiveTablesSubmitted(activeTables: number[], submissions: ChipLeaderSubmission[]) {
  if (activeTables.length === 0) return false;
  const submittedTables = new Set(submissions.filter(submission => submission.entries.length > 0).map(submission => submission.tableNumber));
  return activeTables.every(tableNumber => submittedTables.has(tableNumber));
}

export function buildTopChipLeaders(submissions: ChipLeaderSubmission[]): ChipLeaderEntry[] {
  return submissions
    .flatMap(submission => submission.entries)
    .filter(entry => entry.stack > 0)
    .sort((a, b) => {
      if (b.stack !== a.stack) return b.stack - a.stack;
      if (a.tableNumber !== b.tableNumber) return a.tableNumber - b.tableNumber;
      return (a.seatNumber ?? 999) - (b.seatNumber ?? 999);
    })
    .slice(0, 3)
    .map((entry, index) => ({
      id: `chip-${index + 1}-${entry.playerId}`,
      playerId: entry.playerId,
      name: entry.name,
      stack: entry.stack,
      tableNumber: entry.tableNumber,
      seatNumber: entry.seatNumber,
    }));
}

export function getChipLeaderHideAfterLevelIndex(status: string, currentLevelIndex: number) {
  return status === 'break' ? currentLevelIndex + 1 : currentLevelIndex;
}

export async function fetchChipLeaderSubmissions(sessionId: number, levelIndex: number) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('session_id, level_index, table_number, entries, submitted_at')
    .eq('session_id', sessionId)
    .eq('level_index', levelIndex);

  if (error) return { submissions: [] as ChipLeaderSubmission[], error };
  return {
    submissions: ((data ?? []) as SubmissionRow[]).map(toSubmission),
    error: null,
  };
}

export async function upsertChipLeaderSubmission(input: {
  sessionId: number;
  levelIndex: number;
  tableNumber: number;
  entries: ChipLeaderSubmissionEntry[];
}) {
  const submittedAt = new Date().toISOString();
  const { error } = await supabase.from(TABLE).upsert({
    session_id: input.sessionId,
    level_index: input.levelIndex,
    table_number: input.tableNumber,
    entries: input.entries.map(entry => ({
      ...entry,
      seatNumber: entry.seatNumber ?? null,
    })),
    submitted_at: submittedAt,
  }, {
    onConflict: 'session_id,level_index,table_number',
  });

  return { ok: !error, error, submittedAt };
}

export async function deleteChipLeaderSubmissions(sessionId: number, levelIndex: number) {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('session_id', sessionId)
    .eq('level_index', levelIndex);

  return { ok: !error, error };
}
