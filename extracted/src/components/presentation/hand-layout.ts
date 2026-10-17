import { GameCard } from '@/game/core/types';
import { detectHandGroups, DetectedGroup } from '@/game/core/hand-groups';

export const HAND_ADVANCE = 0.30;
// A group boundary overlaps by half a card; it is not an empty gap.
export const GROUP_BOUNDARY_ADVANCE = 0.50;

export interface HandSegment { ids: string[]; start: number; end: number; colorIndex: number; locked: boolean; }
/** Coordinates are in card-width units, shared by cards, bands and insertion geometry. */
export function handLayout(cards: readonly GameCard[], lockedSets: readonly string[][], hints?: readonly DetectedGroup[]) {
  const groups = hints ?? detectHandGroups([...cards]);
  const segments: HandSegment[] = [];
  const occupied = new Set<string>();
  for (const ids of lockedSets) {
    const indexes = ids.map(id => cards.findIndex(c => c.id === id)).sort((a,b)=>a-b);
    if (indexes.length < 2 || indexes.some((v,i)=>v<0 || (i>0 && v!==indexes[i-1]+1))) continue;
    if (ids.some(id=>occupied.has(id))) continue;
    ids.forEach(id=>occupied.add(id));
    segments.push({ids: indexes.map(i=>cards[i].id),start:indexes[0],end:indexes.at(-1)!,locked:true,
      colorIndex:groups.find(g=>g.cardIds.some(id=>ids.includes(id)))?.colorIndex ?? 0});
  }
  for (const group of groups) {
    if (group.cardIds.some(id=>occupied.has(id))) continue;
    const start=cards.findIndex(c=>c.id===group.cardIds[0]);
    if (start<0) continue;
    segments.push({ids:group.cardIds,start,end:start+group.cardIds.length-1,colorIndex:group.colorIndex,locked:false});
  }
  segments.sort((a,b)=>a.start-b.start);
  const owner=cards.map((_,i)=>segments.findIndex(g=>i>=g.start&&i<=g.end));
  const offsets:number[]=[];
  cards.forEach((_,i)=>{
    const boundary=i>0 && owner[i]!==owner[i-1] && (owner[i]>=0 || owner[i-1]>=0);
    offsets.push(i===0 ? 0 : offsets[i-1] + (boundary ? GROUP_BOUNDARY_ADVANCE : HAND_ADVANCE));
  });
  return {offsets,segments,width:cards.length ? offsets.at(-1)!+1 : 1};
}

export function insertionFromOffsets(x: number, offsets: readonly number[], width: number) {
  for(let i=0;i<offsets.length;i++) {
    const advance=i+1<offsets.length ? offsets[i+1]-offsets[i] : HAND_ADVANCE;
    if(x < (offsets[i]+advance/2)*width) return i;
  }
  return offsets.length;
}
