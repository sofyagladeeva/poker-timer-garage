import { useMemo } from 'react';
import type { PersonnelRecord, PersonnelRole, StaffMember } from '../types';
import { personnelTotals } from '../personnel';

function makePersonnelId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function blankPersonnel(): PersonnelRecord {
  return { id: makePersonnelId(), name: '', role: 'dealer', roleLabel: 'Дилер', cashAmount: 0, cardAmount: 0 };
}

interface PersonnelFormProps {
  value: PersonnelRecord[];
  onChange: (value: PersonnelRecord[]) => void;
  staffMembers?: StaffMember[];
}

export function PersonnelForm({ value, onChange, staffMembers }: PersonnelFormProps) {
  const selectableStaff = useMemo(
    () => (staffMembers ?? []).filter(member => member.active),
    [staffMembers]
  );
  const update = (id: string, patch: Partial<PersonnelRecord>) => {
    onChange(value.map(p => p.id === id ? { ...p, ...patch } : p));
  };

  const remove = (id: string) => onChange(value.filter(p => p.id !== id));
  const add = () => onChange([...value, blankPersonnel()]);
  const addFromDirectory = (staffId: string) => {
    const member = staffMembers?.find(item => item.id === staffId && item.active);
    if (!member) return;
    const existing = value.find(record => record.staffMemberId === member.id);
    if (existing) {
      onChange(value.map(record => record.id === existing.id
        ? { ...record, cashAmount: record.cashAmount + member.baseRate }
        : record));
    } else {
      onChange([...value, {
        id: makePersonnelId(),
        staffMemberId: member.id,
        name: member.name,
        role: member.role,
        roleLabel: member.roleLabel,
        cashAmount: member.baseRate,
        cardAmount: 0,
      }]);
    }
  };

  const { cash: totalCash, card: totalCard, total: grandTotal } = personnelTotals(value);

  return (
    <div className="flex flex-col gap-3">
      {value.map(p => {
        const rowTotal = p.cashAmount + p.cardAmount;
        const directoryMember = p.staffMemberId
          ? staffMembers?.find(member => member.id === p.staffMemberId)
          : undefined;
        return (
          <div key={p.id} className="bg-[#0A0A0A] rounded-xl border border-[#2D2D2D] p-3 flex flex-col gap-3">
            <div className="flex gap-2 items-center">
              {p.staffMemberId ? (
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <div className="truncate text-sm font-bold text-white">{p.name}</div>
                    {directoryMember && (
                      <div className="shrink-0 rounded-full bg-[#1A1A1A] px-2 py-0.5 text-[10px] tabular-nums text-[#888]">
                        Ставка {directoryMember.baseRate.toLocaleString('ru-RU')} ₽
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-[#666]">{p.roleLabel}</div>
                </div>
              ) : (
                <input
                  type="text"
                  placeholder="Имя / подпись"
                  value={p.name}
                  onChange={e => update(p.id, { name: e.target.value })}
                  className="admin-input flex-1 min-w-0"
                />
              )}
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="personnel-remove-button grid h-10 w-10 place-items-center rounded-lg text-[#555] hover:bg-[#1A1A1A] hover:text-[#C0392B] transition-colors text-sm leading-none shrink-0"
              >
                ✕
              </button>
            </div>

            {!p.staffMemberId && <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={p.role}
                onChange={e => {
                  const role = e.target.value as PersonnelRole;
                  update(p.id, {
                    role,
                    roleLabel: role === 'custom' ? '' : (role === 'dealer' ? 'Дилер' : 'Админ'),
                  });
                }}
                className="admin-input flex-1 min-w-0"
              >
                <option value="dealer">Дилер</option>
                <option value="admin">Админ</option>
                <option value="custom">Другое</option>
              </select>

              {p.role === 'custom' && (
                <input
                  type="text"
                  placeholder="Должность"
                  value={p.roleLabel}
                  onChange={e => update(p.id, { roleLabel: e.target.value })}
                  className="admin-input flex-1 min-w-0"
                />
              )}
            </div>}

            <div className="personnel-money-grid grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div>
                <label className="text-[#555] text-[10px] uppercase tracking-widest block mb-1">Наличными ₽</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={p.cashAmount === 0 ? '' : p.cashAmount}
                  placeholder="0"
                  onChange={e => update(p.id, { cashAmount: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                  className="admin-input w-full"
                />
              </div>
              <div>
                <label className="text-[#555] text-[10px] uppercase tracking-widest block mb-1">Картой ₽</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={p.cardAmount === 0 ? '' : p.cardAmount}
                  placeholder="0"
                  onChange={e => update(p.id, { cardAmount: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                  className="admin-input w-full"
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[#555] text-[10px] uppercase tracking-widest block mb-1">Итого ₽</label>
                <div className="admin-input w-full text-white font-bold bg-[#111] flex items-center tabular-nums">
                  {rowTotal.toLocaleString('ru-RU')}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {staffMembers ? (
        <div className="flex flex-col gap-2 rounded-xl bg-[#0A0A0A] p-3">
          <select
            value=""
            onChange={event => addFromDirectory(event.target.value)}
            className="admin-input min-w-0 w-full"
          >
            <option value="">Выберите сотрудника</option>
            {selectableStaff.map(member => (
              <option key={member.id} value={member.id}>
                {member.name} · {member.roleLabel} · {member.baseRate.toLocaleString('ru-RU')} ₽
                {value.some(record => record.staffMemberId === member.id) ? ' · доплата' : ''}
              </option>
            ))}
          </select>
          <button type="button" onClick={add} className="min-h-10 text-left text-xs text-[#666] hover:text-white">
            + Внести вручную
          </button>
        </div>
      ) : (
        <button type="button" onClick={add} className="admin-btn-secondary py-2 text-sm">
          + Добавить сотрудника
        </button>
      )}

      {value.length > 0 && (
        <div className="personnel-summary-grid grid grid-cols-1 gap-2 rounded-xl border border-[#3D1A1A] bg-[#140909] p-3 sm:grid-cols-3">
          <div className="text-center">
            <div className="text-[#888] text-[10px] uppercase mb-1">Нал итого</div>
            <div className="text-white font-black text-sm tabular-nums">{totalCash.toLocaleString('ru-RU')} ₽</div>
          </div>
          <div className="text-center">
            <div className="text-[#888] text-[10px] uppercase mb-1">Карта итого</div>
            <div className="text-white font-black text-sm tabular-nums">{totalCard.toLocaleString('ru-RU')} ₽</div>
          </div>
          <div className="text-center">
            <div className="text-[#888] text-[10px] uppercase mb-1">Расходы</div>
            <div className="text-[#C0392B] font-black text-sm tabular-nums">{grandTotal.toLocaleString('ru-RU')} ₽</div>
          </div>
        </div>
      )}
    </div>
  );
}
