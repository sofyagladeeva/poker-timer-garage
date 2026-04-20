import type { BlindLevel } from '../types';

interface Props {
  current: BlindLevel | null;
  next: BlindLevel | null;
}

function fmt(n: number) {
  if (n >= 1000) return `${n / 1000}K`;
  return String(n);
}

function LevelDisplay({ level, label }: { level: BlindLevel; label: string }) {
  if (level.isBreak) {
    return (
      <div className="text-center">
        <div className="text-[#888] text-sm uppercase tracking-widest mb-1">{label}</div>
        <div className="text-blue-400 text-2xl font-bold">{level.breakLabel || 'ПЕРЕРЫВ'}</div>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="text-[#888] text-sm uppercase tracking-widest mb-2">{label}</div>
      <div className="flex items-center justify-center gap-4">
        <div className="text-center">
          <div className="text-[#888] text-xs uppercase">SB</div>
          <div className="text-white font-bold" style={{ fontSize: label === 'СЕЙЧАС' ? '2.2rem' : '1.4rem' }}>
            {fmt(level.sb)}
          </div>
        </div>
        <div className="text-[#C0392B] text-2xl font-bold">/</div>
        <div className="text-center">
          <div className="text-[#888] text-xs uppercase">BB</div>
          <div className="text-white font-bold" style={{ fontSize: label === 'СЕЙЧАС' ? '2.2rem' : '1.4rem' }}>
            {fmt(level.bb)}
          </div>
        </div>
        {level.ante > 0 && (
          <>
            <div className="text-[#555] text-xl">+</div>
            <div className="text-center">
              <div className="text-[#888] text-xs uppercase">АНТЕ</div>
              <div className="text-[#F39C12] font-bold" style={{ fontSize: label === 'СЕЙЧАС' ? '1.8rem' : '1.2rem' }}>
                {fmt(level.ante)}
              </div>
            </div>
          </>
        )}
      </div>
      <div className="text-[#555] text-xs mt-1">Уровень {level.level}</div>
    </div>
  );
}

export function BlindInfo({ current, next }: Props) {
  if (!current) return null;

  return (
    <div className="flex items-start justify-center gap-12 flex-wrap">
      <LevelDisplay level={current} label="СЕЙЧАС" />
      {next && (
        <div className="flex items-start gap-12">
          <div className="w-px h-16 bg-[#2D2D2D] self-center" />
          <div className="opacity-60">
            <LevelDisplay level={next} label="СЛЕДУЮЩИЙ" />
          </div>
        </div>
      )}
    </div>
  );
}
