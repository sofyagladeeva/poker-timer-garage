import type { Card } from '../types';
import { SUIT_SYMBOLS, RED_SUITS } from '../types';

interface Props {
  card: Card;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
}

const sizes = {
  sm:  { card: 'min-w-[36px]  min-h-[46px]  px-1.5 py-1', rank: 'text-sm',  suit: 'text-lg',  anySuit: 'text-[9px]'  },
  md:  { card: 'min-w-[44px]  min-h-[56px]  px-2   py-1', rank: 'text-base', suit: 'text-xl',  anySuit: 'text-xs'     },
  lg:  { card: 'min-w-[60px]  min-h-[76px]  px-3   py-2', rank: 'text-xl',  suit: 'text-3xl', anySuit: 'text-sm'     },
  xl:  { card: 'min-w-[80px]  min-h-[100px] px-4   py-3', rank: 'text-3xl', suit: 'text-5xl', anySuit: 'text-base'   },
  xxl: { card: 'min-w-[100px] min-h-[130px] px-5   py-4', rank: 'text-4xl', suit: 'text-6xl', anySuit: 'text-xl'     },
};

export function PokerCard({ card, size = 'md' }: Props) {
  const isAny = card.suit === 'any';
  const isRed = !isAny && RED_SUITS.includes(card.suit);
  const s = sizes[size];

  return (
    <div
      className={`inline-flex flex-col items-center justify-center bg-white rounded-lg m-1 font-bold shadow-lg ${s.card} ${isRed ? 'text-[#C0392B]' : 'text-[#0A0A0A]'}`}
    >
      <span className={s.rank}>{card.rank}</span>
      {isAny ? (
        <div className={`grid grid-cols-2 gap-0 leading-tight ${s.anySuit}`}>
          <span style={{ color: '#111' }}>♠</span>
          <span style={{ color: '#C0392B' }}>♥</span>
          <span style={{ color: '#C0392B' }}>♦</span>
          <span style={{ color: '#111' }}>♣</span>
        </div>
      ) : (
        <span className={s.suit}>{SUIT_SYMBOLS[card.suit]}</span>
      )}
    </div>
  );
}
