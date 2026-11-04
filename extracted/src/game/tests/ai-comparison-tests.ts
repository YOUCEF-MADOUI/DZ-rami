import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, GameState } from '../core/types';
import { createInitialGameState, performDrawing, startNewRound, setTransitionAuditor } from '../core/engine';
import { assertDeckIntegrity } from '../core/deck-integrity';
import { executeAITurn } from '../ai/ai-player';
function rng(seed:number){let v=seed;return ()=>{v+=0x6D2B79F5;let t=v;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
const results=[];
for(const difficulty of ['normal','hard'] as const){
  let games=0,finished=0,turns=0,openings=0,withOpening=0,firstTotal=0,states=0,seats=0;
  const started=Date.now();
  for(const count of [2,3,4,5] as const)for(let seed=1;seed<=25;seed++){
    const random=Math.random;Math.random=rng(count*10000+seed);
    try {
      setTransitionAuditor(state=>{
        assertDeckIntegrity(state);states++;
        for(const player of state.players)if(player.status==='opened'){
          assert(player.openingValue!>=state.initialThreshold,'Illegal natural opening');
          assert(player.openingTotal!>=player.openingSuiteThreshold!,'Illegal total opening');
        }
      });
      let state:GameState=startNewRound(performDrawing(createInitialGameState({...DEFAULT_CONFIG,playerCount:count,aiDifficulty:difficulty},Array.from({length:count},(_,i)=>`AI${i}`))));
      state={...state,players:state.players.map(p=>({...p,isAI:true}))};
      let first=0;
      for(let t=1;t<=800&&state.phase==='playing';t++){
        const previous=state.currentPlayerIndex;
        state=executeAITurn(state);turns++;
        assert(state.phase!=='playing'||state.currentPlayerIndex!==previous,'Blocked AI turn');
        if(!first&&state.players.some(p=>p.status==='opened'))first=t;
      }
      if(first){withOpening++;firstTotal+=first;}
      openings+=state.players.filter(p=>p.status==='opened').length;
      if(state.phase!=='playing')finished++;
      games++;seats+=count;
    } finally {Math.random=random;setTransitionAuditor();}
  }
  results.push({difficulty,games,seats,legalOpenings:openings,openingFrequency:openings/seats,gamesWithOpening:withOpening,
    meanTurnsToFirstOpening:withOpening?firstTotal/withOpening:null,finished,capped:games-finished,blocked:0,ruleViolations:0,turns,auditedStates:states,seconds:(Date.now()-started)/1000});
}
assert(results[1].legalOpenings>=results[0].legalOpenings,'Hard opening frequency regressed');
console.log('AI comparison (same 100 seeds/deals per mode, default options, 800-turn cap):');
console.log(JSON.stringify(results,null,2));
