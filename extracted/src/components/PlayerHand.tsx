'use client';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { GameCard } from '@/game/core/types';
import { DetectedGroup, getDragBlock, GROUP_COLORS, moveBlock } from '@/game/core/hand-groups';
import { handLayout, insertionFromOffsets } from './presentation/hand-layout';
import CardView from './CardView';
export type SortMode = 'manual' | 'suit' | 'rank';
interface Props {
  cards: GameCard[]; selectedCards: string[]; groups: DetectedGroup[];
  lockedSetForCard?: (cardId: string) => string[] | null;
  onUnlockSet?: (cardId: string) => void; onLockGroup?: (cardIds: string[]) => void;
  onSelectCard: (cardId: string) => void; onSelectGroup: (cardIds: string[]) => void;
  disabled?: boolean; sortMode: SortMode; onSortChange: (mode: SortMode) => void;
  onReorder: (blockIds: string[], toIndex: number) => void;
  onCardDragStart?: (cardId: string) => void; onCardDragEnd?: () => void;
  onTouchDrop?: (cardId: string, clientX: number, clientY: number) => boolean;
}
interface Gesture {
  pointerId:number; cardId:string; block:string[]; original:string[]; offsets:number[];
  x:number; y:number; startX:number; startY:number; offsetX:number; offsetY:number;
  width:number; height:number; active:boolean; inHand:boolean; marginLeft:number;
}
export default function PlayerHand({cards,selectedCards,groups,lockedSetForCard,onUnlockSet,onLockGroup,
  onSelectCard,onSelectGroup,disabled,sortMode,onSortChange,onReorder,onCardDragStart,onCardDragEnd,onTouchDrop}:Props) {
  const containerRef=useRef<HTMLDivElement>(null);
  const gesture=useRef<Gesture|null>(null);
  const suppressClick=useRef(false);
  const frame=useRef<number|null>(null);
  const [preview,setPreview]=useState<Gesture|null>(null);
  const [destination,setDestination]=useState<number|null>(null);
  const lockedSets=cards.map(c=>lockedSetForCard?.(c.id)).filter((s):s is string[]=>!!s);
  const baseLayout=handLayout(cards,lockedSets,groups);
  const projectedIds=preview?.active && destination!==null ? moveBlock(cards.map(c=>c.id),preview.block,destination) : cards.map(c=>c.id);
  const byId=new Map(cards.map(c=>[c.id,c]));
  const projected=projectedIds.map(id=>byId.get(id)).filter((c):c is GameCard=>!!c);
  const layout=preview?.active ? handLayout(projected,lockedSets) : baseLayout;
  const insertionAt=(x:number)=>{
    const element=containerRef.current!, rect=element.getBoundingClientRect();
    const current=gesture.current!;
    const track=element.querySelector<HTMLElement>('.hand-track')!;
    return insertionFromOffsets(x-track.getBoundingClientRect().left,current.offsets,current.width);
  };
  const clearGesture=()=>{
    if(frame.current!==null) cancelAnimationFrame(frame.current);
    frame.current=null; gesture.current=null; setPreview(null); setDestination(null); onCardDragEnd?.();
  };
  const cancelRef=useRef(clearGesture);
  useEffect(()=>{cancelRef.current=clearGesture;});
  useEffect(()=>{
    const cancel=(event:KeyboardEvent)=>{if(event.key==='Escape') cancelRef.current();};
    window.addEventListener('keydown',cancel);
    const blur=()=>cancelRef.current();window.addEventListener('blur',blur);window.addEventListener('resize',blur);
    return ()=>{if(frame.current!==null) cancelAnimationFrame(frame.current);window.removeEventListener('keydown',cancel);window.removeEventListener('blur',blur);window.removeEventListener('resize',blur);};
  },[]);
  const select=(id:string)=>{
    if(disabled) return;
    const locked=lockedSetForCard?.(id);
    if(locked) onSelectGroup(locked); else onSelectCard(id);
  };
  const pointerDown=(event:ReactPointerEvent<HTMLDivElement>,card:GameCard)=>{
    if(event.button!==0 || gesture.current) return;
    suppressClick.current=false;
    const rect=event.currentTarget.getBoundingClientRect();
    const container=containerRef.current!,track=container.querySelector<HTMLElement>('.hand-track')!;
    const marginLeft=track.getBoundingClientRect().left-container.getBoundingClientRect().left+container.scrollLeft-parseFloat(getComputedStyle(container).paddingLeft);
    gesture.current={pointerId:event.pointerId,cardId:card.id,block:getDragBlock(card.id,lockedSetForCard?.(card.id)??null),
      original:cards.map(c=>c.id),offsets:baseLayout.offsets,marginLeft,x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,
      offsetX:event.clientX-rect.left,offsetY:event.clientY-rect.top,width:rect.width,
      height:event.currentTarget.querySelector('.card')!.getBoundingClientRect().height,active:false,inHand:true};
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const autoScroll=()=>{
    const current=gesture.current,element=containerRef.current;
    if(!current?.active||!element)return;
    const rect=element.getBoundingClientRect();
    if(current.y>=rect.top&&current.y<=rect.bottom){
      const speed=current.x<rect.left+28?-10:current.x>rect.right-28?10:0;
      if(speed){element.scrollLeft+=speed;setDestination(insertionAt(current.x));}
    }
    frame.current=requestAnimationFrame(autoScroll);
  };
  const pointerMove=(event:ReactPointerEvent<HTMLDivElement>)=>{
    const current=gesture.current;
    if(!current||current.pointerId!==event.pointerId)return;
    current.x=event.clientX;current.y=event.clientY;
    const bounds=containerRef.current!.getBoundingClientRect();
    current.inHand=current.x>=bounds.left&&current.x<=bounds.right&&current.y>=bounds.top&&current.y<=bounds.bottom;
    if(!current.active&&Math.hypot(current.x-current.startX,current.y-current.startY)<5)return;
    event.preventDefault();
    if(!current.active){current.active=true;suppressClick.current=true;onCardDragStart?.(current.cardId);frame.current=requestAnimationFrame(autoScroll);}
    setPreview({...current});setDestination(insertionAt(current.x));
  };
  const pointerUp=(event:ReactPointerEvent<HTMLDivElement>,cancelled=false)=>{
    const current=gesture.current;
    if(!current||current.pointerId!==event.pointerId)return;
    // A changing hand (draw, reset...) invalidates the geometry captured at pickup.
    const unchanged=current.original.join('|')===cards.map(c=>c.id).join('|');
    if(current.active&&!cancelled&&unchanged){
      const rect=containerRef.current!.getBoundingClientRect();
      const inside=event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom;
      if(inside)onReorder(current.block,insertionAt(event.clientX));
      else if(!disabled&&current.block.length===1)onTouchDrop?.(current.cardId,event.clientX,event.clientY);
    }
    clearGesture();
  };
  return <div className="hand-layout flex flex-col">
    <div className="hand-sortbar flex gap-1 px-2 py-1 bg-slate-900/30 border-b border-slate-700/50 items-center overflow-x-auto">
      <span className="text-[10px] text-slate-500 mr-1">TRIER:</span>
      {(['suit','rank'] as const).map(mode=><button key={mode} onClick={()=>onSortChange(mode)} className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${sortMode===mode?'bg-amber-500 text-white':'bg-slate-700 text-slate-300'}`}>{mode==='suit'?'♠♥♦♣ Couleur':'🃏 A→K Valeur'}</button>)}
      {sortMode==='manual'&&<span className="text-[10px] text-amber-400 ml-1">Manuel</span>}
      {groups.length>0&&<span className="text-[10px] text-green-400 ml-auto whitespace-nowrap">{groups.length} combinaison{groups.length>1?'s':''} détectée{groups.length>1?'s':''}</span>}
    </div>
    <div ref={containerRef} className="hand-fan relative"
      onPointerDownCapture={()=>{if(!gesture.current)suppressClick.current=false;}}
      onClickCapture={event=>{if(suppressClick.current&&event.detail!==0){event.stopPropagation();event.preventDefault();suppressClick.current=false;}}}
      onDragStart={event=>event.preventDefault()}>
      <div className="hand-track" style={{width:`calc(var(--card-width) * ${Math.max(baseLayout.width,layout.width)})`,...(preview?.active?{marginLeft:preview.marginLeft,marginRight:0}:{})}}>
        {cards.map(card=>{
          const index=projectedIds.indexOf(card.id);
          const segment=layout.segments.find(g=>index>=g.start&&index<=g.end);
          const groupColor=segment?GROUP_COLORS[segment.colorIndex%GROUP_COLORS.length].band:undefined;
          const moving=!!preview?.active&&preview.block.includes(card.id);
          const hidden=moving&&!preview?.inHand;
          return <div key={card.id} data-card-id={card.id} data-ci={index} data-locked={!!lockedSetForCard?.(card.id)} data-hand-inserted={moving&&preview?.inHand ? true : undefined}
            className="hand-slot" style={{left:`calc(var(--card-width) * ${layout.offsets[index]??0})`,zIndex:index+1}}
            onPointerDown={event=>pointerDown(event,card)} onPointerMove={pointerMove} onPointerUp={event=>pointerUp(event)}
            onPointerCancel={event=>pointerUp(event,true)} onLostPointerCapture={()=>{if(gesture.current)clearGesture();}}
            onClick={()=>select(card.id)}>
            <div style={{visibility:hidden?'hidden':'visible'}}>
              <CardView card={card} groupColor={groupColor} selected={!moving&&selectedCards.includes(card.id)} disabled={disabled} onClick={()=>select(card.id)} stopPropagationOnClick />
            </div>
          </div>;
        })}
        {layout.segments.map(segment=>{
          const left=layout.offsets[segment.start];
          const nextGroup=layout.segments.find(g=>g.start>segment.end);
          // Shared card edges may overlap, but the controls below them must not.
          const right=Math.min(layout.offsets[segment.end]+1,nextGroup?layout.offsets[nextGroup.start]:Infinity);
          const width=right-left;
          const color=GROUP_COLORS[segment.colorIndex%GROUP_COLORS.length].band;
          return <div key={segment.ids.join('|')} data-hand-group={segment.ids.join('|')} className="hand-group"
            style={{left:`calc(var(--card-width) * ${left})`,width:`calc(var(--card-width) * ${width})`}}>
            <button type="button" data-group-select title="Sélectionner cette combinaison" aria-label="Sélectionner cette combinaison"
              disabled={disabled||!!preview} onClick={()=>onSelectGroup(segment.ids)} style={{color}} className="hand-group-select">Sélectionner</button>
            <button type="button" title={segment.locked?'Déverrouiller ces cartes':'Verrouiller cette combinaison'}
              onClick={()=>segment.locked?onUnlockSet?.(segment.ids[0]):onLockGroup?.(segment.ids)}
              className="hand-lock-control" style={{left:`calc(var(--card-width) * ${(layout.offsets[segment.end]-left+1)/2})`}} disabled={!!preview}>
              {segment.locked?<svg aria-label="Groupe verrouillé" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/></svg>:<span aria-hidden="true">⌄</span>}
            </button>
          </div>;
        })}
      </div>
    </div>
    {preview&&!preview.inHand&&createPortal(<div data-hand-drag-preview aria-hidden="true" style={{position:'fixed',left:preview.x-preview.offsetX,top:preview.y-preview.offsetY,zIndex:2147483647,pointerEvents:'none',display:'flex',gap:4,'--card-width':`${preview.width}px`,'--card-height':`${preview.height}px`} as CSSProperties}>
      {preview.block.map(id=>byId.get(id)).filter((c):c is GameCard=>!!c).map(card=><CardView key={card.id} card={card} groupColor={(()=>{const i=projectedIds.indexOf(card.id);const g=layout.segments.find(s=>i>=s.start&&i<=s.end);return g?GROUP_COLORS[g.colorIndex%GROUP_COLORS.length].band:undefined;})()}/>)}
    </div>,document.body)}
  </div>;
}
