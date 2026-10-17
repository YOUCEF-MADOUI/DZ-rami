'use client';
import type { CSSProperties } from 'react';
/** Receives only a count: no private card ID, rank, suit, image, or data attribute. */
export default function OpponentHand({count,name}:{count:number;name:string}) {
  return <div data-opponent-hand role="img" aria-label={`${name} : ${count} cartes face cachée`} className="opponent-hand" style={{'--hand-span':`${32+Math.max(0,count-1)*7}px`} as CSSProperties}>
    {Array.from({length:count},(_,index)=><span key={index} aria-hidden="true" className="opponent-card-back" style={{'--card-progress':count>1?index/(count-1):0} as CSSProperties}/>)}
  </div>;
}
