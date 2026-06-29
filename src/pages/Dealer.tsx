import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useDealerTable } from '../hooks/useDealerTable.ts';
import type { LiveTournamentPlayer } from '../types.ts';

// Сетка 3×4: дилер внизу по центру, бокс 1 — слева от дилера, по часовой стрелке
const SEAT_GRID: Record<number, { col: number; row: number }> = {
  1: { col: 1, row: 4 },
  2: { col: 1, row: 3 },
  3: { col: 1, row: 2 },
  4: { col: 1, row: 1 },
  5: { col: 2, row: 1 },
  6: { col: 3, row: 1 },
  7: { col: 3, row: 2 },
  8: { col: 3, row: 3 },
  9: { col: 3, row: 4 },
};

export function Dealer() {
  const { tableNumber: tableParam } = useParams<{ tableNumber: string }>();
  const tableNumber = Math.max(1, parseInt(tableParam ?? '1', 10) || 1);
  const {
    seats,
    tablePlayers,
    loading,
    addonOpen,
    canCollectChipLeaders,
    chipLeaderState,
    submitChipLeaderStacks,
    doRebuy,
    doBustOut,
    callFloor,
    doUpdateRealName,
    doAddon,
  } = useDealerTable(tableNumber);

  const [rebuyDialog, setRebuyDialog] = useState<LiveTournamentPlayer | null>(null);
  const [bustDialog, setBustDialog] = useState<LiveTournamentPlayer | null>(null);
  const [addonDialog, setAddonDialog] = useState<LiveTournamentPlayer | null>(null);
  const [chipLeaderDialogOpen, setChipLeaderDialogOpen] = useState(false);
  const [chipLeaderDraft, setChipLeaderDraft] = useState<Record<string, string>>({});
  const [floorBusy, setFloorBusy] = useState(false);
  const [floorCalled, setFloorCalled] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [bustBountyDraft, setBustBountyDraft] = useState('0');
  const requiredChipLeaderStacks = Math.min(3, tablePlayers.length);
  const filledChipLeaderStacks = tablePlayers.filter(player => (
    Math.max(0, parseInt(chipLeaderDraft[player.id] ?? '0', 10) || 0) > 0
  )).length;
  const canSubmitChipLeaders = requiredChipLeaderStacks > 0 && filledChipLeaderStacks >= requiredChipLeaderStacks;

  const openChipLeaderDialog = () => {
    setChipLeaderDraft(current => {
      const next: Record<string, string> = {};
      tablePlayers.forEach(player => {
        next[player.id] = current[player.id] ?? (
          chipLeaderState.savedStacks[player.id] ? String(chipLeaderState.savedStacks[player.id]) : ''
        );
      });
      return next;
    });
    setChipLeaderDialogOpen(true);
  };

  const handleRebuyConfirm = async () => {
    if (!rebuyDialog) return;
    setActionBusy(true);
    try {
      await doRebuy(rebuyDialog.id);
      setRebuyDialog(null);
    } finally {
      setActionBusy(false);
    }
  };

  const handleBustConfirm = async () => {
    if (!bustDialog) return;
    setActionBusy(true);
    try {
      await doBustOut(bustDialog.id, Math.max(0, parseInt(bustBountyDraft, 10) || 0));
      setBustDialog(null);
      setBustBountyDraft('0');
    } finally {
      setActionBusy(false);
    }
  };

  const handleAddonConfirm = async (count: 1 | 2) => {
    if (!addonDialog) return;
    setActionBusy(true);
    try {
      await doAddon(addonDialog.id, count);
      setAddonDialog(null);
    } finally {
      setActionBusy(false);
    }
  };

  const handleCallFloor = async () => {
    setFloorBusy(true);
    try {
      await callFloor();
      setFloorCalled(true);
      setTimeout(() => setFloorCalled(false), 4000);
    } finally {
      setFloorBusy(false);
    }
  };

  const handleChipLeaderSubmit = async () => {
    const stacks = tablePlayers.reduce<Record<string, number>>((acc, player) => {
      acc[player.id] = Math.max(0, parseInt(chipLeaderDraft[player.id] ?? '0', 10) || 0);
      return acc;
    }, {});

    const ok = await submitChipLeaderStacks(stacks);
    if (ok) {
      setChipLeaderDialogOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <div className="text-[#555] text-sm uppercase tracking-widest">Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="bg-[#0A0A0A] overflow-hidden" style={{ height: '100dvh' }}>
      <div
        className="p-1.5 grid gap-1 h-full overflow-hidden"
        style={{
          gridTemplateColumns: 'repeat(3, 1fr)',
          gridTemplateRows: 'repeat(4, 1fr)',
        }}
      >
        {/* Центральная панель — стол + кнопка флора (строки 2–3) */}
        <div
          className="min-h-0 overflow-hidden flex flex-col items-center justify-center gap-1.5 px-1"
          style={{ gridColumn: 2, gridRow: '2 / 4' }}
        >
          <div className="text-white font-bold text-sm landscape:text-xs whitespace-nowrap">Стол {tableNumber}</div>
          <button
            type="button"
            onClick={() => void handleCallFloor()}
            disabled={floorBusy}
            className={`px-3 py-2.5 landscape:py-1.5 rounded-2xl border font-bold text-xs text-center leading-snug transition-all ${
              floorCalled
                ? 'border-amber-500 bg-amber-950/60 text-amber-300'
                : 'border-[#C0392B] bg-[#2A0C0A] text-white active:scale-95'
            }`}
          >
            {floorCalled ? '✓ Флор\nвызван' : 'Позвать\nфлора'}
          </button>
          {canCollectChipLeaders && (
            <>
              <button
                type="button"
                onClick={openChipLeaderDialog}
                disabled={tablePlayers.length === 0}
                className="w-[150px] px-3 py-2.5 landscape:w-[132px] landscape:py-1.5 rounded-full border border-yellow-700/70 bg-[#1A1500] text-yellow-300 font-bold text-xs text-center leading-tight active:scale-95 transition-transform disabled:opacity-40"
              >
                Чип-лидеры
              </button>
              {chipLeaderState.submittedAt && (
                <div className="text-[10px] text-emerald-400 font-bold text-center leading-tight">
                  стек сохранён
                </div>
              )}
            </>
          )}
        </div>

        {/* Метка дилера — нижний центр */}
        <div
          className="min-h-0 overflow-hidden flex items-center justify-center"
          style={{ gridColumn: 2, gridRow: 4 }}
        >
          <div className="px-3 py-1.5 rounded-full bg-[#1A1500] border border-yellow-800/50 text-yellow-600/80 text-xs font-black tracking-widest uppercase select-none">
            dealer
          </div>
        </div>

        {seats.map(({ seatNumber, player }) => {
          const grid = SEAT_GRID[seatNumber];
          return (
            <div key={seatNumber} className="min-h-0 h-full overflow-hidden" style={{ gridColumn: grid.col, gridRow: grid.row }}>
              <SeatCard
                seatNumber={seatNumber}
                player={player}
                addonOpen={addonOpen}
                onRebuy={() => setRebuyDialog(player)}
                onBustOut={() => setBustDialog(player)}
                onAddon={() => setAddonDialog(player)}
                onUpdateRealName={(name) => void doUpdateRealName(player!.id, name)}
              />
            </div>
          );
        })}
      </div>

      {rebuyDialog && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/80 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-3xl border border-[#2D2D2D] bg-[#111] shadow-2xl">
            <div className="border-b border-[#2D2D2D] px-5 py-4">
              <div className="text-white font-black text-lg">Ребай</div>
              <div className="text-[#777] text-sm mt-0.5 break-words">{rebuyDialog.name}</div>
            </div>
            <div className="px-5 py-4 text-[#AAA] text-sm">
              Добавить ребай игроку <span className="text-white font-bold">{rebuyDialog.name}</span>?
            </div>
            <div className="border-t border-[#2D2D2D] px-5 py-4 flex gap-2">
              <button type="button" onClick={() => setRebuyDialog(null)} disabled={actionBusy}
                className="flex-1 admin-btn-secondary py-3 text-sm">Отмена</button>
              <button type="button" onClick={() => void handleRebuyConfirm()} disabled={actionBusy}
                className="flex-1 admin-btn-primary py-3 text-sm">
                {actionBusy ? 'Сохранение...' : 'Ребай +1'}
              </button>
            </div>
          </div>
        </div>
      )}

      {addonDialog && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/80 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-3xl border border-[#2D2D2D] bg-[#111] shadow-2xl">
            <div className="border-b border-[#2D2D2D] px-5 py-4">
              <div className="text-white font-black text-lg">Аддон</div>
              <div className="text-[#777] text-sm mt-0.5 break-words">{addonDialog.name}</div>
            </div>
            <div className="px-5 py-4 text-[#AAA] text-sm">
              Сколько аддонов берёт <span className="text-white font-bold">{addonDialog.name}</span>?{' '}
              Уже взято: {addonDialog.addonCount ?? 0}/2.
            </div>
            <div className="border-t border-[#2D2D2D] px-5 py-4 flex gap-2">
              <button type="button" onClick={() => setAddonDialog(null)} disabled={actionBusy}
                className="flex-1 admin-btn-secondary py-3 text-sm">Отмена</button>
              <button type="button" onClick={() => void handleAddonConfirm(1)} disabled={actionBusy}
                className="flex-1 admin-btn-primary py-3 text-sm">
                {actionBusy ? '...' : '1 аддон'}
              </button>
              {(addonDialog.addonCount ?? 0) === 0 && (
                <button type="button" onClick={() => void handleAddonConfirm(2)} disabled={actionBusy}
                  className="flex-1 admin-btn-primary py-3 text-sm">
                  {actionBusy ? '...' : '2 аддона'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {bustDialog && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/80 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-3xl border border-[#2D2D2D] bg-[#111] shadow-2xl">
            <div className="border-b border-[#2D2D2D] px-5 py-4">
              <div className="text-white font-black text-lg">Игрок выбыл</div>
              <div className="text-[#777] text-sm mt-0.5 break-words">{bustDialog.name}</div>
            </div>
            <div className="px-5 py-4 text-[#AAA] text-sm">
              Подтвердить выбывание <span className="text-white font-bold">{bustDialog.name}</span>?
              Администратору придёт уведомление для подтверждения.
              <label className="block mt-4">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[#666] mb-1">Bounty</div>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={bustBountyDraft}
                  onChange={event => setBustBountyDraft(event.target.value)}
                  className="admin-input !py-2 !text-sm w-full"
                  autoFocus
                />
              </label>
            </div>
            <div className="border-t border-[#2D2D2D] px-5 py-4 flex gap-2">
              <button type="button" onClick={() => { setBustDialog(null); setBustBountyDraft('0'); }} disabled={actionBusy}
                className="flex-1 admin-btn-secondary py-3 text-sm">Отмена</button>
              <button type="button" onClick={() => void handleBustConfirm()} disabled={actionBusy}
                className="flex-1 admin-btn-danger py-3 text-sm">
                {actionBusy ? 'Сохранение...' : 'Выбыл'}
              </button>
            </div>
          </div>
        </div>
      )}

      {chipLeaderDialogOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/80 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-3xl border border-[#2D2D2D] bg-[#111] shadow-2xl max-h-[92dvh] overflow-hidden flex flex-col">
            <div className="border-b border-[#2D2D2D] px-5 py-4">
              <div className="text-white font-black text-lg">Чип-лидеры</div>
              <div className="text-[#777] text-sm mt-0.5">Стол {tableNumber}</div>
            </div>
            <div className="px-5 py-4 overflow-y-auto flex flex-col gap-3">
              {tablePlayers.length === 0 ? (
                <div className="rounded-2xl border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-3 text-[#666] text-sm">
                  За этим столом нет активных игроков.
                </div>
              ) : (
                tablePlayers
                  .slice()
                  .sort((a, b) => (a.seatNumber ?? 99) - (b.seatNumber ?? 99))
                  .map(player => (
                    <label key={player.id} className="grid grid-cols-[1fr_120px] gap-3 items-center">
                      <div className="min-w-0">
                        <div className="text-white font-black text-sm truncate">
                          {player.realName || player.name}
                        </div>
                        <div className="text-[#666] text-xs truncate">
                          Бокс {player.seatNumber ?? '—'} · {player.realName ? player.name : 'никнейм'}
                        </div>
                      </div>
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={chipLeaderDraft[player.id] ?? ''}
                        onChange={event => {
                          const value = event.target.value;
                          setChipLeaderDraft(current => ({ ...current, [player.id]: value }));
                        }}
                        className="admin-input !py-2 !text-sm w-full"
                        placeholder="Стек"
                      />
                    </label>
                  ))
              )}
              <div className="text-[#666] text-xs leading-relaxed">
                Нужно заполнить {requiredChipLeaderStacks} из {tablePlayers.length}. Если за столом осталось меньше трёх игроков, отправьте всех.
              </div>
              {chipLeaderState.error && (
                <div className="rounded-xl border border-red-900/60 bg-red-950/30 px-3 py-2 text-red-300 text-xs">
                  {chipLeaderState.error}
                </div>
              )}
            </div>
            <div className="border-t border-[#2D2D2D] px-5 py-4 flex gap-2">
              <button
                type="button"
                onClick={() => setChipLeaderDialogOpen(false)}
                disabled={chipLeaderState.loading}
                className="flex-1 admin-btn-secondary py-3 text-sm"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void handleChipLeaderSubmit()}
                disabled={!canSubmitChipLeaders || chipLeaderState.loading}
                className="flex-1 admin-btn-primary py-3 text-sm disabled:opacity-30"
              >
                {chipLeaderState.loading ? 'Сохранение...' : 'Отправить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SeatCard({
  seatNumber,
  player,
  addonOpen,
  onRebuy,
  onBustOut,
  onAddon,
  onUpdateRealName,
}: {
  seatNumber: number;
  player: LiveTournamentPlayer | null;
  addonOpen: boolean;
  onRebuy: () => void;
  onBustOut: () => void;
  onAddon: () => void;
  onUpdateRealName: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const isOut = player?.status === 'out';
  const rebuys = player?.rebuyCount ?? 0;
  const addons = player?.addonCount ?? 0;

  const startEdit = () => { setDraft(player?.realName ?? ''); setEditing(true); };
  const saveEdit = () => { setEditing(false); onUpdateRealName(draft); };

  return (
    <div className={`h-full rounded-2xl border flex flex-col overflow-hidden ${
      player && !isOut ? 'border-[#3D3D3D] bg-[#111]'
      : isOut ? 'border-[#C0392B]/30 bg-[#150808]'
      : 'border-[#1A1A1A] bg-[#0D0D0D]'
    }`}>
      {/* Хедер: бокс + счётчики */}
      <div className="px-2 pt-1.5 pb-0.5 landscape:pt-1 flex items-center justify-between gap-1">
        <div className="text-[8px] uppercase tracking-[0.14em] text-[#3A3A3A]">Бокс {seatNumber}</div>
        <div className="flex items-center gap-0.5">
          {rebuys > 0 && (
            <div className="px-1 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[9px] font-black">
              ×{rebuys}R
            </div>
          )}
          {addons > 0 && (
            <div className="px-1 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-blue-400 text-[9px] font-black">
              ×{addons}A
            </div>
          )}
        </div>
      </div>

      {player && !isOut ? (
        <div className="flex-1 flex flex-col px-2 pb-2 landscape:pb-1 justify-between min-h-0">
          {/* Имя (редактируемое) + никнейм */}
          <div className="flex flex-col gap-0.5 min-h-0">
            {editing ? (
              <input
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={saveEdit}
                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false); }}
                className="w-full bg-[#1A1A1A] border border-[#555] rounded-md px-2 py-1 text-[#DDD] text-base landscape:text-sm outline-none"
                placeholder="Имя..."
              />
            ) : (
              <button type="button" onClick={startEdit}
                className="text-left flex items-center gap-1 group min-w-0">
                <span className="text-base landscape:text-sm pointer-fine:text-sm font-black text-white group-hover:text-[#EEE] truncate leading-tight">
                  {player.realName || <span className="italic text-[#444] font-normal">имя...</span>}
                </span>
                <span className="shrink-0 text-[10px] text-[#333] group-hover:text-[#666]">✏</span>
              </button>
            )}
            <div className="text-[#666] text-sm landscape:text-xs pointer-fine:text-xs leading-tight truncate">{player.name}</div>
          </div>

          {/* В portrait — кнопки вертикально, в landscape — горизонтально */}
          <div className="flex flex-col landscape:flex-row gap-1.5 landscape:gap-1 mt-2 landscape:mt-1 pointer-fine:gap-1 pointer-fine:mt-1">
            <button type="button" onClick={onRebuy}
              className="flex-1 rounded-xl bg-[#0D2B0D] border border-green-900/50 text-green-400 font-bold py-3 landscape:py-1.5 pointer-fine:py-2 flex items-center justify-center gap-1.5 active:scale-95 transition-transform">
              <span className="text-lg landscape:text-sm pointer-fine:text-sm leading-none font-black">+</span>
              <span className="text-sm landscape:text-xs pointer-fine:text-[10px] font-bold">Rebuy</span>
            </button>
            {addonOpen && (
              <button
                type="button"
                onClick={addons < 2 ? onAddon : undefined}
                disabled={addons >= 2}
                className={`flex-1 rounded-xl font-bold py-3 landscape:py-1.5 pointer-fine:py-2 flex items-center justify-center gap-1.5 transition-transform ${
                  addons < 2
                    ? 'bg-[#0D1B2B] border border-blue-900/50 text-blue-400 active:scale-95'
                    : 'bg-[#111] border border-[#2A2A2A] text-[#333] cursor-not-allowed'
                }`}
              >
                <span className="text-lg landscape:text-sm pointer-fine:text-sm leading-none font-black">+</span>
                <span className="text-sm landscape:text-xs pointer-fine:text-[10px] font-bold">Addon</span>
              </button>
            )}
            <button type="button" onClick={onBustOut}
              className="flex-1 rounded-xl bg-[#1F0808] border border-red-900/50 text-red-400 font-bold py-3 landscape:py-1.5 pointer-fine:py-2 flex items-center justify-center gap-1.5 active:scale-95 transition-transform">
              <span className="text-base landscape:text-sm pointer-fine:text-sm leading-none">✕</span>
              <span className="text-sm landscape:text-xs pointer-fine:text-[10px] font-bold">Выбыл</span>
            </button>
          </div>
        </div>
      ) : isOut ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-[#C0392B]/40 text-[11px] uppercase tracking-widest">Выбыл</div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-[#1E1E1E] text-[11px] uppercase tracking-widest">Пусто</div>
        </div>
      )}
    </div>
  );
}
