// =====================================================
// SELECTION → PLACEMENTS
// Turns a multi-card selection into the list of valid combinations the player
// asked to lay down. Presentation helper only: it never mutates a hand, and the
// engine still validates every placement (a refused placement aborts the batch).
// =====================================================
import type { GameCard, JokerPlacement } from './types';
import { detectCombinationType, resolveJokerPlacement } from './validation';
import { MIN_LOCK_SIZE } from './hand-groups';

export interface SelectionPlacement {
  cardIds: string[];
  type: 'tierce' | 'carre';
  jokerPlacement?: JokerPlacement;
}

/**
 * Split the selected cards of a hand into valid combinations.
 *
 * 1. every fully selected LOCKED combination is one group (the frozen block);
 * 2. the remaining selected cards are cut into contiguous runs of the current
 *    hand order, each of which must be a valid combination on its own.
 *
 * Returns `null` as soon as one group is not a valid combination: the UI then
 * keeps refusing the pose instead of sending a partial batch.
 */
/**
 * Partition cards (in hand order) into 3–5 card combinations. Longest first, so
 * a five-card run is not needlessly cut in two. `null` when no partition works.
 */
function splitIntoCombinations(cards: readonly GameCard[]): GameCard[][] | null {
  const memo = new Map<number, GameCard[][] | null>();
  const solve = (start: number): GameCard[][] | null => {
    if (start === cards.length) return [];
    if (memo.has(start)) return memo.get(start)!;
    const max = Math.min(5, cards.length - start);
    for (let length = max; length >= 3; length--) {
      const slice = cards.slice(start, start + length);
      if (!detectCombinationType([...slice])) continue;
      const rest = solve(start + length);
      if (rest) {
        const result = [[...slice], ...rest];
        memo.set(start, result);
        return result;
      }
    }
    memo.set(start, null);
    return null;
  };
  return solve(0);
}

export function planSelectionPlacement(
  orderedHand: readonly GameCard[],
  selectedIds: readonly string[],
  lockedSets: readonly (readonly string[])[],
): SelectionPlacement[] | null {
  const selected = new Set(selectedIds);
  const index = new Map(orderedHand.map((card, position) => [card.id, position]));
  const byPosition = (a: string, b: string) => index.get(a)! - index.get(b)!;

  const groups: string[][] = [];
  const consumed = new Set<string>();

  // 1. Frozen blocks that are entirely selected, in hand order.
  const blocks = lockedSets
    .map(ids => ids.filter(id => index.has(id)))
    .filter(ids => ids.length >= MIN_LOCK_SIZE && ids.every(id => selected.has(id)))
    .map(ids => [...ids].sort(byPosition))
    .sort((a, b) => byPosition(a[0], b[0]));
  for (const ids of blocks) {
    if (ids.some(id => consumed.has(id))) continue;
    ids.forEach(id => consumed.add(id));
    groups.push(ids);
  }

  // 2. Remaining selected cards, split into contiguous runs first…
  const remaining = orderedHand
    .map(card => card.id)
    .filter(id => selected.has(id) && !consumed.has(id));
  const runs: string[][] = [];
  let run: string[] = [];
  let previous: number | null = null;
  for (const id of remaining) {
    const position = index.get(id)!;
    if (previous !== null && position !== previous + 1) {
      runs.push(run);
      run = [];
    }
    run.push(id);
    previous = position;
  }
  if (run.length) runs.push(run);
  // …then each run is partitioned into valid combinations (a run may hold two
  // adjacent combinations, e.g. AKQ♠ + 456♣).
  for (const ids of runs) {
    const cards = ids.map(id => orderedHand[index.get(id)!]);
    const split = splitIntoCombinations(cards);
    if (!split) return null;
    groups.push(...split.map(part => part.map(card => card.id)));
  }

  if (!groups.length) return null;

  const placements: SelectionPlacement[] = [];
  for (const ids of groups) {
    const cards = ids
      .map(id => orderedHand.find(card => card.id === id))
      .filter((card): card is GameCard => !!card);
    if (cards.length !== ids.length) return null;
    const type = detectCombinationType(cards);
    if (!type) return null;
    // The engine validates the explicit placement; an ambiguous Joker stays a
    // refused pose rather than an invented value.
    const jokerPlacement = cards.some(card => card.isJoker)
      ? (resolveJokerPlacement(cards, type) ?? undefined)
      : undefined;
    placements.push({ cardIds: ids, type, jokerPlacement });
  }
  return placements;
}
