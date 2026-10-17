'use client';
import type {CSSProperties} from 'react';
import {GameCard} from '@/game/core/types';
import {discardFractions} from './presentation/table-motion';
import CardView from './CardView';
export default function DiscardSpread({cards,eventId,faceDown,canChop,onChop,onInspect}:{cards:GameCard[];eventId?:string;faceDown:boolean;canChop:boolean;onChop:()=>void;onInspect:()=>void}){
 const positions=discardFractions(cards.length,cards.map(c=>c.id));
 const offset=(fraction:number,dimension:'width'|'height')=>`calc(min(18px, max(0px, (100% - var(--card-small-${dimension})) / 2)) + max(0px, 100% - var(--card-small-${dimension}) - 36px) * ${fraction})`;
 return <div className="discard-surface" data-discard-zone="true">
  <button type="button" className="absolute inset-0" aria-label={`Ouvrir la défausse, ${cards.length} cartes`} onClick={onInspect}>
    {!cards.length&&<span className="text-white/40 text-xs">Défausse · vide</span>}
  </button>
  {cards.map((card,i)=>{const last=i===cards.length-1;return <div key={card.id} data-discard-latest={last?true:undefined} data-last-discard={last?eventId:undefined}
    className="discard-spread-card" style={{left:offset(positions[i].x,'width'),top:offset(positions[i].y,'height'),zIndex:i+1,'--discard-angle':`${last?0:positions[i].angle}deg`} as CSSProperties}>
    <CardView card={card} small faceDown={last&&faceDown} highlight={last} onClick={last&&canChop?onChop:onInspect}/>
  </div>})}
  {!!cards.length&&<span className="absolute bottom-1 right-1 text-[9px] font-bold text-amber-200 bg-slate-950/80 px-1 pointer-events-none z-[200]">DERNIÈRE</span>}
 </div>;
}
