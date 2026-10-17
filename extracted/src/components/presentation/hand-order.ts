import { GameState } from '@/game/core/types';

/** Reorder physical references only. Reject stale/incomplete/duplicated ID lists. */
export function reorderHand(state: GameState, playerId: string, ids: readonly string[]): GameState {
  const player = state.players.find(p => p.id === playerId);
  if (!player || ids.length !== player.hand.length || new Set(ids).size !== ids.length) return state;
  const byId = new Map(player.hand.map(card => [card.id, card]));
  if (ids.some(id => !byId.has(id))) return state;
  if (ids.every((id,i) => player.hand[i].id === id)) return state;
  return {...state, players: state.players.map(p => p.id === playerId ? {...p, hand: ids.map(id => byId.get(id)!)} : p)};
}

/** Insertion slots are defined by the exposed strip, not full card hitboxes. */
export function handInsertionIndex(x: number, left: number, scroll: number, padding: number, step: number, count: number): number {
  return Math.max(0, Math.min(count, Math.round((x - left + scroll - padding) / step)));
}
