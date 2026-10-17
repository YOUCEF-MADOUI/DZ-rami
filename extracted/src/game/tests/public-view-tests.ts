import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, GameState, GameCard, Combination } from '../core/types';
import { createInitialGameState,startNewRound,discard,drawCard,placeCombination } from '../core/engine';
import { createDeck } from '../core/deck';
import { projectPlayerView } from '../core/public-view';
import { assertDeckIntegrity } from '../core/deck-integrity';
import { makeAIDecision } from '../ai/ai-player';
let tests=0;function test(name:string,fn:()=>void){fn();tests++;console.log(`✅ ${name}`);}
for(const count of [2,3,4,5] as const)test(`${count} players: public projection contains counts, never foreign hands/deck/snapshots`,()=>{
 const state=startNewRound(createInitialGameState({...DEFAULT_CONFIG,playerCount:count},Array.from({length:count},(_,i)=>`P${i}`)));
 for(const viewer of state.players){
   const view=projectPlayerView(state,viewer.id),text=JSON.stringify(view);
   assert.deepEqual(view.localHand,viewer.hand);
   for(const opponent of state.players.filter(p=>p.id!==viewer.id)){
     assert.equal(view.players.find(p=>p.id===opponent.id)!.handCount,opponent.hand.length);
     for(const card of opponent.hand)assert(!text.includes(`"${card.id}"`));
   }
   assert(!('deck' in view));assert(!('actionHistory' in view));assert(!('lastCompletedTurnActionsByPlayer' in view));assert(!('hand' in view.players[0]));
 }
});
function scenario():GameState {
 const deck=createDeck(),cards=deck.filter(c=>!c.isJoker&&c.suit==='hearts'&&c.pack===1&&['Q','K','A'].includes(c.rank));
 const spare=deck.find(c=>!c.isJoker&&c.rank==='2'&&c.suit==='spades')!;
 const used=new Set([...cards,spare].map(c=>c.id));let state=startNewRound(createInitialGameState({...DEFAULT_CONFIG,playerCount:4,variant:'teams'},['S','E','N','W']));
 state={...state,currentPlayerIndex:1,players:state.players.map((p,i)=>({...p,isAI:true,status:'opened',hand:i===1?[...cards,spare]:[]})),deck:deck.filter(c=>!used.has(c.id)),turnState:{...state.turnState!,playerId:'player-1',phase:'must_draw',isInitialDealTurn:false}};return state;
}
test('Opponent count follows draw, public pose and discard; only the meld becomes visible',()=>{
 let state=scenario();assert.equal(projectPlayerView(state,'player-0').players[1].handCount,4);
 state=drawCard(state);assert.equal(projectPlayerView(state,'player-0').players[1].handCount,5);
 const ids=state.players[1].hand.filter(c=>!c.isJoker&&c.suit==='hearts'&&['Q','K','A'].includes(c.rank)).map(c=>c.id);
 state=placeCombination(state,ids,'tierce');let view=projectPlayerView(state,'player-0');assert.equal(view.players[1].handCount,2);assert.deepEqual(view.tableCombinations[0].cards.map(c=>c.id),state.tableCombinations[0].cards.map(c=>c.id));
 state=discard(state,state.players[1].hand[0].id);view=projectPlayerView(state,'player-0');assert.equal(view.players[1].handCount,1);assert.equal(view.lastDiscard?.kind,'discard');assert(!JSON.stringify(view).includes(`"${state.players[1].hand[0].id}"`));
});
test('RS event/pile redact the winning card; RJ event exposes only the publicly discarded Joker',()=>{
 for(const end of ['RS','RJ'] as const){let state=scenario();
 const all=[...state.deck,...state.players.flatMap(p=>p.hand)];const last=all.find(c=>end==='RJ'?c.isJoker:!c.isJoker)!;
 state={...state,deck:all.filter(c=>c.id!==last.id),players:state.players.map((p,i)=>({...p,hand:i===1?[last]:[]})),turnState:{...state.turnState!,phase:'playing'}};
 const finished=discard(state,last.id,false),view=projectPlayerView(finished,'player-0');assert.equal(view.lastDiscard?.kind,end);
 if(end==='RS'){
 const legacy=projectPlayerView({...finished,lastCompletedTurnAction:{...finished.lastCompletedTurnAction!,endType:undefined}},'player-0');assert.equal(legacy.lastDiscard?.card,null);
 assert.equal(view.lastDiscard?.card,null);assert.equal(view.discardPile.at(-1),null);assert(!JSON.stringify(view).includes(`"${last.id}"`));}
 else assert.equal(view.lastDiscard?.card?.id,last.id);
 }
});
test('Team AI decisions do not change when hidden opponent/partner identities change',()=>{
 const state=scenario();const others=[0,2,3];
 const turn={...state,deck:state.deck.slice(9),players:state.players.map((p,i)=>i===1?p:{...p,hand:state.deck.slice(others.indexOf(i)*3,others.indexOf(i)*3+3)}),turnState:{...state.turnState!,phase:'playing' as const}};
 const changed={...turn,players:turn.players.map((p,i)=>i===1?p:{...p,hand:turn.players[others[(others.indexOf(i)+1)%3]].hand})};
 assertDeckIntegrity(turn);assertDeckIntegrity(changed);
 assert.deepEqual(makeAIDecision(turn),makeAIDecision(changed));
});
console.log(`Public view: ${tests} scenarios passed, 0 failed`);
