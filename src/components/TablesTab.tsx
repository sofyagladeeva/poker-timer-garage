import { useState } from 'react';
import type { LiveTournamentPlayer } from '../types.ts';

const SEATS_PER_TABLE = 9;

// Позиции боксов вокруг овального стола (в % от контейнера 100% × 220px)
// Дилер внизу по центру, бокс 1 — слева от дилера, далее по часовой стрелке
const SEAT_POSITIONS: { x: number; y: number }[] = [
  { x: 27, y: 86 },  // 1 — низ-лево (слева от дилера)
  { x: 12, y: 62 },  // 2 — левый низ
  { x: 12, y: 38 },  // 3 — левый верх
  { x: 27, y: 14 },  // 4 — верх-лево
  { x: 50, y: 12 },  // 5 — верх-центр
  { x: 73, y: 14 },  // 6 — верх-право
  { x: 88, y: 38 },  // 7 — правый верх
  { x: 88, y: 62 },  // 8 — правый низ
  { x: 73, y: 86 },  // 9 — низ-право
];

type Props = {
  tableCount: number;
  players: LiveTournamentPlayer[];
  onUpdateTableCount: (count: number) => void;
  onAssignSeat: (playerId: string, tableNumber: number | null, seatNumber: number | null) => Promise<void>;
};

function occupancyStyle(count: number, idealMin: number): {
  badge: string; border: string; bar: string;
} {
  if (count === 0) return { badge: 'text-[#555]', border: 'border-[#2D2D2D]', bar: 'bg-[#2D2D2D]' };
  if (count >= idealMin) return { badge: 'text-green-400', border: 'border-green-800/40', bar: 'bg-green-600' };
  if (idealMin - count === 1) return { badge: 'text-amber-400', border: 'border-amber-800/40', bar: 'bg-amber-500' };
  return { badge: 'text-orange-400', border: 'border-orange-700/60', bar: 'bg-orange-500' };
}

export function TablesTab({ tableCount, players, onUpdateTableCount, onAssignSeat }: Props) {
  const [movingPlayer, setMovingPlayer] = useState<LiveTournamentPlayer | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [merging, setMerging] = useState(false);
  const [balancing, setBalancing] = useState(false);

  const activePlayers = players.filter(p => p.arrivalStatus !== 'absent' && p.status !== 'out');
  const unseated = activePlayers.filter(p => p.tableNumber == null || p.seatNumber == null);
  const totalActive = activePlayers.length;

  // Минимальное число столов, чтобы всем хватило мест
  const neededTables = totalActive > 0 ? Math.ceil(totalActive / SEATS_PER_TABLE) : 0;
  // Идеальное число игроков за столом при оптимальном распределении
  const optimalIdealMax = neededTables > 0 ? Math.ceil(totalActive / neededTables) : 0;
  const optimalIdealMin = neededTables > 0 ? Math.floor(totalActive / neededTables) : 0;

  const tableOccupancy = Array.from({ length: tableCount }, (_, i) => {
    const n = i + 1;
    return { tableNumber: n, count: activePlayers.filter(p => p.tableNumber === n).length };
  });
  // Пустые столы не считаются — только столы с игроками
  const nonEmptyTables = tableOccupancy.filter(t => t.count > 0);
  const canMerge = totalActive > 0 && nonEmptyTables.length > neededTables;
  const seatedCounts = Array.from({ length: tableCount }, (_, i) => {
    const t = i + 1;
    return activePlayers.filter(p => p.tableNumber === t && p.seatNumber != null).length;
  });
  const isUnbalanced = tableCount > 1 && totalActive > 0 && !canMerge &&
    Math.max(...seatedCounts) - Math.min(...seatedCounts) > 1;
  const tablesToClear = canMerge
    ? [...nonEmptyTables].sort((a, b) => a.count - b.count).slice(0, nonEmptyTables.length - neededTables)
    : [];

  const handleMerge = async () => {
    setMerging(true);
    try {
      // Игроки с убираемых столов (tableNumber > neededTables)
      const playersToMove = activePlayers.filter(
        p => p.tableNumber != null && p.tableNumber > neededTables
      );

      // Занятые боксы в остающихся столах
      const occupiedSeats = new Set(
        activePlayers
          .filter(p => p.tableNumber != null && p.tableNumber <= neededTables && p.seatNumber != null)
          .map(p => `${p.tableNumber}:${p.seatNumber}`)
      );

      // Свободные боксы в столах 1..neededTables
      const freeSeats: { tableNumber: number; seatNumber: number }[] = [];
      for (let t = 1; t <= neededTables; t++) {
        for (let s = 1; s <= SEATS_PER_TABLE; s++) {
          if (!occupiedSeats.has(`${t}:${s}`)) {
            freeSeats.push({ tableNumber: t, seatNumber: s });
          }
        }
      }

      for (let i = 0; i < playersToMove.length; i++) {
        const seat = freeSeats[i];
        if (seat) {
          await onAssignSeat(playersToMove[i].id, seat.tableNumber, seat.seatNumber);
        }
      }

      onUpdateTableCount(neededTables);
    } finally {
      setMerging(false);
    }
  };

  const handleBalance = async () => {
    setBalancing(true);
    try {
      const perTableMin = Math.floor(totalActive / tableCount);
      const remainder = totalActive % tableCount;

      const tableStats = Array.from({ length: tableCount }, (_, i) => {
        const t = i + 1;
        return { t, seated: activePlayers.filter(p => p.tableNumber === t && p.seatNumber != null) };
      }).sort((a, b) => b.seated.length - a.seated.length);

      const target: Record<number, number> = {};
      tableStats.forEach(({ t }, idx) => { target[t] = perTableMin + (idx < remainder ? 1 : 0); });

      const toMove: LiveTournamentPlayer[] = [];
      for (const { t, seated } of tableStats) {
        if (seated.length > target[t]) toMove.push(...seated.slice(target[t]));
      }
      if (toMove.length === 0) return;

      const toMoveIds = new Set(toMove.map(p => p.id));
      const occupiedSeats = new Set(
        activePlayers
          .filter(p => p.tableNumber != null && p.seatNumber != null && !toMoveIds.has(p.id))
          .map(p => `${p.tableNumber}:${p.seatNumber}`)
      );

      const freeSeats: { tableNumber: number; seatNumber: number }[] = [];
      for (const { t, seated } of [...tableStats].reverse()) {
        if (seated.length < target[t]) {
          let needed = target[t] - seated.length;
          for (let s = 1; s <= SEATS_PER_TABLE && needed > 0; s++) {
            const key = `${t}:${s}`;
            if (!occupiedSeats.has(key)) { freeSeats.push({ tableNumber: t, seatNumber: s }); occupiedSeats.add(key); needed--; }
          }
        }
      }

      for (let i = 0; i < toMove.length && i < freeSeats.length; i++) {
        await onAssignSeat(toMove[i].id, freeSeats[i].tableNumber, freeSeats[i].seatNumber);
      }
    } finally {
      setBalancing(false);
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const searchResults = normalizedQuery
    ? activePlayers.filter(p =>
        p.name.toLowerCase().includes(normalizedQuery) ||
        p.realName?.toLowerCase().includes(normalizedQuery)
      )
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <input
          type="text"
          placeholder="Найти игрока..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="admin-input w-full pl-9"
        />
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#555] text-sm">⌕</div>
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#888] text-sm"
          >✕</button>
        )}
      </div>

      {normalizedQuery && (
        <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl overflow-hidden">
          {searchResults.length === 0 ? (
            <div className="px-4 py-3 text-[#555] text-sm">Никого не найдено</div>
          ) : (
            <div className="divide-y divide-[#1D1D1D]">
              {searchResults.map(p => (
                <div key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-white font-bold text-sm truncate">{p.name}</div>
                    {p.realName && <div className="text-[#555] text-xs truncate">{p.realName}</div>}
                  </div>
                  <div className="shrink-0 text-right">
                    {p.tableNumber != null && p.seatNumber != null ? (
                      <div className="text-green-400 text-xs font-bold">Стол {p.tableNumber}, бокс {p.seatNumber}</div>
                    ) : (
                      <div className="text-amber-400 text-xs">без места</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-white font-bold text-sm">Количество столов</div>
          <div className="text-[#666] text-xs mt-0.5">
            {totalActive > 0
              ? `${totalActive} игроков → нужно столов: ${neededTables}, идеально ${optimalIdealMin === optimalIdealMax ? optimalIdealMax : `${optimalIdealMin}–${optimalIdealMax}`} за столом`
              : 'Каждый стол — отдельный URL для дилера'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => tableCount > 1 && onUpdateTableCount(tableCount - 1)} disabled={tableCount <= 1}
            className="h-9 w-9 rounded-xl bg-[#2D2D2D] text-white font-bold text-lg disabled:opacity-30">−</button>
          <div className="w-10 text-center text-white font-black text-xl">{tableCount}</div>
          <button type="button" onClick={() => onUpdateTableCount(tableCount + 1)}
            className="h-9 w-9 rounded-xl bg-[#C0392B] text-white font-bold text-lg">+</button>
        </div>
      </div>

      {canMerge && tablesToClear.length > 0 && (
        <div className="bg-[#130A00] border border-orange-700/70 rounded-2xl p-4 flex items-start gap-3">
          <div className="text-2xl mt-0.5">🃏</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <div className="text-orange-300 font-black text-sm">Пора объединять столы</div>
              <button
                type="button"
                onClick={() => void handleMerge()}
                disabled={merging}
                className="shrink-0 px-3 py-1.5 rounded-xl bg-orange-700/40 border border-orange-600/60 text-orange-200 text-xs font-bold hover:bg-orange-700/60 transition-colors disabled:opacity-50"
              >
                {merging ? '...' : `Убрать до ${neededTables}`}
              </button>
            </div>
            <div className="text-orange-200/70 text-xs mt-1 leading-relaxed">
              {totalActive} {totalActive < 5 ? 'игрока' : 'игроков'} поместятся за{' '}
              {neededTables === 1 ? '1 столом' : `${neededTables} столами`} — по{' '}
              {optimalIdealMin === optimalIdealMax ? optimalIdealMax : `${optimalIdealMin}–${optimalIdealMax}`} человек.{' '}
              {`Пересадите игроков ${tablesToClear.map(t => `со стола ${t.tableNumber}`).join(' и ')}.`}
            </div>
          </div>
        </div>
      )}

      {isUnbalanced && (
        <div className="bg-[#0A0D1A] border border-blue-700/70 rounded-2xl p-4 flex items-start gap-3">
          <div className="text-2xl mt-0.5">⚖</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <div className="text-blue-300 font-black text-sm">Неравномерное распределение</div>
              <button
                type="button"
                onClick={() => void handleBalance()}
                disabled={balancing}
                className="shrink-0 px-3 py-1.5 rounded-xl bg-blue-700/40 border border-blue-600/60 text-blue-200 text-xs font-bold hover:bg-blue-700/60 transition-colors disabled:opacity-50"
              >
                {balancing ? '...' : 'Выровнять'}
              </button>
            </div>
            <div className="text-blue-200/70 text-xs mt-1 leading-relaxed">
              {totalActive} {totalActive < 5 ? 'игрока' : 'игроков'} за {tableCount} столами — идеально{' '}
              {optimalIdealMin === optimalIdealMax ? optimalIdealMax : `${optimalIdealMin}–${optimalIdealMax}`} за каждым.
              Разница больше 1 — можно пересадить автоматически.
            </div>
          </div>
        </div>
      )}

      {movingPlayer ? (
        <div className="bg-[#0A0D1A] border border-blue-700/60 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-blue-300 font-black text-sm truncate">{movingPlayer.name}</div>
            <div className="text-blue-400/60 text-xs mt-0.5">
              Стол {movingPlayer.tableNumber}, бокс {movingPlayer.seatNumber} · нажмите любой свободный бокс
            </div>
          </div>
          <button type="button" onClick={() => setMovingPlayer(null)}
            className="shrink-0 px-3 py-1.5 rounded-xl border border-[#3D3D3D] text-[#888] text-xs hover:border-[#555] transition-colors">
            Отмена
          </button>
        </div>
      ) : unseated.length === 0 ? (
        <div className="bg-[#0D1A0D] border border-green-800/50 rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="text-green-400 text-lg">✓</div>
          <div className="text-green-300 text-sm font-bold">Все игроки рассажены</div>
        </div>
      ) : (
        <div className="bg-[#111] border border-amber-800/50 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="text-amber-400 text-lg">⚠</div>
            <div className="text-amber-300 font-bold text-sm">
              {unseated.length} {unseated.length === 1 ? 'игрок' : unseated.length < 5 ? 'игрока' : 'игроков'} без места
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {unseated.map(p => (
              <div key={p.id} className="inline-flex items-center rounded-xl border border-[#3D3D3D] bg-[#0A0A0A] px-2.5 py-1.5 gap-1.5">
                <div className="text-white text-xs font-bold">{p.name}</div>
                {p.tableNumber != null && <div className="text-[#555] text-[10px]">Стол {p.tableNumber}, без бокса</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: tableCount }, (_, i) => i + 1).map(tableNumber => (
          <TableCard
            key={tableNumber}
            tableNumber={tableNumber}
            players={players}
            activePlayers={activePlayers}
            idealMin={optimalIdealMin}
            movingPlayer={movingPlayer}
            onSetMovingPlayer={setMovingPlayer}
            onAssignSeat={onAssignSeat}
          />
        ))}
      </div>
    </div>
  );
}

function TableCard({
  tableNumber,
  players,
  activePlayers,
  idealMin,
  movingPlayer,
  onSetMovingPlayer,
  onAssignSeat,
}: {
  tableNumber: number;
  players: LiveTournamentPlayer[];
  activePlayers: LiveTournamentPlayer[];
  idealMin: number;
  movingPlayer: LiveTournamentPlayer | null;
  onSetMovingPlayer: (p: LiveTournamentPlayer | null) => void;
  onAssignSeat: (playerId: string, tableNumber: number | null, seatNumber: number | null) => Promise<void>;
}) {
  const [assigningSeat, setAssigningSeat] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const tablePlayers = players.filter(
    p => p.tableNumber === tableNumber && p.arrivalStatus !== 'absent' && p.status !== 'out'
  );
  const seats = Array.from({ length: SEATS_PER_TABLE }, (_, i) => {
    const seatNumber = i + 1;
    const player = tablePlayers.find(p => p.seatNumber === seatNumber) ?? null;
    return { seatNumber, player };
  });

  const unseatedActive = activePlayers.filter(p => p.tableNumber == null || p.seatNumber == null);
  const occupiedCount = tablePlayers.length;
  const style = occupancyStyle(occupiedCount, idealMin);
  const fillPct = Math.round((occupiedCount / SEATS_PER_TABLE) * 100);

  const handleSelectFromList = async (playerId: string) => {
    if (!assigningSeat || busy) return;
    setBusy(true);
    try {
      await onAssignSeat(playerId, tableNumber, assigningSeat);
      setAssigningSeat(null);
    } finally {
      setBusy(false);
    }
  };

  const handleFreeFromSeat = async () => {
    if (!movingPlayer || busy) return;
    setBusy(true);
    try {
      await onAssignSeat(movingPlayer.id, null, null);
      onSetMovingPlayer(null);
    } finally {
      setBusy(false);
    }
  };

  const handleClickOccupied = (player: LiveTournamentPlayer) => {
    setAssigningSeat(null);
    onSetMovingPlayer(movingPlayer?.id === player.id ? null : player);
  };

  const handleClickEmpty = async (seatNumber: number) => {
    if (movingPlayer) {
      if (busy) return;
      setBusy(true);
      try {
        await onAssignSeat(movingPlayer.id, tableNumber, seatNumber);
        onSetMovingPlayer(null);
      } finally {
        setBusy(false);
      }
    } else {
      setAssigningSeat(current => current === seatNumber ? null : seatNumber);
    }
  };

  const dealerUrl = `${window.location.origin}${window.location.pathname}#/dealer/${tableNumber}`;

  return (
    <div className={`bg-[#111] border ${style.border} rounded-2xl overflow-hidden`}>
      <div className="border-b border-[#2D2D2D] px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-white font-black text-base">Стол {tableNumber}</div>
          <div className={`text-xs mt-0.5 font-bold ${style.badge}`}>
            {occupiedCount}/{SEATS_PER_TABLE} мест
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(dealerUrl).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
            className="text-[10px] uppercase tracking-[0.12em] text-[#555] hover:text-[#888] border border-[#2D2D2D] rounded-lg px-2 py-1 transition-colors"
            title="Скопировать ссылку"
          >
            {copied ? '✓ Скопировано' : 'Скопировать'}
          </button>
          <a href={dealerUrl} target="_blank" rel="noopener noreferrer"
            className="text-[10px] uppercase tracking-[0.12em] text-[#555] hover:text-[#888] border border-[#2D2D2D] rounded-lg px-2 py-1 transition-colors">
            ↗
          </a>
        </div>
      </div>

      <div className="h-1 w-full bg-[#1A1A1A]">
        <div className={`h-full transition-all ${style.bar}`} style={{ width: `${fillPct}%` }} />
      </div>

      <div className="relative mx-2 my-1 overflow-hidden" style={{ height: '220px' }}>
        {/* Фетровый стол */}
        <div
          className="absolute rounded-full border border-[#1A3A1A]/80 flex items-center justify-center"
          style={{
            left: '22%', right: '22%', top: '14%', bottom: '14%',
            background: 'radial-gradient(ellipse at 50% 40%, #0E1F0E 0%, #080F08 100%)',
          }}
        >
          <div className="text-[#1E4A1E]/60 font-black text-3xl tracking-widest select-none">
            {tableNumber}
          </div>
        </div>
        {/* Метка дилера — внизу по центру, между боксом 9 и боксом 1 */}
        <div
          className="absolute flex items-center justify-center"
          style={{ left: '50%', top: '93%', transform: 'translate(-50%, -50%)' }}
        >
          <div className="px-2 py-0.5 rounded-full bg-[#1A1500] border border-yellow-800/50 text-yellow-600/80 text-[9px] font-black tracking-widest uppercase select-none">
            dealer
          </div>
        </div>

        {seats.map(({ seatNumber, player }) => {
          const pos = SEAT_POSITIONS[seatNumber - 1];
          return (
            <div
              key={seatNumber}
              className="absolute"
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
            >
              <SeatButton
                seatNumber={seatNumber}
                player={player}
                isAssigning={assigningSeat === seatNumber}
                isRemoving={movingPlayer?.id === player?.id}
                isMoveTarget={movingPlayer !== null && !player}
                onClickEmpty={() => void handleClickEmpty(seatNumber)}
                onClickPlayer={() => handleClickOccupied(player!)}
              />
            </div>
          );
        })}
      </div>

      {/* Панель «убрать с места» показывается только на столе, где игрок сидит */}
      {movingPlayer !== null && movingPlayer.tableNumber === tableNumber && (
        <div className="border-t border-[#C0392B]/40 bg-[#1A0A0A] px-3 py-3 flex items-center justify-between gap-3">
          <div className="text-[#888] text-xs">Или освободить место полностью:</div>
          <button type="button" onClick={() => void handleFreeFromSeat()} disabled={busy}
            className="shrink-0 px-3 py-1.5 rounded-xl border border-[#C0392B]/70 bg-[#C0392B]/20 text-[#FF6B6B] text-xs font-bold hover:bg-[#C0392B]/30 transition-colors disabled:opacity-50">
            {busy ? '...' : 'Убрать с места'}
          </button>
        </div>
      )}

      {assigningSeat !== null && !movingPlayer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setAssigningSeat(null)}>
          <div className="w-full max-w-sm bg-[#111] border border-[#2D2D2D] rounded-3xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-[#2D2D2D] px-5 py-4 flex items-center justify-between">
              <div>
                <div className="text-white font-black text-base">Бокс {assigningSeat} · Стол {tableNumber}</div>
                <div className="text-[#555] text-xs mt-0.5">Выберите игрока</div>
              </div>
              <button type="button" onClick={() => setAssigningSeat(null)} className="text-[#555] hover:text-[#888] text-lg leading-none">✕</button>
            </div>
            <div className="p-3 max-h-96 overflow-y-auto">
              {unseatedActive.length === 0 ? (
                <div className="py-8 text-center">
                  <div className="text-green-400 text-2xl mb-2">✓</div>
                  <div className="text-green-300 font-bold text-sm">Все игроки рассажены</div>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {unseatedActive.map(p => (
                    <button key={p.id} type="button" onClick={() => void handleSelectFromList(p.id)} disabled={busy}
                      className="text-left rounded-xl border border-[#2D2D2D] bg-[#0A0A0A] px-4 py-3 hover:border-[#555] transition-colors disabled:opacity-50">
                      <div className="text-white font-bold text-sm">{p.name}</div>
                      {p.realName && <div className="text-[#555] text-xs mt-0.5">{p.realName}</div>}
                      {p.tableNumber != null && <div className="text-[#444] text-xs mt-0.5">Стол {p.tableNumber}, бокс {p.seatNumber}</div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SeatButton({
  seatNumber,
  player,
  isAssigning,
  isRemoving,
  isMoveTarget,
  onClickEmpty,
  onClickPlayer,
}: {
  seatNumber: number;
  player: LiveTournamentPlayer | null;
  isAssigning: boolean;
  isRemoving: boolean;
  isMoveTarget: boolean;
  onClickEmpty: () => void;
  onClickPlayer: () => void;
}) {
  const base = 'flex flex-col items-center justify-center gap-0.5 rounded-xl border transition-colors';
  const size = 'w-[70px] h-[52px]';

  if (player) {
    return (
      <button type="button" onClick={onClickPlayer}
        className={`${base} ${size} ${isRemoving ? 'border-[#C0392B] bg-[#2A0C0A]' : 'border-[#3D3D3D] bg-[#0D0D0D] hover:border-[#555]'}`}>
        <div className={`text-[8px] uppercase tracking-widest ${isRemoving ? 'text-[#C0392B]/60' : 'text-[#444]'}`}>{seatNumber}</div>
        <div className="text-white font-bold text-[10px] leading-tight w-full text-center px-1 truncate">{player.name}</div>
        {player.realName && <div className="text-[#555] text-[9px] w-full text-center px-1 truncate">{player.realName}</div>}
      </button>
    );
  }

  return (
    <button type="button" onClick={onClickEmpty}
      className={`${base} ${size} ${
        isMoveTarget
          ? 'border-blue-600/70 bg-blue-950/40 hover:border-blue-400'
          : isAssigning
            ? 'border-[#C0392B] bg-[#2A0C0A]'
            : 'border-[#222] bg-[#0A0A0A] hover:border-[#3D3D3D]'
      }`}>
      <div className={`text-[8px] uppercase tracking-widest ${isMoveTarget ? 'text-blue-500/60' : 'text-[#2A2A2A]'}`}>{seatNumber}</div>
      <div className={`text-[9px] ${isMoveTarget ? 'text-blue-400' : isAssigning ? 'text-[#C0392B]/70' : 'text-[#222]'}`}>
        {isMoveTarget ? '→' : isAssigning ? '↓' : '—'}
      </div>
    </button>
  );
}
