'use client';
import { useLayoutEffect, useRef, useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { PublicDiscardEvent } from '@/game/core/public-view';
import { ROUND_CELEBRATION_MS } from './presentation/table-motion';
import CardView from './CardView';
const subscribeHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
const BACK = {id:'public-card-back',isJoker:false as const,rank:'A' as const,suit:'spades' as const,pack:1 as const};
/** Presentation-only observer: no game action, score mutation, or delayed engine transition. */
export default function DiscardEffects({event}:{event:PublicDiscardEvent|null}) {
  const hydrated=useSyncExternalStore(subscribeHydration,clientReady,serverReady);
  const fly=useRef<HTMLDivElement>(null);
  const announcement=useRef<HTMLDivElement>(null);
  const seen=useRef<string|null|undefined>(undefined);
  const previousPositions=useRef(new Map<string,DOMRect>());
  const activeTarget=useRef<HTMLElement|null>(null);
  const dispose=useRef<(()=>void)|null>(null);
  useEffect(()=>()=>dispose.current?.(),[]);
  useLayoutEffect(()=>{
    const prior=previousPositions.current;
    const positions=new Map<string,DOMRect>();
    document.querySelectorAll<HTMLElement>('[data-card-id]').forEach(el=>positions.set(el.dataset.cardId!,el.getBoundingClientRect()));
    document.querySelectorAll<HTMLElement>('[data-player-zone]').forEach(el=>positions.set(`zone:${el.dataset.playerZone}`,el.getBoundingClientRect()));
    previousPositions.current=positions;
    const id=event?.id??null;
    if(seen.current===undefined){seen.current=id;return;} // No replay on resume or remount.
    if(seen.current===id){
      // CHOP/recycling can remove the destination before the flight finishes.
      // Cancel the cosmetic copy immediately rather than duplicate a card now in hand.
      if(activeTarget.current&&!activeTarget.current.isConnected)dispose.current?.();
      return;
    }
    seen.current=id;dispose.current?.();
    const node=fly.current;
    if(!event||!node||typeof node.animate!=='function')return;
    const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if(media?.matches)return;
    const target=Array.from(document.querySelectorAll<HTMLElement>('[data-last-discard]')).find(el=>el.dataset.lastDiscard===id);
    const hub=document.querySelector<HTMLElement>('[data-discard-hub]');
    if(!target||!hub)return;
    const source=(event.sourceCardId?prior.get(event.sourceCardId):null)??prior.get(`zone:${event.playerId}`)??hub.getBoundingClientRect();
    const destination=target.getBoundingClientRect();
    const width=node.offsetWidth,height=node.offsetHeight;
    const sourceScale=Math.min(1,(event.sourceCardId?source.width:40)/width);
    const x=source.left+source.width/2-width*sourceScale/2,y=source.top+Math.min(source.height/2,55)-height*sourceScale/2;
    const dx=destination.left-x,dy=destination.top-y;
    const root=hub.closest<HTMLElement>('[data-game-root]');
    const special=event.kind!=='discard';
    const duration=special?ROUND_CELEBRATION_MS:230;
    const delay=Math.max(0,Number(root?.dataset.drawUntil??0)-Date.now());
    const center={left:0,top:0,width:window.innerWidth,height:window.innerHeight};
    const cx=Math.max(8,Math.min(window.innerWidth-width-8,center.left+center.width/2-width/2))-x;
    const cy=Math.max(48,Math.min(window.innerHeight-height-60,center.top+center.height/2-height/2))-y;
    node.style.left=`${x}px`;node.style.top=`${y}px`;node.style.visibility='visible';
    target.style.visibility='hidden';activeTarget.current=target;
    if(root)root.dataset.discardAnimating=event.kind;
    const animations:Animation[]=[];
    let ended=false;
    const finish=()=>{
      if(ended)return;ended=true;
      node.style.visibility='hidden';target.style.visibility='';
      if(activeTarget.current===target)activeTarget.current=null;
      if(root)delete root.dataset.discardAnimating;
      if(announcement.current)announcement.current.style.visibility='hidden';
      animations.forEach(a=>a.cancel());media?.removeEventListener?.('change',finish);window.clearTimeout(timer);
    };
    const end={transform:`translate(${dx}px,${dy}px) rotate(0deg) scale(${destination.width/width})`};
    const animation=node.animate(special?[
      {transform:`translate(0,0) rotate(-7deg) scale(${sourceScale})`},
      {transform:`translate(${cx}px,${cy}px) rotate(0deg) scale(1)`,offset:.16},
      {transform:`translate(${cx}px,${cy}px) rotate(0deg) scale(1)`,offset:.84},
      {transform:`translate(${cx}px,${cy}px) rotate(0deg) scale(1)`},
    ]:[{transform:'translate(0,0) rotate(-7deg) scale(1)'},{transform:`translate(${dx*.55}px,${dy*.45-35}px) rotate(4deg) scale(1.08)`,offset:.55},end],
      {duration,delay,easing:'cubic-bezier(.2,.7,.3,1)',fill:'both'});
    animations.push(animation);
    if(special&&announcement.current){
      const banner=announcement.current;banner.style.left='0px';banner.style.top=`${Math.max(8,window.innerHeight/2-height/2-90)}px`;banner.style.width=`${window.innerWidth}px`;banner.style.visibility='visible';
      banner.querySelectorAll('span').forEach((star,index)=>animations.push(star.animate([{opacity:0,transform:'scale(.4)'},{opacity:1,transform:'scale(1.4)',offset:.4},{opacity:0,transform:`translate(${index?8:-8}px,-16px) rotate(35deg) scale(.5)`}],{duration,fill:'forwards'})));
      animations.push(banner.animate([{opacity:0,transform:'translateY(12px) scale(.8)'},{opacity:1,transform:'translateY(0) scale(1)',offset:.3},{opacity:0,transform:'translateY(-18px) scale(1.03)'}],{duration,fill:'forwards'}));
    }
    const timer=window.setTimeout(finish,duration+delay+100);
    animation.finished?.then(finish,finish);
    media?.addEventListener?.('change',finish);dispose.current=finish;
  });
  if(!hydrated)return null;
  return createPortal(<>
    <div ref={fly} data-discard-flight={event?.kind} className="discard-flight" aria-hidden="true">
      <CardView card={event?.card??BACK} faceDown={!event||event.kind==='RS'} />
      {event?.kind==='RS'&&<span className="rs-flight-label">RS</span>}
    </div>
    <div ref={announcement} data-rj-announcement data-round-announcement={event?.kind} className="rj-announcement" aria-hidden="true"><span>{event?.kind==='RJ'?'✦':''}</span> {event?.kind==='RS'?'RS':'RJ'} <span>{event?.kind==='RJ'?'✧ ✦':''}</span></div>
  </>,document.body);
}
