'use client';

import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { GameCard, SUIT_COLORS } from '@/game/core/types';
import SuitIcon from './SuitIcon';

interface Props {
  card: GameCard;
  selected?: boolean;
  faceDown?: boolean;
  small?: boolean;
  tiny?: boolean; // compact table cards for opponent zones only
  onClick?: () => void;
  disabled?: boolean;
  highlight?: boolean;   // amber ring — used for the last discarded card
  stopPropagationOnClick?: boolean;
  /** Card this Joker stands for, e.g. "9♥" — shown as a badge on the Joker. */
  jokerAs?: string;
  groupColor?: string;
}

// Illustrated court figures (J / Q / K) — art is shared by red/black suits.
const FIGURE_SRC: Record<string, { red: string; black: string }> = {
  J: { red: '/cards/jack-red.png', black: '/cards/jack-black.png' },
  Q: { red: '/cards/queen-red.png', black: '/cards/queen-black.png' },
  K: { red: '/cards/king-red.png', black: '/cards/king-black.png' },
};

export default function CardView({ card, selected, faceDown, small, tiny, onClick, disabled, highlight, stopPropagationOnClick, jokerAs, groupColor }: Props) {
  const groupBand = groupColor ? <span data-card-group-band aria-hidden="true" className="card-group-band" style={{backgroundColor:groupColor,height:`calc(var(${tiny?'--card-tiny-height':small?'--card-small-height':'--card-height'}) * 0.05)`}} /> : null;
  const compact = small || tiny;
  const sizeClass = tiny ? 'card-tiny' : small ? 'card-small' : '';
  const activate = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (stopPropagationOnClick) event.stopPropagation();
    onClick?.();
  };
  const activateFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    if (stopPropagationOnClick) event.stopPropagation();
    onClick?.();
  };
  const highlightStyle: CSSProperties = highlight
    ? { boxShadow: '0 0 0 3px #f59e0b, 0 0 14px 3px rgba(245,158,11,0.85)', borderRadius: 8 }
    : {};

  if (faceDown) {
    return (
      <div
        onClick={onClick ? activate : undefined}
        onKeyDown={onClick ? activateFromKeyboard : undefined}
        role={onClick ? 'button' : undefined}
        aria-disabled={onClick ? Boolean(disabled) : undefined}
      tabIndex={onClick && !disabled ? 0 : undefined}
        aria-label={onClick ? 'Action sur la carte' : undefined}
        className={`card card-back ${sizeClass} ${onClick && !disabled ? 'cursor-pointer' : ''} ${disabled ? 'cursor-not-allowed' : ''}`}
        style={highlightStyle}
      />
    );
  }

  if (card.isJoker) {
    return (
      <div
        onClick={onClick ? activate : undefined}
        onKeyDown={onClick ? activateFromKeyboard : undefined}
        role={onClick ? 'button' : undefined}
        aria-disabled={onClick ? Boolean(disabled) : undefined}
      tabIndex={onClick && !disabled ? 0 : undefined}
        aria-label={onClick ? 'Joker' : undefined}
        className={`card joker-card ${sizeClass} ${selected ? 'selected' : ''} ${disabled ? 'cursor-not-allowed' : ''}`}
        style={highlightStyle}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/cards/joker.png" alt="Joker" className="absolute inset-1 h-[calc(100%-8px)] w-[calc(100%-8px)] object-cover rounded-md" />
        <span className={`absolute bottom-0.5 left-0 right-0 text-center font-black ${tiny ? 'text-[5px]' : small ? 'text-[6px]' : 'text-[8px]'} text-purple-700 bg-white/70 leading-tight`} style={groupColor ? {bottom:'7%'} : undefined}>JOKER</span>
        <span className="absolute left-0.5 top-4 text-[9px] font-black text-purple-900 bg-white/90">★</span>
        {groupBand}
        {/* The card this Joker represents: never re-derived silently. */}
        {jokerAs && (
          <span className={`absolute left-0 top-0 z-20 rounded bg-slate-950/90 px-0.5 font-black leading-tight text-amber-300 ${tiny ? 'text-[5px]' : small ? 'text-[7px]' : 'text-[9px]'}`}>
            {jokerAs}
          </span>
        )}
      </div>
    );
  }

  const color = SUIT_COLORS[card.suit];
  const figure = FIGURE_SRC[card.rank];

  return (
    <div
      onClick={onClick ? activate : undefined}
      onKeyDown={onClick ? activateFromKeyboard : undefined}
      role={onClick ? 'button' : undefined}
      aria-disabled={onClick ? Boolean(disabled) : undefined}
      tabIndex={onClick && !disabled ? 0 : undefined}
      aria-label={onClick ? `${card.rank} ${card.suit}` : undefined}
      className={`card ${sizeClass} ${color === 'red' ? 'red' : 'black'} ${selected ? 'selected' : ''} ${disabled ? 'cursor-not-allowed' : ''}`}
      style={highlightStyle}
    >
      {/* Top-left index only (cards are seen from one side) */}
      <div className={`absolute top-0.5 left-0 z-10 ${tiny ? 'text-[9px]' : small ? 'text-[9px]' : 'text-[13px]'} font-bold leading-none flex flex-col items-center gap-0.5`}>
        <span>{card.rank}</span>
        <SuitIcon suit={card.suit} size={tiny ? 10 : small ? 10 : 14} />
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
        <div className={`absolute z-0 ${compact ? 'bottom-0.5 right-0.5' : 'bottom-1 right-1'}`}>
          <SuitIcon suit={card.suit} size={tiny ? 15 : small ? 26 : 46} />
        </div>
      )}
      {groupBand}
    </div>
  );
}
