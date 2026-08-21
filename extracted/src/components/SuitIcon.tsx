'use client';

import type { Suit } from '@/game/core/types';

// Crisp SVG suit shapes so clubs (rounded lobes) is clearly distinct from spades.
// Colors follow the card: hearts/diamonds red, clubs/spades black.
const PATHS: Record<Suit, string> = {
  // Hearts
  hearts:
    'M50 88 C 20 66, 4 48, 4 30 C 4 14, 16 4, 30 4 C 40 4, 47 10, 50 18 C 53 10, 60 4, 70 4 C 84 4, 96 14, 96 30 C 96 48, 80 66, 50 88 Z',
  // Diamonds
  diamonds: 'M50 4 L 92 50 L 50 96 L 8 50 Z',
  // Spades (pointed top, stem base)
  spades:
    'M50 6 C 50 6, 12 40, 12 62 C 12 76, 22 84, 33 84 C 40 84, 46 80, 49 74 C 47 84, 43 90, 36 94 L 64 94 C 57 90, 53 84, 51 74 C 54 80, 60 84, 67 84 C 78 84, 88 76, 88 62 C 88 40, 50 6, 50 6 Z',
  // Clubs — three well-rounded lobes with a stem, like the reference image
  clubs:
    'M50 6 C 61 6, 70 15, 70 26 C 70 31, 68 35, 66 39 C 70 36, 75 34, 80 34 C 91 34, 100 43, 100 54 C 100 65, 91 74, 80 74 C 71 74, 63 68, 60 60 C 61 71, 66 82, 74 90 L 26 90 C 34 82, 39 71, 40 60 C 37 68, 29 74, 20 74 C 9 74, 0 65, 0 54 C 0 43, 9 34, 20 34 C 25 34, 30 36, 34 39 C 32 35, 30 31, 30 26 C 30 15, 39 6, 50 6 Z',
};

interface Props {
  suit: Suit;
  size?: number;
  className?: string;
}

export default function SuitIcon({ suit, size = 16, className }: Props) {
  const red = suit === 'hearts' || suit === 'diamonds';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
      aria-hidden="true"
    >
      <path d={PATHS[suit]} fill={red ? '#dc2626' : '#1e293b'} />
    </svg>
  );
}
