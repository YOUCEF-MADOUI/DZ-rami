'use client';

import type { CSSProperties } from 'react';
import { GameCard, SUIT_COLORS } from '@/game/core/types';
import SuitIcon from './SuitIcon';

interface Props {
  card: GameCard;
  selected?: boolean;
  faceDown?: boolean;
  small?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  highlight?: boolean;   // amber ring — used for the last discarded card
}

// Illustrated court figures (J / Q / K) — art is shared by red/black suits.
const FIGURE_SRC: Record<string, { red: string; black: string }> = {
  J: { red: '/cards/jack-red.png', black: '/cards/jack-black.png' },
  Q: { red: '/cards/queen-red.png', black: '/cards/queen-black.png' },
  K: { red: '/cards/king-red.png', black: '/cards/king-black.png' },
};

export default function CardView({ card, selected, faceDown, small, onClick, disabled, highlight }: Props) {
  const sizeStyle: CSSProperties | undefined = small ? { width: 38, height: 54, fontSize: 10 } : undefined;
  const highlightStyle: CSSProperties = highlight
    ? { boxShadow: '0 0 0 3px #f59e0b, 0 0 14px 3px rgba(245,158,11,0.85)', borderRadius: 8 }
    : {};

  if (faceDown) {
    return (
      <div
        className={`card card-back ${small ? 'scale-75' : ''}`}
        style={{ ...sizeStyle, ...highlightStyle }}
      />
    );
  }

  if (card.isJoker) {
    return (
      <div
        onClick={disabled ? undefined : onClick}
        className={`card joker-card ${selected ? 'selected' : ''} ${disabled ? 'opacity-50' : ''}`}
        style={{ ...sizeStyle, ...highlightStyle }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/cards/joker.png" alt="Joker" className="absolute inset-1 h-[calc(100%-8px)] w-[calc(100%-8px)] object-cover rounded-md" />
        <span className={`absolute bottom-0.5 left-0 right-0 text-center font-black ${small ? 'text-[6px]' : 'text-[8px]'} text-purple-700 bg-white/70 leading-tight`}>JOKER</span>
      </div>
    );
  }

  const color = SUIT_COLORS[card.suit];
  const figure = FIGURE_SRC[card.rank];

  return (
    <div
      onClick={disabled ? undefined : onClick}
      className={`card ${color === 'red' ? 'red' : 'black'} ${selected ? 'selected' : ''} ${disabled ? 'opacity-50' : ''}`}
      style={{ ...sizeStyle, ...highlightStyle }}
    >
      {/* Top-left index only (cards are seen from one side) */}
      <div className={`absolute top-0.5 left-1 z-10 ${small ? 'text-[10px]' : 'text-[14px]'} font-bold leading-none flex flex-col items-center gap-0.5`}>
        <span>{card.rank}</span>
        <SuitIcon suit={card.suit} size={small ? 10 : 14} />
      </div>

      {/* Figures (J/Q/K) keep a centered illustration */}
      {figure ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={color === 'red' ? figure.red : figure.black}
          alt={card.rank}
          className="object-contain pointer-events-none"
          style={{ maxWidth: '82%', maxHeight: '78%' }}
        />
      ) : (
        // Numeric cards: a big suit icon anchored to the bottom-right corner
        <div className={`absolute z-0 ${small ? 'bottom-0.5 right-0.5' : 'bottom-1 right-1'}`}>
          <SuitIcon suit={card.suit} size={small ? 26 : 46} />
        </div>
      )}
    </div>
  );
}
