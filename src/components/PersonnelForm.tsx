import type { PersonnelRecord, PersonnelRole } from '../types';

function makePersonnelId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function blankPersonnel(): PersonnelRecord {
  return { id: makePersonnelId(), name: '', role: 'dealer', roleLabel: 'Дилер', cashAmount: 0, cardAmount: 0 };
}

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

interface PersonnelFormProps {
  value: PersonnelRecord[];
  onChange: (value: PersonnelRecord[]) => void;
}

export function PersonnelForm({ value, onChange }: PersonnelFormProps) {
  const update = (id: string, patch: Partial<PersonnelRecord>) => {
    onChange(value.map(p => p.id === id ? { ...p, ...patch } : p));
  };

  const remove = (id: string) => onChange(value.filter(p => p.id !== id));
  const add = () => onChange([...value, blankPersonnel()]);

  const { cash: totalCash, card: totalCard, total: grandTotal } = personnelTotals(value);

  return (
    <div className="flex flex-col gap-3">
      {value.map(p => {
        const rowTotal = p.cashAmount + p.cardAmount;
        return (
          <div key={p.id} className="bg-[#0A0A0A] rounded-xl border border-[#2D2D2D] p-3 flex flex-col gap-2">
            <div className="flex gap-2 items-center">
              <input
                type="text"
                placeholder="Имя / подпись"
                value={p.name}
                onChange={e => update(p.id, { name: e.target.value })}
                className="admin-input flex-1 min-w-0"
              />
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="text-[#555] hover:text-[#C0392B] transition-colors text-sm px-2 py-2 leading-none shrink-0"
              >
                ✕
              </button>
            </div>

            <div className="flex gap-2 flex-wrap">
              <select
                value={p.role}
                onChange={e => {
                  const role = e.target.value as PersonnelRole;
                  update(p.id, {
                    role,
                    roleLabel: role === 'custom' ? '' : (role === 'dealer' ? 'Дилер' : 'Админ'),
                  });
                }}
                className="admin-input flex-1 min-w-[120px]"
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
                  className="admin-input flex-1 min-w-[120px]"
                />
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
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
              <div>
                <label className="text-[#555] text-[10px] uppercase tracking-widest block mb-1">Итого ₽</label>
                <div className="admin-input w-full text-white font-bold bg-[#111] flex items-center">
                  {rowTotal.toLocaleString('ru-RU')}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <button type="button" onClick={add} className="admin-btn-secondary py-2 text-sm">
        + Добавить сотрудника
      </button>

      {value.length > 0 && (
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-[#3D1A1A] bg-[#140909] p-3">
          <div className="text-center">
            <div className="text-[#888] text-[10px] uppercase mb-1">Нал итого</div>
            <div className="text-white font-black text-sm">{totalCash.toLocaleString('ru-RU')} ₽</div>
          </div>
          <div className="text-center">
            <div className="text-[#888] text-[10px] uppercase mb-1">Карта итого</div>
            <div className="text-white font-black text-sm">{totalCard.toLocaleString('ru-RU')} ₽</div>
          </div>
          <div className="text-center">
            <div className="text-[#888] text-[10px] uppercase mb-1">Расходы</div>
            <div className="text-[#C0392B] font-black text-sm">{grandTotal.toLocaleString('ru-RU')} ₽</div>
          </div>
        </div>
      )}
    </div>
  );
}
