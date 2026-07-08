import type { PersonnelRecord } from './types';

export function formatPersonnelRole(p: Pick<PersonnelRecord, 'role' | 'roleLabel'>): string {
  if (p.role === 'dealer') return 'Дилер';
  if (p.role === 'admin') return 'Админ';
  return p.roleLabel || 'Другое';
}

export function personnelTotals(personnel: PersonnelRecord[]) {
  const cash = personnel.reduce((s, p) => s + p.cashAmount, 0);
  const card = personnel.reduce((s, p) => s + p.cardAmount, 0);
  return { cash, card, total: cash + card };
}
