'use client';
import {useEffect,useLayoutEffect,useRef,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {PublicPlayer} from '@/game/core/public-view';
import {DrawVisualEvent,DRAW_FLIGHT_MS,DEAL_INTERVAL_MS,DEAL_FLIGHT_MS,dealRecipients} from './presentation/table-motion';
const subscribe=()=>()=>{};const client=()=>true;const server=()=>false;
export default function StockEffects({round,dealerId,starterId,viewerId,players,draw,pristine,animateInitialDeal,onDealing}:{onDealing?:(active:boolean)=>void;round:number;dealerId:string;starterId:string;viewerId:string;players:PublicPlayer[];draw:DrawVisualEvent|null;pristine:boolean;animateInitialDeal:boolean}){
 const mounted=useSyncExternalStore(subscribe,client,server);
 const layer=useRef<HTMLDivElement>(null);const seenRound=useRef<number|undefined>(undefined);const seenDraw=useRef<string|null>(null);
 const dispose=useRef<(()=>void)|null>(null);const activeTarget=useRef<HTMLElement|null>(null);const dealing=useRef(false);
 const priorDiscard=useRef<DOMRect|null>(null);
 // StrictMode probes effects while leaving the portal mounted. Only cancel on real removal.
 useEffect(()=>()=>{
   queueMicrotask(()=>{if(!layer.current?.isConnected)dispose.current?.();});
 },[]);
 useLayoutEffect(()=>{
  const host=layer.current;if(!host)return;
  const event=draw?{...draw}:null;
  const previousDiscard=priorDiscard.current;priorDiscard.current=document.querySelector('[data-last-discard]')?.getBoundingClientRect()??null;
  const first=seenRound.current===undefined,newRound=seenRound.current!==round;
  const newDraw=!newRound&&(event?.id??null)!==seenDraw.current;
  seenRound.current=round;seenDraw.current=event?.id??null;
  if(first&&!animateInitialDeal)return;
  if(!newRound&&!newDraw){if((dealing.current&&!pristine)||(activeTarget.current&&!activeTarget.current.isConnected))dispose.current?.();return;}
  dispose.current?.();
  const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  if(media?.matches||typeof host.animate!=='function')return;
  const root=document.querySelector<HTMLElement>('[data-game-root]');if(!root)return;
  const zones=Array.from(root.querySelectorAll<HTMLElement>('[data-player-zone]'));
  const zone=(id:string)=>zones.find(el=>el.dataset.playerZone===id);
  const destination=(id:string)=>id===viewerId?root.querySelector<HTMLElement>('.hand-fan'):zone(id)?.querySelector<HTMLElement>('[data-opponent-hand]');
  const nodes:HTMLElement[]=[];const animations:Animation[]=[];let timer:number|undefined,ended=false;
  const finish=()=>{
    if(ended)return;ended=true;animations.forEach(a=>a.cancel());nodes.forEach(n=>n.remove());
    if(activeTarget.current){activeTarget.current.style.visibility='';delete activeTarget.current.dataset.drawArriving;}activeTarget.current=null;
    delete root.dataset.dealing;delete root.dataset.drawUntil;
    if(dealing.current)onDealing?.(false);dealing.current=false;
    if(timer!==undefined)clearTimeout(timer);media?.removeEventListener?.('change',finish);
  };
  dispose.current=finish;media?.addEventListener?.('change',finish);
  const fly=(from:DOMRect,to:DOMRect,delay:number,duration:number,kind:'deal'|'draw',recipient:string)=>{
    const card=document.createElement('div');card.className='card card-back stock-flight';
    card.dataset.stockFlight=kind;card.dataset.toPlayer=recipient;
    if(kind==='deal')card.dataset.fromPlayer=dealerId;
    const width=kind==='deal'?24:38,height=kind==='deal'?35:54;
    const x=from.left+from.width/2-width/2,y=from.top+from.height/2-height/2;
    const tx=to.left+to.width/2-width/2-x,ty=to.top+Math.min(to.height/2,60)-height/2-y;
    Object.assign(card.style,{left:`${x}px`,top:`${y}px`,width:`${width}px`,minWidth:`${width}px`,height:`${height}px`,minHeight:`${height}px`});
    host.appendChild(card);nodes.push(card);
    const scale=kind==='draw'?to.width/width:1;
    const animation=card.animate([{opacity:0,transform:'translate(0,0) rotate(-6deg) scale(1)'},{opacity:1,offset:.05,transform:'translate(0,0) rotate(-6deg) scale(1)'},{opacity:1,transform:`translate(${tx}px,${ty}px) rotate(0deg) scale(${scale})`}],{duration,delay,fill:'both',easing:'cubic-bezier(.2,.7,.3,1)'});
    animations.push(animation);return animation;
  };
  if(newRound&&pristine){
    const from=zone(dealerId)?.getBoundingClientRect();if(!from){finish();return;}
    root.dataset.dealing='true';dealing.current=true;onDealing?.(true);
    const recipients=dealRecipients(players,starterId);
    let last:Animation|undefined;
    recipients.forEach((id,index)=>{const target=destination(id);if(target)last=fly(from,target.getBoundingClientRect(),index*DEAL_INTERVAL_MS,DEAL_FLIGHT_MS,'deal',id);});
    timer=window.setTimeout(finish,recipients.length*DEAL_INTERVAL_MS+DEAL_FLIGHT_MS+100);last?.finished?.then(finish,finish);
  }else if(event){
    const from=event.source==='deck'?root.querySelector('[data-stock-zone]')?.getBoundingClientRect():previousDiscard??root.querySelector('[data-discard-hub]')?.getBoundingClientRect();
    const exact=event.targetCardId?Array.from(root.querySelectorAll<HTMLElement>('[data-card-id]')).find(el=>el.dataset.cardId===event.targetCardId):undefined;
    // If a drawn local card was already played, don't recreate a cosmetic ghost.
    if(event.targetCardId&&!exact){finish();return;}
    const target=exact??destination(event.playerId);if(!from||!target){finish();return;}
    const arriving=exact??target.querySelector<HTMLElement>('.opponent-card-back:last-child');
    const to=(exact?.querySelector('.card')??arriving??target).getBoundingClientRect();
    if(arriving){arriving.style.visibility='hidden';arriving.dataset.drawArriving='true';activeTarget.current=arriving;}
    root.dataset.drawUntil=String(Date.now()+DRAW_FLIGHT_MS);
    const animation=fly(from,to,0,DRAW_FLIGHT_MS,'draw',event.playerId);
    timer=window.setTimeout(finish,DRAW_FLIGHT_MS+100);animation.finished?.then(finish,finish);
  }else finish();
 });
 if(!mounted)return null;
 return createPortal(<div ref={layer} className="stock-effects-layer" aria-hidden="true"/>,document.body);
}
