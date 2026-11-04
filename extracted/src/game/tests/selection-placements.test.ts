// A multi-selection is split into the combinations the player wants to lay down.
import { describe, expect, it } from 'vitest';
import { planSelectionPlacement } from '@/game/core/selection-groups';
import type { GameCard, Rank, Suit } from '@/game/core/types';

let serial = 0;
const card = (rank: Rank, suit: Suit): GameCard => ({
  id: `sel-${rank}-${suit}-${++serial}`,
  rank,
  suit,
  pack: 1,
  isJoker: false,
});

describe('selection placement plan', () => {
  it('splits two locked combinations into two placements', () => {
    const run = [card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts')];
    const square = (['spades', 'hearts', 'diamonds', 'clubs'] as const).map(suit => card('9', suit));
    const hand = [...run, card('2', 'diamonds'), ...square];
    const plan = planSelectionPlacement(hand, [...run, ...square].map(c => c.id), [
      run.map(c => c.id),
      square.map(c => c.id),
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.map(p => p.type)).toEqual(['tierce', 'carre']);
    expect(plan!.map(p => p.cardIds.length)).toEqual([3, 4]);
    expect(plan!.map(p => p.cardIds)).toEqual([
      run.map(c => c.id),
      square.map(c => c.id),
    ]);
  });

  it('keeps a non-locked selection in contiguous runs', () => {
    const run1 = [card('A', 'spades'), card('K', 'spades'), card('Q', 'spades')];
    const run2 = [card('4', 'clubs'), card('5', 'clubs'), card('6', 'clubs')];
    const hand = [...run1, ...run2];
    const plan = planSelectionPlacement(hand, hand.map(c => c.id), []);
    expect(plan).toHaveLength(2);
  });

  it('refuses the whole batch when one group is invalid', () => {
    const run = [card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts')];
    const broken = [card('2', 'clubs'), card('9', 'clubs'), card('K', 'diamonds')];
    const hand = [...run, ...broken];
    expect(
      planSelectionPlacement(hand, hand.map(c => c.id), [run.map(c => c.id)]),
    ).toBeNull();
  });

  it('ignores a partially selected locked block but keeps the full ones', () => {
    const run = [card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts')];
    const other = [card('J', 'clubs'), card('Q', 'clubs'), card('K', 'clubs')];
    const hand = [...run, ...other];
    const plan = planSelectionPlacement(hand, [...run.map(c => c.id), other[0].id], [
      run.map(c => c.id),
      other.map(c => c.id),
    ]);
    // The full run is one group; the lone jack cannot form one → refused.
    expect(plan).toBeNull();
  });

  it('returns exactly one placement for a single selection', () => {
    const run = [card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts')];
    const plan = planSelectionPlacement(run, run.map(c => c.id), []);
    expect(plan).toHaveLength(1);
    expect(plan![0].type).toBe('tierce');
  });
});
