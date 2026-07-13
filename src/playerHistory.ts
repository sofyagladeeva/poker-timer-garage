import type { TournamentRecord, TournamentArchivePlayerRecord, TournamentArchiveDetails } from './types';
import type { BotPlayerListItem } from './tournamentBotApi.ts';

export interface PlayerTournamentEntry {
  tournamentId: number;
  title: string;
  finishedAt: string;
  place: number | null;
  rebuyCount: number;
  addonCount: number;
  bonusCount: number;
  bounty: number;
  cashPaid: number;
  cardPaid: number;
  paymentDue: number;
  arrivalStatus: TournamentArchivePlayerRecord['arrivalStatus'];
}

export interface PlayerAggregate {
  key: string;
  telegramId: number | null;
  currentName: string;
  currentUsername: string | null;
  tournaments: PlayerTournamentEntry[];
  tournamentCount: number;
  bestPlace: number | null;
  totalCash: number;
  totalCard: number;
  totalRebuys: number;
  totalAddons: number;
  totalBounty: number;
}

function normalizeUsername(username: string) {
  return username.replace(/^@/, '').trim().toLowerCase();
}

function normalizePlayerName(name: string) {
  return name.trim().toLowerCase();
}

function playerAliases(p: TournamentArchivePlayerRecord): string[] {
  const aliases: string[] = [];

  if (p.username) aliases.push(`un:${normalizeUsername(p.username)}`);
  if (p.telegramId != null) aliases.push(`tg:${p.telegramId}`);

  // Some older archive rows were saved before telegramId was available. For players
  // without username, the name is the only stable link between old and new rows.
  if (!p.username) aliases.push(`nm:${normalizePlayerName(p.name)}`);

  return aliases.length > 0 ? aliases : [`nm:${normalizePlayerName(p.name)}`];
}

export function aggregatePlayerHistory(
  tournaments: TournamentRecord[],
  archiveDetailsById: Record<number, TournamentArchiveDetails | null> = {}
): PlayerAggregate[] {
  const aggregates: PlayerAggregate[] = [];
  const aliasMap = new Map<string, PlayerAggregate>();

  const sorted = [...tournaments].sort(
    (a, b) => new Date(a.finished_at).getTime() - new Date(b.finished_at).getTime()
  );

  for (const t of sorted) {
    const details = archiveDetailsById[t.id] ?? t.archive_details;
    if (!details || !Array.isArray(details.players)) continue;

    for (const p of details.players as TournamentArchivePlayerRecord[]) {
      if (p.arrivalStatus === 'absent') continue;

      const aliases = playerAliases(p);
      const cashPaid = p.cashPaid ?? (p.paymentMethod === 'cash' ? p.paymentDue : 0);
      const cardPaid = p.cardPaid ?? (p.paymentMethod === 'card' ? p.paymentDue : 0);

      const entry: PlayerTournamentEntry = {
        tournamentId: t.id,
        title: t.title ?? 'Без названия',
        finishedAt: t.finished_at,
        place: p.place,
        rebuyCount: p.rebuyCount,
        addonCount: p.addonCount,
        bonusCount: p.bonusCount,
        bounty: p.bounty,
        cashPaid,
        cardPaid,
        paymentDue: p.paymentDue,
        arrivalStatus: p.arrivalStatus,
      };

      const existing = aliases.map(alias => aliasMap.get(alias)).find(Boolean);
      if (existing) {
        existing.tournaments.push(entry);
        // Always update identity from the latest tournament
        existing.currentName = p.name;
        existing.currentUsername = p.username;
        if (p.telegramId != null) existing.telegramId = p.telegramId;
        for (const alias of aliases) aliasMap.set(alias, existing);
      } else {
        const created: PlayerAggregate = {
          key: aliases[0],
          telegramId: p.telegramId ?? null,
          currentName: p.name,
          currentUsername: p.username,
          tournaments: [entry],
          tournamentCount: 0,
          bestPlace: null,
          totalCash: 0,
          totalCard: 0,
          totalRebuys: 0,
          totalAddons: 0,
          totalBounty: 0,
        };
        aggregates.push(created);
        for (const alias of aliases) aliasMap.set(alias, created);
      }
    }
  }

  return aggregates
    .map(agg => {
      const placed = agg.tournaments.map(e => e.place).filter((p): p is number => p !== null);
      return {
        ...agg,
        tournamentCount: agg.tournaments.length,
        bestPlace: placed.length > 0 ? Math.min(...placed) : null,
        totalCash: agg.tournaments.reduce((s, e) => s + e.cashPaid, 0),
        totalCard: agg.tournaments.reduce((s, e) => s + e.cardPaid, 0),
        totalRebuys: agg.tournaments.reduce((s, e) => s + e.rebuyCount, 0),
        totalAddons: agg.tournaments.reduce((s, e) => s + e.addonCount, 0),
        totalBounty: agg.tournaments.reduce((s, e) => s + e.bounty, 0),
      };
    })
    .sort((a, b) => b.tournamentCount - a.tournamentCount || a.currentName.localeCompare(b.currentName, 'ru'));
}

export type PeriodFilter = '7' | '30' | '90' | '365' | 'all';

export function filterByPeriod(tournaments: PlayerTournamentEntry[], period: PeriodFilter): PlayerTournamentEntry[] {
  if (period === 'all') return tournaments;
  const cutoff = Date.now() - Number(period) * 24 * 60 * 60 * 1000;
  return tournaments.filter(e => new Date(e.finishedAt).getTime() >= cutoff);
}

export interface MergedPlayerAggregate extends PlayerAggregate {
  botVerified: boolean;
  botOnly: boolean;
  botRegisteredAt: string | null;
}

export function mergeWithBotPlayerList(
  aggregates: PlayerAggregate[],
  botPlayers: BotPlayerListItem[]
): MergedPlayerAggregate[] {
  const byTelegramId = new Map<number, MergedPlayerAggregate>();

  const merged: MergedPlayerAggregate[] = aggregates.map(agg => {
    const m: MergedPlayerAggregate = { ...agg, botVerified: false, botOnly: false, botRegisteredAt: null };
    if (agg.telegramId !== null) byTelegramId.set(agg.telegramId, m);
    return m;
  });

  for (const botPlayer of botPlayers) {
    const existing = byTelegramId.get(botPlayer.telegramId);
    if (existing) {
      existing.currentName = botPlayer.name;
      existing.currentUsername = botPlayer.username;
      existing.botVerified = true;
      existing.botRegisteredAt = botPlayer.registeredAt;
    } else {
      const newAgg: MergedPlayerAggregate = {
        key: `tg:${botPlayer.telegramId}`,
        telegramId: botPlayer.telegramId,
        currentName: botPlayer.name,
        currentUsername: botPlayer.username,
        tournaments: [],
        tournamentCount: 0,
        bestPlace: null,
        totalCash: 0,
        totalCard: 0,
        totalRebuys: 0,
        totalAddons: 0,
        totalBounty: 0,
        botVerified: true,
        botOnly: true,
        botRegisteredAt: botPlayer.registeredAt,
      };
      merged.push(newAgg);
      byTelegramId.set(botPlayer.telegramId, newAgg);
    }
  }

  return merged;
}
