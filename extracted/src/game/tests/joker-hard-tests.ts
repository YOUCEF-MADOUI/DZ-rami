import assert from 'node:assert/strict';
import { createDeck } from '../core/deck';
import { DEFAULT_CONFIG, GameState, GameCard, Combination, Rank, Suit } from '../core/types';
import { createInitialGameState, startNewRound, addToCombination, getJokerAdditionChoices } from '../core/engine';
import { assertDeckIntegrity } from '../core/deck-integrity';
import { executeAITurn } from '../ai/ai-player';
import { findHardPlan } from '../ai/hard-planner';
const deck=createDeck();
const card=(rank:Rank,suit:Suit)=>deck.find(c=>!c.isJoker&&c.rank===rank&&c.suit===suit&&c.pack===1)!;
const wild=deck.find(c=>c.isJoker)!;
function state(hand:GameCard[],table:Combination[]=[],opened=true):GameState {
 const s=startNewRound(createInitialGameState({...DEFAULT_CONFIG,playerCount:5},['P0','P1','P2','P3','P4']));
 const used=new Set([...hand,...table.flatMap(c=>c.cards)].map(c=>c.id));
 return {...s,deck:deck.filter(c=>!used.has(c.id)),tableCombinations:table,
   players:s.players.map((p,i)=>({...p,isAI:true,status:opened?'opened':'not_opened',hand:i===0?hand:[]}))};
}
let count=0;function test(name:string,fn:()=>void){fn();count++;console.log(`✅ ${name}`);}
const run=(ranks:Rank[]):Combination=>({id:'run',ownerId:'player-0',type:'tierce',cards:ranks.map(r=>card(r,'hearts'))});
test('Existing 8-7-6 run proposes 9 and 5 without mutation; each choice commits the exact slot',()=>{
 const initial=state([wild,card('2','clubs')],[run(['8','7','6'])]);const before=JSON.stringify(initial);
 const choices=getJokerAdditionChoices(initial,wild.id,'run');
 assert.deepEqual(choices.map(c=>[c.rank,c.valid]),[['9',true],['5',true]]);
 assert.equal(JSON.stringify(initial),before);
 assert.equal(addToCombination(initial,wild.id,'run'),initial,'No implicit choice');
 for(const [side,rank,index] of [['higher','9',0],['lower','5',3]] as const){
   const after=addToCombination(initial,wild.id,'run',side);assertDeckIntegrity(after);
   assert.equal(after.tableCombinations[0].jokerPlacement?.represents.rank,rank);
   assert.equal(after.tableCombinations[0].jokerPlacement?.position,index);
   assert.equal(after.tableCombinations[0].cards[index].id,wild.id);
 }
 assert.equal(JSON.stringify(initial),before,'Original remains intact for cancellation');
});
test('Ace-low and Ace-high disable only their forbidden Joker end',()=>{
 for(const [ranks,validSide,rank] of [[['A','2','3'],'higher','4'],[['Q','K','A'],'lower','J']] as const){
  const initial=state([wild,card('2','clubs')],[run([...ranks])]);
  const choices=getJokerAdditionChoices(initial,wild.id,'run');
  assert.equal(choices.filter(c=>c.valid).length,1);
  assert.equal(choices.find(c=>c.valid)?.side,validSide);assert.equal(choices.find(c=>c.valid)?.rank,rank);
  const bad=choices.find(c=>!c.valid)!;assert.equal(addToCombination(initial,wild.id,'run',bad.side),initial);
 }
});
test('A second Joker and stale/out-of-turn confirmation are rejected',()=>{
 const initial=state([wild,card('2','clubs')],[run(['8','7','6'])]);
 const added=addToCombination(initial,wild.id,'run','higher');
 const stale=addToCombination(added,wild.id,'run','lower');assert.equal(stale,added);
 const other=deck.find(c=>c.id==='joker-2')!;
 const second=state([other,card('2','clubs')],added.tableCombinations);
 assert(getJokerAdditionChoices(second,other.id,'run').every(c=>!c.valid));
 assert.equal(addToCombination(second,other.id,'run','higher'),second);
 const wrong={...initial,turnState:{...initial.turnState!,phase:'must_draw' as const}};
 assert(getJokerAdditionChoices(wrong,wild.id,'run').every(c=>!c.valid));
 assert.equal(addToCombination(wrong,wild.id,'run','higher'),wrong);
});
test('Hard mode finds the legal run packing missed by greedy set-first normal mode',()=>{
 const hand=[...(['6','7','8','9','10'] as Rank[]).map(r=>card(r,'hearts')),card('8','diamonds'),card('8','spades'),card('Q','clubs'),card('K','clubs'),card('A','clubs'),card('2','spades')];
 const base=state(hand,[],false);
 const normal=executeAITurn(base);assert.equal(normal.players[0].status,'not_opened');
 const hard={...base,config:{...base.config,aiDifficulty:'hard' as const}};
 const plan=findHardPlan(hand,hard)!;assert(plan.canOpen);
 const result=executeAITurn(hard);assertDeckIntegrity(result);
 assert.equal(result.players[0].status,'opened');assert(result.players[0].openingValue!>=71);assert(result.players[0].openingTotal!>=71);
 const impossible={...hard,suite:300};assert(!findHardPlan(hand,impossible)!.canOpen);
 const refused=executeAITurn(impossible);assertDeckIntegrity(refused);assert.equal(refused.players[0].status,'not_opened');assert.equal(refused.suite,300);
});
test('Hard mode considers the higher Joker endpoint when required by SUITE',()=>{
 const hand=[...(['6','7','8','9','10'] as Rank[]).map(r=>card(r,'hearts')),card('Q','clubs'),card('K','clubs'),card('A','clubs'),card('3','hearts'),card('4','hearts'),wild,card('2','spades')];
 const base=state(hand,[],false);const hard={...base,suite:83,config:{...base.config,aiDifficulty:'hard' as const,tierceObligatoire:true}};
 assert(findHardPlan(hand,hard)!.canOpen,'71 natural + Joker run total 12 meets 83');
 const result=executeAITurn(hard);assertDeckIntegrity(result);assert.equal(result.players[0].status,'opened');assert(result.players[0].openingTotal!>=83);
 const blocked={...hard,config:{...hard.config,chopObligatoire:true},turnState:{...hard.turnState!,hasDrawn:true,isInitialDealTurn:false,drawSource:'deck' as const,chopWasAvailableAtTurnStart:true}};
 const rejected=executeAITurn(blocked);assertDeckIntegrity(rejected);assert.equal(rejected.players[0].status,'not_opened','Hard does not bypass CHOP opening prerequisite');
});
console.log(`Joker/hard strategy: ${count} scenarios passed, 0 failed`);
