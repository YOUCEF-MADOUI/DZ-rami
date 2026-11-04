import { Combination, GameCard, RANK_ORDER, Player, getSeatOrder } from '@/game/core/types';
import { determineTierceSequence } from '@/game/core/validation';

/** Presentation only: no writes to the meld or to its Joker metadata. */
export function tableCards(combo: Combination): GameCard[] {
  // A positioned Joker is an explicit user choice, not an automatic sort target.
  if (combo.type !== 'tierce' || combo.cards.some(card => card.isJoker)) return [...combo.cards];
  const sequence = determineTierceSequence(combo);
  return sequence ? [...sequence].sort((a,b) => b.position-a.position).map(p => p.card!) : [...combo.cards];
}

export function combinationStrength(combo: Combination): number {
  if (combo.type === 'tierce') {
    const sequence = determineTierceSequence(combo);
    if (sequence) return Math.max(...sequence.map(p => p.position));
  }
  return Math.max(0, ...combo.cards.map(c => c.isJoker ? 0 : c.rank === 'A' ? 14 : RANK_ORDER[c.rank]));
}

/** Stable descending order; equal-strength melds keep their original order. */
export function tableCombinations(combos: readonly Combination[]): Combination[] {
  return combos.map((combo,index) => ({combo,index,strength:combinationStrength(combo)}))
    .sort((a,b) => b.strength-a.strength || a.index-b.index).map(item=>item.combo);
}

/** All the melds of one player, kept together on the table. */
export interface MeldGroup {
  ownerId: string;
  combos: Combination[];
}

/**
 * Groups the public melds by owner. A player's melds must stay side by side
 * instead of being scattered among everybody else's.
 *
 * Group order is the order in which each player first put a meld on the table
 * — i.e. the order of openings of the round (the engine only appends melds, and
 * removals keep the remaining order), not the alphabetical or seat order. Inside
 * a group the existing strongest-first presentation is preserved.
 */
export function groupTableCombinations(combos: readonly Combination[]): MeldGroup[] {
  const groups: MeldGroup[] = [];
  const index = new Map<string, MeldGroup>();
  for (const combo of combos) {
    let group = index.get(combo.ownerId);
    if (!group) {
      group = { ownerId: combo.ownerId, combos: [] };
      index.set(combo.ownerId, group);
      groups.push(group);
    }
    group.combos.push(combo);
  }
  return groups.map(group => ({ ...group, combos: tableCombinations(group.combos) }));
}

export const PLAYER_COLORS=['#38bdf8','#fb7185','#a78bfa','#fb923c','#34d399'] as const;
/** Stable colors by logical seat order, independent of whose turn it is. */
export function playerColor(players: readonly Pick<Player,'id'|'seat'>[],playerId:string):string {
  const player=players.find(p=>p.id===playerId);
  if(!player)return '#94a3b8';
  return PLAYER_COLORS[getSeatOrder(players.length).indexOf(player.seat)]??'#94a3b8';
}
