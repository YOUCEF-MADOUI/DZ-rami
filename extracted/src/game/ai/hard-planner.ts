import { openingRequirements } from '../core/team-rules';
import { Combination, GameCard, GameState, RANK_ORDER } from '../core/types';
import { validateOpening } from '../core/engine';
import { applyJokerPlacement, calculateCombinationValue, detectCombinationType, determineTierceSequence, getJokerCount, resolveJokerPlacement, validateCombination } from '../core/validation';

interface Candidate { combo: Combination; mask: number; natural: number; total: number; tierce: boolean; }
interface Plan { mask:number; natural:number; total:number; tierce:boolean; melds:Combination[]; }
/** Enumerate physical subsets (3–5 cards), then solve disjoint meld packing with a Pareto frontier. */
function searchHardPlan(hand: GameCard[], state: GameState) {
  if (hand.length > 20) return null; // Defensive bound; a normal turn has at most 15 physical cards.
  const player=state.players[state.currentPlayerIndex];
  const candidates:Candidate[]=[];
  function choose(start:number, picked:GameCard[], mask:number) {
    if(picked.length>=3){
      const naturals=picked.filter(c=>!c.isJoker);
      // Cheap necessary conditions avoid invoking the full validator on unrelated subsets.
      if(getJokerCount(picked)<=1 && (new Set(naturals.map(c=>c.rank)).size===1 || new Set(naturals.map(c=>c.suit)).size===1)) {
        const type=detectCombinationType(picked);
        if(type){
          const base:Combination={id:`plan-${mask}`,ownerId:player.id,type,cards:[...picked]};
          const variants:Combination[]=[];
          const joker=picked.find(c=>c.isJoker);
          if(type==='tierce'&&joker){
            // Explore both Ace orientations and every explicit Joker slot; no low-end bias.
            for(const highAce of [false,true]){
              const sorted=[...naturals].sort((a,b)=>(a.rank==='A'&&highAce?14:RANK_ORDER[a.rank])-(b.rank==='A'&&highAce?14:RANK_ORDER[b.rank]));
              for(let slot=0;slot<=sorted.length;slot++){
                const cards=[...sorted.slice(0,slot),joker,...sorted.slice(slot)];
                const placement=resolveJokerPlacement(cards,type);
                if(!placement)continue;
                const variant=applyJokerPlacement({...base,cards,jokerPlacement:placement});
                if(validateCombination(variant).valid)variants.push(variant);
              }
            }
          }else{
            const sequence=type==='tierce'?determineTierceSequence(base):null;
            variants.push({...base,cards:sequence?[...sequence].sort((a,b)=>a.position-b.position).map(p=>p.card!):base.cards});
          }
          for(const combo of variants){
            const value=calculateCombinationValue(combo);
            candidates.push({combo,mask,natural:value.vierge,total:value.total,tierce:type==='tierce'&&!getJokerCount(picked)});
          }
        }
      }
    }
    if(picked.length===5)return;
    for(let i=start;i<hand.length;i++)choose(i+1,[...picked,hand[i]],mask|(1<<i));
  }
  choose(0,[],0);
  const full=(1<<hand.length)-1;
  const frontiers=new Map<number,Plan[]>();
  const queue:Plan[]=[{mask:0,natural:0,total:0,tierce:false,melds:[]}];
  frontiers.set(0,[queue[0]]);
  let best=queue[0],bestScore=-Infinity,bestCanOpen=false;
  const mandatory=state.turnState?.mandatoryChopCardId;
  for(let cursor=0;cursor<queue.length;cursor++) {
    const plan=queue[cursor];
    if(!frontiers.get(plan.mask)?.includes(plan))continue;
    const remaining=hand.filter((_,i)=>!(plan.mask&(1<<i)));
    const canOpen=plan.melds.length>0 && validateOpening(state,player.id,plan.melds,remaining).valid &&
      (!mandatory||plan.melds.some(c=>c.cards.some(card=>card.id===mandatory)));
    // Legal opening first, then fewer cards left; preserve useful connected leftovers.
    const score=(canOpen&&player.status==='not_opened'?1e6:0)+(hand.length-remaining.length)*1000+plan.natural*2+plan.total+futurePotential(remaining);
    if(score>bestScore){best=plan;bestScore=score;bestCanOpen=canOpen;}
    for(const candidate of candidates){
      if(plan.mask&candidate.mask)continue;
      const mask=plan.mask|candidate.mask;
      if(mask===full)continue; // Always keep a physical card for the final discard.
      const next:Plan={mask,natural:plan.natural+candidate.natural,total:plan.total+candidate.total,
        tierce:plan.tierce||candidate.tierce,melds:[...plan.melds,candidate.combo]};
      const frontier=frontiers.get(mask)??[];
      const dominates=(a:Plan,b:Plan)=>a.natural>=b.natural&&a.total>=b.total&&Number(a.tierce)>=Number(b.tierce);
      if(frontier.some(p=>dominates(p,next)))continue;
      frontiers.set(mask,[...frontier.filter(p=>!dominates(next,p)),next]);queue.push(next);
    }
  }
  return {combos:best.melds.map(c=>({cards:c.cards,type:c.type})),canOpen:bestCanOpen};
}

/** One-step potential of the retained hand: pairs and near-runs, not imaginary extra cards. */
export function futurePotential(cards: GameCard[]): number {
  const rank=(r:string)=>['A','2','3','4','5','6','7','8','9','10','J','Q','K'].indexOf(r)+1;
  let value=cards.filter(c=>c.isJoker).length*12;
  for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++){
    const a=cards[i],b=cards[j];if(a.isJoker||b.isJoker)continue;
    if(a.rank===b.rank&&a.suit!==b.suit)value+=8;
    if(a.suit===b.suit){const d=Math.abs(rank(a.rank)-rank(b.rank));if(d===1||d===12)value+=6;else if(d===2||d===11)value+=2;}
  }
  return value;
}

// Cache only plan indices, never physical cards or mutable GameState objects.
// Repeated CHOP positions can revisit the same hand many times.
const planCache=new Map<string,{groups:{indices:number[];type:Combination['type']}[]}>();
export function findHardPlan(hand:GameCard[],state:GameState) {
  const player=state.players[state.currentPlayerIndex];
  const key=JSON.stringify([player.id,player.status,openingRequirements(state,player.id),state.initialThreshold,state.suite,state.config.tierceObligatoire,
    state.turnState?.mandatoryChopCardId,hand.map(c=>[c.id,c.isJoker?'joker':`${c.rank}:${c.suit}`])]);
  const cached=planCache.get(key);
  if(cached){
    const combos=cached.groups.map(g=>({type:g.type,cards:g.indices.map(i=>hand[i])}));
    const used=new Set(combos.flatMap(c=>c.cards.map(c=>c.id)));
    const valid=validateOpening(state,player.id,combos.map((c,i)=>applyJokerPlacement({...c,id:`cached-${i}`,ownerId:player.id})),hand.filter(c=>!used.has(c.id))).valid;
    const mandatory=state.turnState?.mandatoryChopCardId;
    return {combos,canOpen:valid&&(!mandatory||used.has(mandatory))};
  }
  const result=searchHardPlan(hand,state);
  if(result){
    if(planCache.size>=256)planCache.delete(planCache.keys().next().value!);
    planCache.set(key,{groups:result.combos.map(c=>({type:c.type,indices:c.cards.map(card=>hand.findIndex(h=>h.id===card.id))}))});
  }
  return result;
}
