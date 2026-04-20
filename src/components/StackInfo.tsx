interface Props {
  players: number;
  totalStack: number;
  currentBB: number;
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function StackInfo({ players, totalStack, currentBB }: Props) {
  const avgStack = players > 0 ? Math.round(totalStack / players) : 0;
  const avgInBB = currentBB > 0 && avgStack > 0 ? Math.round(avgStack / currentBB) : 0;

  const items = [
    { label: 'ИГРОКИ', value: players || '—', color: 'text-white' },
    { label: 'ОБЩИЙ СТЕК', value: players > 0 ? fmt(totalStack) : '—', color: 'text-white' },
    {
      label: 'СРЕДНИЙ СТЕК',
      value: avgStack > 0 ? fmt(avgStack) : '—',
      sub: avgInBB > 0 ? `${avgInBB} BB` : undefined,
      color: 'text-white',
    },
  ];

  return (
    <div className="flex justify-center gap-8 flex-wrap">
      {items.map((item) => (
        <div key={item.label} className="text-center bg-[#111] border border-[#2D2D2D] rounded-xl px-6 py-3 min-w-[120px]">
          <div className="text-[#666] text-xs uppercase tracking-widest mb-1">{item.label}</div>
          <div className={`text-2xl font-bold ${item.color}`}>{item.value}</div>
          {item.sub && (
            <div className="text-[#C0392B] text-sm font-bold mt-0.5">{item.sub}</div>
          )}
        </div>
      ))}
    </div>
  );
}
