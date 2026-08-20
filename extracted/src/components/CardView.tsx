'use client';

import { GameCard, SUIT_SYMBOLS, SUIT_COLORS } from '@/game/core/types';

interface Props {
  card: GameCard;
  selected?: boolean;
  faceDown?: boolean;
  small?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

export default function CardView({ card, selected, faceDown, small, onClick, disabled }: Props) {
  if (faceDown) {
    return (
      <div
        className={`card card-back ${small ? 'scale-75' : ''}`}
        style={small ? { width: 38, height: 54, fontSize: 10 } : undefined}
      />
    );
  }

  if (card.isJoker) {
    return (
      <div
        onClick={disabled ? undefined : onClick}
        className={`card joker-card ${selected ? 'selected' : ''} ${small ? '' : ''} ${disabled ? 'opacity-50' : ''}`}
        style={small ? { width: 38, height: 54, fontSize: 10 } : undefined}
      >
        <span className={small ? 'text-xs' : 'text-lg'}>🃏</span>
        <span className={small ? 'text-[8px]' : 'text-[10px]'}>JOKER</span>
      </div>
    );
  }

  const color = SUIT_COLORS[card.suit];
  const symbol = SUIT_SYMBOLS[card.suit];

  return (
    <div
      onClick={disabled ? undefined : onClick}
      className={`card ${color === 'red' ? 'red' : 'black'} ${selected ? 'selected' : ''} ${disabled ? 'opacity-50' : ''}`}
      style={small ? { width: 38, height: 54, fontSize: 10 } : undefined}
    >
      <div className={`absolute top-1 left-1.5 ${small ? 'text-[8px]' : 'text-[11px]'} font-bold leading-none`}>
        {card.rank}
        <br />
        <span className={small ? 'text-[8px]' : 'text-[10px]'}>{symbol}</span>
      </div>
      <span className={small ? 'text-sm' : 'text-xl'}>{symbol}</span>
      <div className={`absolute bottom-1 right-1.5 rotate-180 ${small ? 'text-[8px]' : 'text-[11px]'} font-bold leading-none`}>
        {card.rank}
        <br />
        <span className={small ? 'text-[8px]' : 'text-[10px]'}>{symbol}</span>
      </div>
    </div>
  );
}
