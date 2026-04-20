import { useBotRating } from '../hooks/useBotRating';

const MEDALS = ['🥇', '🥈', '🥉'];
const PLACE_COLORS = [
  'border-[#F39C12] bg-[#1a1200] text-[#F39C12]',
  'border-[#9CA3AF] bg-[#151515] text-[#ccc]',
  'border-[#CD7F32] bg-[#1a0a00] text-[#CD7F32]',
];

export function RatingDisplay() {
  const { players, loading, error, month, setMonth, refetch } = useBotRating();

  const top3 = players.slice(0, 3);
  const rest = players.slice(3, 10);

  return (
    <div className="w-full flex flex-col items-center gap-6 px-8 py-4">

      {/* Header */}
      <div className="flex items-center gap-6">
        <div className="text-[#C0392B] font-bold uppercase tracking-widest"
             style={{ fontSize: 'clamp(1.2rem, 3vw, 2rem)' }}>
          Рейтинг месяца
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setMonth(currentMonth())}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              month !== 'all' ? 'border-[#C0392B] text-[#C0392B]' : 'border-[#333] text-[#555]'
            }`}
          >
            Этот месяц
          </button>
          <button
            onClick={() => setMonth('all')}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              month === 'all' ? 'border-[#C0392B] text-[#C0392B]' : 'border-[#333] text-[#555]'
            }`}
          >
            За всё время
          </button>
          <button onClick={refetch} className="text-xs px-2 py-1 text-[#444] hover:text-white">↻</button>
        </div>
      </div>

      {loading && (
        <div className="text-[#555] text-lg">Загрузка...</div>
      )}

      {error && (
        <div className="text-red-500 text-sm">Ошибка: {error}</div>
      )}

      {!loading && !error && players.length === 0 && (
        <div className="text-[#555] text-lg">Данных за этот месяц нет</div>
      )}

      {/* Top 3 — крупно */}
      {top3.length > 0 && (
        <div className="flex items-end justify-center gap-4 w-full max-w-4xl">
          {/* 2 место слева */}
          {top3[1] && (
            <TopCard player={top3[1]} colorClass={PLACE_COLORS[1]} medal={MEDALS[1]} heightClass="h-44" />
          )}
          {/* 1 место в центре и выше */}
          {top3[0] && (
            <TopCard player={top3[0]} colorClass={PLACE_COLORS[0]} medal={MEDALS[0]} heightClass="h-56" big />
          )}
          {/* 3 место справа */}
          {top3[2] && (
            <TopCard player={top3[2]} colorClass={PLACE_COLORS[2]} medal={MEDALS[2]} heightClass="h-40" />
          )}
        </div>
      )}

      {/* Места 4–10 — список */}
      {rest.length > 0 && (
        <div className="flex flex-col gap-1.5 w-full max-w-2xl">
          {rest.map((p, i) => (
            <div key={p.telegram_id}
                 className="flex items-center gap-4 bg-[#111] border border-[#2D2D2D] rounded-xl px-5 py-2">
              <span className="text-[#555] w-6 text-center font-bold">{i + 4}</span>
              <span className="flex-1 text-white font-medium">{p.name}</span>
              <span className="text-[#888] text-sm">{p.games} игр</span>
              <span className="text-white font-bold">{p.points.toFixed(1)} <span className="text-[#555] text-xs font-normal">pts</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TopCard({
  player,
  colorClass,
  medal,
  heightClass,
  big = false,
}: {
  player: { name: string; points: number; games: number; championships: number };
  colorClass: string;
  medal: string;
  heightClass: string;
  big?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-end border rounded-2xl px-6 pb-4 pt-3 flex-1 max-w-xs ${colorClass} ${heightClass} transition-all`}>
      <div style={{ fontSize: big ? '3rem' : '2rem' }}>{medal}</div>
      <div className={`font-bold text-center leading-tight mt-1 ${big ? 'text-2xl' : 'text-lg'}`}>
        {player.name}
      </div>
      <div className={`font-bold mt-1 ${big ? 'text-3xl' : 'text-xl'}`}>
        {player.points.toFixed(1)}
        <span className="text-xs font-normal opacity-60 ml-1">pts</span>
      </div>
      <div className="text-xs opacity-50 mt-0.5">{player.games} игр</div>
      {player.championships > 0 && (
        <div className="text-xs mt-0.5">🏆 {player.championships}</div>
      )}
    </div>
  );
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
