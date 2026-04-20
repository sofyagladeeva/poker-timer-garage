import type { Combination } from '../types';
import { PokerCard } from './PokerCard';

interface Props {
  combinations: Combination[];
}

export function CombinationsDisplay({ combinations }: Props) {
  const active = combinations.filter(c => c.enabled);
  if (active.length === 0) return null;

  return (
    <div className="flex items-center gap-6 overflow-x-auto py-1">
      {active.map((combo, i) => (
        <div key={combo.id} className="flex items-center gap-3 flex-shrink-0">
          {i > 0 && <div className="w-px h-10 bg-[#222]" />}
          {/* Cards — крупно */}
          <div className="flex items-center gap-0.5">
            {combo.cards.map((card, ci) => (
              <PokerCard key={ci} card={card} size="md" />
            ))}
          </div>
          <div className="text-[#E31E24] font-bold text-lg">—</div>
          {/* Description — мельче */}
          <div className="text-[#888] text-sm max-w-[180px] leading-tight">{combo.description}</div>
        </div>
      ))}
    </div>
  );
}
