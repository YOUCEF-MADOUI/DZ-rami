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
 * A lock freezes a real combination, so it always holds at least three cards.
 * Two cards are a plan, not a combination: keeping them locked only blocks the
 * hand (and made pairs survive after a block was partly played).
 */
export const MIN_LOCK_SIZE = MIN_GROUP_SIZE;
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
      // Automatic hints are natural-only. A Joker remains a free card until the
      // player explicitly includes it in a manual combination selection.
      if (slice.some(card => card.isJoker)) continue;
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
/** Auto-detection does not lock movement; only an explicit manual lock moves a block. */
export function getDragBlock(cardId: string, lockedSet: string[] | null): string[] {
  return lockedSet?.includes(cardId) ? lockedSet : [cardId];
}
/** A card sitting right next to a locked combination and able to join it. */
export interface LockedSetExtension {
  /** Cards of the locked combination, in hand order. */
  setIds: string[];
  /** The adjacent card that can be added. */
  cardId: string;
  /** Which edge of the combination the card sits on. */
  side: 'before' | 'after';
  /** Presentation only: the valid combination the merge would create. */
  type: 'tierce' | 'carre';
}

/**
 * Cards adjacent to a locked hand combination that would extend it.
 *
 * A locked combination is a block the player froze; when a neighbouring card
 * turns it into a valid (bigger) combination, the UI shows a small arrow to
 * merge it. Pure presentation: no card leaves the hand, no rule is applied
 * here — `detectCombinationType` is the single source of truth for validity,
 * exactly like the automatic hints.
 */
export function lockedSetExtensions(
  orderedHand: readonly GameCard[],
  lockedSets: readonly (readonly string[])[],
): LockedSetExtension[] {
  const index = new Map(orderedHand.map((card, position) => [card.id, position]));
  const valid = lockedSets
    .map(ids => ids.filter(id => index.has(id)))
    .filter(ids => ids.length >= MIN_LOCK_SIZE)
    // A locked set is a contiguous block in the hand, like the layout expects.
    .filter(ids => {
      const positions = ids.map(id => index.get(id)!).sort((a, b) => a - b);
      return positions.every((value, i) => i === 0 || value === positions[i - 1] + 1);
    });
  const frozen = new Set(valid.flat());
  const extensions: LockedSetExtension[] = [];
  for (const ids of valid) {
    if (ids.length >= 5) continue; // a combination never exceeds five cards
    const positions = ids.map(id => index.get(id)!).sort((a, b) => a - b);
    const setCards = positions.map(position => orderedHand[position]);
    const candidates: { position: number; side: 'before' | 'after' }[] = [
      { position: positions[0] - 1, side: 'before' },
      { position: positions[positions.length - 1] + 1, side: 'after' },
    ];
    for (const { position, side } of candidates) {
      const candidate = orderedHand[position];
      if (!candidate) continue;
      if (frozen.has(candidate.id)) continue;
      // Jokers stay free cards: their value is an explicit player choice.
      if (candidate.isJoker) continue;
      const type = detectCombinationType([...setCards, candidate]);
      if (!type) continue;
      extensions.push({
        setIds: ids,
        cardId: candidate.id,
        side,
        type,
      });
    }
  }
  return extensions;
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
