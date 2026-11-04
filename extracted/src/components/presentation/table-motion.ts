import { GameState, getSeatOrder } from '@/game/core/types';
import { PublicPlayer } from '@/game/core/public-view';
export const ROUND_CELEBRATION_MS=5000;
export const DRAW_FLIGHT_MS=400;
export const DEAL_INTERVAL_MS=120;
export const DEAL_FLIGHT_MS=300;
export interface DrawVisualEvent {id:string;playerId:string;source:'deck'|'discard';targetCardId?:string;}
/** Never send the identity of an opponent's drawn card to a visual component. */
export function drawVisualEvent(state:GameState,viewerId:string):DrawVisualEvent|null {
  for(let i=state.actionHistory.length-1;i>=0;i--){
    const action=state.actionHistory[i];
    if(action.type!=='draw'&&action.type!=='chop')continue;
    return {id:`r${state.roundNumber}-take-${i}`,playerId:action.playerId,source:action.type==='draw'?'deck':'discard',
      ...(action.playerId===viewerId&&typeof action.data.cardId==='string'?{targetCardId:action.data.cardId}:{})};
  }
  return null;
}
/** Dealer and starter are the same player: the recipient of fifteen cards. */
export function visualDealer(players:PublicPlayer[],starterId:string):PublicPlayer {
  return players.find(p=>p.id===starterId)!;
}
export function dealRecipients(players:PublicPlayer[],starterId:string):string[] {
  const seats=getSeatOrder(players.length);
  const ordered=[...players].sort((a,b)=>seats.indexOf(a.seat)-seats.indexOf(b.seat));
  const start=ordered.findIndex(p=>p.id===starterId);
  const rotated=[...ordered.slice(start),...ordered.slice(0,start)];
  const result:string[]=[];
  for(let pass=0;pass<Math.max(...players.map(p=>p.handCount));pass++)for(const player of rotated)if(player.handCount>pass)result.push(player.id);
  return result;
}
/** Stable scatter keyed by physical card: no random reshuffling on React rerenders. */
export function discardFractions(count:number,ids:readonly string[]=[]){
  return Array.from({length:count},(_,i)=>{
    let hash=2166136261;
    for(const char of ids[i]??String(i))hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
    const y=Math.imul(hash^0x9e3779b9,0x85ebca6b)>>>0;
    const angle=(Math.imul(y^hash,0xc2b2ae35)>>>0)%321-160;
    return {x:(hash%997)/996,y:(y%991)/990,angle};
  });
}
export function discardPositions(count:number,width:number,height:number,cardWidth:number,cardHeight:number){
  const padX=Math.min(18,Math.max(0,(width-cardWidth)/2)),padY=Math.min(18,Math.max(0,(height-cardHeight)/2));
  return discardFractions(count).map(p=>({left:padX+Math.max(0,width-cardWidth-36)*p.x,top:padY+Math.max(0,height-cardHeight-36)*p.y}));
}
