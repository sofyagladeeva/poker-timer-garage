import type { TournamentRecord, TournamentArchivePlayerRecord } from './types';

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

function playerKey(p: TournamentArchivePlayerRecord): string {
  if (p.telegramId != null) return `tg:${p.telegramId}`;
  if (p.username) return `un:${p.username.replace(/^@/, '').toLowerCase()}`;
  return `nm:${p.name.trim().toLowerCase()}`;
}

export function aggregatePlayerHistory(tournaments: TournamentRecord[]): PlayerAggregate[] {
  const map = new Map<string, PlayerAggregate>();

  const sorted = [...tournaments].sort(
    (a, b) => new Date(a.finished_at).getTime() - new Date(b.finished_at).getTime()
  );

  for (const t of sorted) {
    const details = t.archive_details;
    if (!details || !Array.isArray(details.players)) continue;

    for (const p of details.players as TournamentArchivePlayerRecord[]) {
      if (p.arrivalStatus === 'absent') continue;

      const key = playerKey(p);
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

      const existing = map.get(key);
      if (existing) {
        existing.tournaments.push(entry);
        // Always update identity from the latest tournament
        existing.currentName = p.name;
        existing.currentUsername = p.username;
        if (p.telegramId != null) existing.telegramId = p.telegramId;
      } else {
        map.set(key, {
          key,
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
        });
      }
    }
  }

  return Array.from(map.values())
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

export type PeriodFilter = '30' | '90' | '365' | 'all';

export function filterByPeriod(tournaments: PlayerTournamentEntry[], period: PeriodFilter): PlayerTournamentEntry[] {
  if (period === 'all') return tournaments;
  const cutoff = Date.now() - Number(period) * 24 * 60 * 60 * 1000;
  return tournaments.filter(e => new Date(e.finishedAt).getTime() >= cutoff);
}
