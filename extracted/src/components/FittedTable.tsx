'use client';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Fit public melds and the opening draft together without changing game state. */
export default function FittedTable({children}:{children:ReactNode}) {
  const viewport=useRef<HTMLDivElement>(null);
  const content=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const box=viewport.current, inner=content.current;
    if(!box||!inner)return;
    const fit=()=>{
      if(!box.clientWidth||!box.clientHeight)return;
      const measure=(scale:number)=>{
        inner.style.width=`${100/scale}%`;
        inner.style.transform=`scale(${scale})`;
        return inner.scrollHeight*scale<=box.clientHeight && inner.scrollWidth*scale<=box.clientWidth+1;
      };
      if(measure(1))return;
      let low=.01,high=1;
      for(let i=0;i<14;i++){
        const mid=(low+high)/2;
        if(measure(mid))low=mid;else high=mid;
      }
      measure(low);
    };
    fit();
    if(typeof ResizeObserver==='undefined'){
      window.addEventListener('resize',fit);
      return ()=>window.removeEventListener('resize',fit);
    }
    const observer=new ResizeObserver(fit);
    observer.observe(box);
    return ()=>observer.disconnect();
  },[children]);
  return <div ref={viewport} className="public-play-area"><div ref={content} className="fitted-table-content">{children}</div></div>;
}
