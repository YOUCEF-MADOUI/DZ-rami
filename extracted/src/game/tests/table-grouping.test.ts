// A player's melds stay together, and the groups follow the opening order.
import { describe, expect, it } from 'vitest';
import { groupTableCombinations } from '@/components/presentation/table-order';
import type { Combination, GameCard, Rank, Suit } from '@/game/core/types';

let serial = 0;
const card = (rank: Rank, suit: Suit, pack: 1 | 2 = 1): GameCard => ({
  id: `c-${rank}-${suit}-${pack}-${++serial}`,
  rank,
  suit,
  pack,
  isJoker: false,
});

const tierce = (ownerId: string, rank: Rank): Combination => ({
  id: `combo-${ownerId}-${rank}`,
  type: 'tierce',
  ownerId,
  cards: [card(rank, 'spades'), card(rank, 'hearts'), card(rank, 'diamonds')],
});

const carre = (ownerId: string, rank: Rank): Combination => ({
  id: `carre-${ownerId}-${rank}`,
  type: 'carre',
  ownerId,
  cards: [card(rank, 'spades'), card(rank, 'hearts'), card(rank, 'diamonds'), card(rank, 'clubs')],
});

describe('public meld grouping', () => {
  it('keeps every meld of one player inside the same group', () => {
    const combos = [
      tierce('alice', '5'),
      tierce('bob', 'K'),
      tierce('alice', '7'),
      tierce('carol', 'Q'),
      carre('alice', '9'),
    ];
    const groups = groupTableCombinations(combos);
    expect(groups.map(group => group.ownerId)).toEqual(['alice', 'bob', 'carol']);
    expect(groups[0].combos).toHaveLength(3);
    expect(groups.every(group => group.combos.every(combo => combo.ownerId === group.ownerId))).toBe(true);
  });

  it('orders groups by the first opening, not by strength or seat', () => {
    // The weakest meld is played first: its owner must still lead the table.
    const combos = [
      tierce('carol', '3'),
      carre('alice', 'A'),
      tierce('bob', 'K'),
    ];
    expect(groupTableCombinations(combos).map(group => group.ownerId)).toEqual([
      'carol',
      'alice',
      'bob',
    ]);
  });

  it('keeps the strongest-first order inside each player group', () => {
    const low = tierce('alice', '4');
    const high = tierce('alice', 'Q');
    const square = carre('alice', 'J');
    const groups = groupTableCombinations([low, high, square]);
    expect(groups).toHaveLength(1);
    expect(groups[0].combos.map(combo => combo.id)).toEqual([high.id, square.id, low.id]);
  });

  it('never merges two players and keeps empty input empty', () => {
    expect(groupTableCombinations([])).toEqual([]);
    const groups = groupTableCombinations([tierce('a', '4'), tierce('b', '4')]);
    expect(groups.map(group => group.combos.length)).toEqual([1, 1]);
  });
});
