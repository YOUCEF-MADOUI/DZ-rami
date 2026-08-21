// =====================================================
// HAND GROUPS — Automatic detection of valid combinations
// among ADJACENT cards in the player's visual hand order
// =====================================================
import { GameCard } from './types';
import { detectCombinationType } from './validation';
export interface DetectedGroup {
  startIndex: number;      // index in the ordered hand
  endIndex: number;        // inclusive
  cardIds: string[];
  type: 'tierce' | 'carre';
  colorIndex: number;      // for visual band color cycling
}
const MAX_GROUP_SIZE = 5;
const MIN_GROUP_SIZE = 3;
/**
 * Scan the hand (in its current visual order) and detect every maximal
 * run of ADJACENT cards that forms a valid combination.
 *
 * Greedy left-to-right: at each position try the longest possible group
 * (5 → 4 → 3). Once a group is found, skip past it and continue.
 */
export function detectHandGroups(orderedHand: GameCard[]): DetectedGroup[] {
  const groups: DetectedGroup[] = [];
  let i = 0;
  let colorIndex = 0;
  while (i < orderedHand.length) {
    let found = false;
    const maxLen = Math.min(MAX_GROUP_SIZE, orderedHand.length - i);
    for (let len = maxLen; len >= MIN_GROUP_SIZE; len--) {
      const slice = orderedHand.slice(i, i + len);
      const type = detectCombinationType(slice);
      if (type) {
        // A carré can never exceed 4 cards
        if (type === 'carre' && len > 4) continue;
        groups.push({
          startIndex: i,
          endIndex: i + len - 1,
          cardIds: slice.map(c => c.id),
          type,
          colorIndex: colorIndex % GROUP_COLORS.length,
        });
        colorIndex++;
        i += len;
        found = true;
        break;
      }
    }
    if (!found) i++;
  }
  return groups;
}
/** Find the group that contains a given card id (or null) */
export function findGroupForCard(groups: DetectedGroup[], cardId: string): DetectedGroup | null {
  return groups.find(g => g.cardIds.includes(cardId)) ?? null;
}
/** Find the group that contains a given hand index (or null) */
export function findGroupForIndex(groups: DetectedGroup[], index: number): DetectedGroup | null {
  return groups.find(g => index >= g.startIndex && index <= g.endIndex) ?? null;
}
/** Visual band colors, cycled per group */
export const GROUP_COLORS = [
  { band: '#3b82f6', glow: 'rgba(59,130,246,0.45)' },   // blue
  { band: '#10b981', glow: 'rgba(16,185,129,0.45)' },   // green
  { band: '#a855f7', glow: 'rgba(168,85,247,0.45)' },   // purple
  { band: '#f59e0b', glow: 'rgba(245,158,11,0.45)' },   // amber
  { band: '#ec4899', glow: 'rgba(236,72,153,0.45)' },   // pink
  { band: '#06b6d4', glow: 'rgba(6,182,212,0.45)' },    // cyan
];
/**
 * Move a block of cards (a group, or a single card) to a new position.
 * Returns the new array of card ids.
 */
export function moveBlock(
  orderedIds: string[],
  blockIds: string[],
  targetIndex: number
): string[] {
  const blockSet = new Set(blockIds);
  // Remove the block from the list
  const without = orderedIds.filter(id => !blockSet.has(id));
  // Count how many removed items were before the target, to adjust insertion point
  let removedBefore = 0;
  for (let i = 0; i < Math.min(targetIndex, orderedIds.length); i++) {
    if (blockSet.has(orderedIds[i])) removedBefore++;
  }
  const insertAt = Math.max(0, Math.min(without.length, targetIndex - removedBefore));
  return [...without.slice(0, insertAt), ...blockIds, ...without.slice(insertAt)];
}
