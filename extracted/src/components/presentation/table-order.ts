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

export const PLAYER_COLORS=['#38bdf8','#fb7185','#a78bfa','#fb923c','#34d399'] as const;
/** Stable colors by logical seat order, independent of whose turn it is. */
export function playerColor(players: readonly Pick<Player,'id'|'seat'>[],playerId:string):string {
  const player=players.find(p=>p.id===playerId);
  if(!player)return '#94a3b8';
  return PLAYER_COLORS[getSeatOrder(players.length).indexOf(player.seat)]??'#94a3b8';
}
