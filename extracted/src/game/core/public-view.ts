import { Combination, GameCard, GameState, Player, RoundResult } from './types';
export type PublicPlayer = Pick<Player,'id'|'name'|'seat'|'status'|'isAI'|'score'|'roundScores'> & {handCount:number};
export interface PublicDiscardEvent { id:string; playerId:string; kind:'discard'|'RS'|'RJ'; card:GameCard|null; sourceCardId?:string; }
/** Explicit whitelist suitable for a future authoritative server. Never serialize GameState to a remote player. A future server must obtain viewerId from its authenticated session, not trust a client-supplied ID. */
export function projectPlayerView(state:GameState,viewerId:string) {
  if(!state.players.some(p=>p.id===viewerId))throw new Error('Unknown viewer');
  const snapshot=state.lastCompletedTurnAction;
  // Older saves predate snapshot.endType; the RS visibility flag remains authoritative.
  const kind:PublicDiscardEvent['kind']=snapshot?.endType??(state.lastDiscardFaceDown?'RS':'discard');
  const lastDiscard:PublicDiscardEvent|null=snapshot?{
    id:snapshot.id,playerId:snapshot.playerId,kind,
    card:kind==='RS'?null:{...snapshot.discardedCard},
    ...(snapshot.playerId===viewerId?{sourceCardId:snapshot.discardedCardId}:{}),
  }:null;
  const players:PublicPlayer[]=state.players.map(p=>({id:p.id,name:p.name,seat:p.seat,status:p.status,isAI:p.isAI,score:p.score,roundScores:[...p.roundScores],handCount:p.hand.length}));
  const rounds:RoundResult[]=state.roundResults.map(r=>({...r,scores:{...r.scores},scoreBreakdown:structuredClone(r.scoreBreakdown),faults:r.faults.map(f=>({playerId:f.playerId,type:f.type,penalty:f.penalty,description:f.description}))}));
  return {config:{...state.config},phase:state.phase,players,roundResults:rounds,
    localHand:state.players.find(p=>p.id===viewerId)!.hand.map(c=>({...c})),
    tableCombinations:structuredClone(state.tableCombinations) as Combination[],
    discardPile:state.discardPile.map((c,i)=>state.lastDiscardFaceDown&&i===state.discardPile.length-1?null:{...c}),
    deckCount:state.deck.length,baseCount:state.basePile.length,currentPlayerId:state.players[state.currentPlayerIndex].id,
    firstPlayerId:state.players[state.firstPlayerIndex].id,lastDiscard};
}

/**
 * Spectator projection: identical to the public table (melds, discard, counts,
 * scores) but with NO hand and NO action of any kind — a watcher never receives
 * a card identity that is not already public.
 */
export function projectSpectatorView(state: GameState) {
  const view = projectPlayerView(state, state.players[0].id);
  return { ...view, localHand: [], actions: null, lastDiscard: view.lastDiscard ? { ...view.lastDiscard, sourceCardId: undefined } : null };
}
