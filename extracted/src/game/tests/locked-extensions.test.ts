// A locked combination can absorb a neighbouring card: the little arrow.
import { describe, expect, it } from 'vitest';
import { lockedSetExtensions } from '@/game/core/hand-groups';
import type { GameCard, Rank, Suit } from '@/game/core/types';

let serial = 0;
const card = (rank: Rank, suit: Suit): GameCard => ({
  id: `ext-${rank}-${suit}-${++serial}`,
  rank,
  suit,
  pack: 1,
  isJoker: false,
});
const ids = (cards: GameCard[]) => cards.map(c => c.id);

describe('locked combination extensions', () => {
  it('offers both neighbouring cards that extend a locked tierce', () => {
    const four = card('4', 'hearts');
    const five = card('5', 'hearts');
    const six = card('6', 'hearts');
    const seven = card('7', 'hearts');
    const eight = card('8', 'hearts');
    const hand = [four, five, six, seven, eight];
    const locked = ids([five, six, seven]);

    const extensions = lockedSetExtensions(hand, [locked]);
    expect(extensions).toHaveLength(2);
    expect(extensions.map(e => e.cardId)).toEqual([four.id, eight.id]);
    expect(extensions.map(e => e.side)).toEqual(['before', 'after']);
    expect(extensions.every(e => e.type === 'tierce')).toBe(true);
    expect(extensions.every(e => e.setIds.join() === locked.join())).toBe(true);
  });

  it('never offers a fifth card on a locked carré', () => {
    const square = (['spades', 'hearts', 'diamonds', 'clubs'] as const).map(suit => card('9', suit));
    const hand = [square[0], square[1], square[2], square[3], card('9', 'spades')];
    expect(lockedSetExtensions(hand, [ids(square)])).toEqual([]);
  });

  it('ignores a neighbour of another suit or another locked block', () => {
    const five = card('5', 'hearts');
    const six = card('6', 'hearts');
    const seven = card('7', 'hearts');
    const otherSuit = card('8', 'spades');
    const hand = [five, six, seven, otherSuit];
    expect(lockedSetExtensions(hand, [ids([five, six, seven])])).toEqual([]);

    const eight = card('8', 'hearts');
    const other = [card('K', 'clubs'), card('Q', 'clubs'), card('J', 'clubs')];
    const hand2 = [five, six, seven, eight, ...other];
    const extensions = lockedSetExtensions(hand2, [ids([five, six, seven]), ids(other)]);
    // 8♥ joins the run; no card of the second block is ever offered.
    expect(extensions.map(e => e.cardId)).toEqual([eight.id]);
  });

  it('requires the card to be physically adjacent to the locked block', () => {
    const five = card('5', 'hearts');
    const six = card('6', 'hearts');
    const seven = card('7', 'hearts');
    const eight = card('8', 'hearts');
    const gap = card('A', 'clubs');
    const hand = [five, six, seven, gap, eight];
    expect(lockedSetExtensions(hand, [ids([five, six, seven])])).toEqual([]);
  });

  it('never offers an arrow from a two-card lock and refuses a full combination', () => {
    const three = card('3', 'diamonds');
    const four = card('4', 'diamonds');
    const five = card('5', 'diamonds');
    const six = card('6', 'diamonds');
    const seven = card('7', 'diamonds');
    const eight = card('8', 'diamonds');
    // A pair is not a combination: it is not a lock and gets no arrow.
    expect(lockedSetExtensions([three, four, five], [ids([three, four])])).toEqual([]);
    expect(lockedSetExtensions([three, seven, five], [ids([three, seven])])).toEqual([]);
    // Five cards is already the maximum length.
    expect(
      lockedSetExtensions([three, four, five, six, seven, eight], [ids([three, four, five, six, seven])]),
    ).toEqual([]);
  });
});
