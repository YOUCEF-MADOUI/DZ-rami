import assert from 'node:assert/strict';
import {createInitialGameState,startNewRound,discard,drawCard,placeCombination,takeBackCombinations} from '../core/engine';
import {createDeck} from '../core/deck';
import {DEFAULT_CONFIG, GameState} from '../core/types';
import {assertDeckIntegrity} from '../core/deck-integrity';
import {saveSoloSession,loadSoloSession,SOLO_STORAGE_KEY,SoloSession} from '../core/solo-storage';
import {saveGameConfig,loadGameConfig} from '../core/config-storage';
let passed=0;function test(name:string,fn:()=>void){fn();console.log(`✅ ${name}`);passed++;}
function storage(){const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};}
const config={...DEFAULT_CONFIG,playerCount:2 as const,targetScore:100};
const session=(state:GameState):SoloSession=>({version:1,state,view:{sortMode:'manual',manualOrder:state.players[0].hand.map(c=>c.id),selectedCards:[state.players[0].hand[0].id],lockedSets:[state.players[0].hand.slice(0,3).map(c=>c.id)]}});
test('Solo save preserves physical deck, turn, hand order, selection and locks',()=>{
 const state=startNewRound(createInitialGameState(config,['Vous','Amine']));const store=storage();const original=session(state);
 assert(saveSoloSession(store,original));const restored=loadSoloSession(store)!;assert(restored);assert.deepEqual(restored,JSON.parse(JSON.stringify(original)));assertDeckIntegrity(restored.state);
 assert.equal(drawCard(restored.state),restored.state,'No 16th card after resume of starter turn');
});
test('Opening draft can still be undone after JSON restoration without stale history',()=>{
 let state=startNewRound(createInitialGameState({...DEFAULT_CONFIG,playerCount:5},['Vous','A','B','C','D']));
 const deck=createDeck();const run=deck.filter(c=>!c.isJoker&&c.suit==='hearts'&&c.pack===1&&['6','7','8'].includes(c.rank));const hand=[...run,deck.find(c=>!c.isJoker&&c.suit==='clubs'&&c.rank==='2')!];
 const ids=new Set(hand.map(c=>c.id));state={...state,players:state.players.map((p,i)=>({...p,hand:i===0?hand:[]})),deck:deck.filter(c=>!ids.has(c.id))};
 state=placeCombination(state,run.map(c=>c.id),'tierce');const store=storage();assert(saveSoloSession(store,session(state)));
 const restored=loadSoloSession(store)!.state;assert.equal(restored.turnState!.actionsThisTurn[0],restored.actionHistory[0]);
 const undone=takeBackCombinations(restored);assert.equal(undone.actionHistory.length,0);assert.equal(undone.players[0].hand.length,4);assertDeckIntegrity(undone);
});
test('Corrupt/unknown/duplicate saves are not resumed and completed games are cleared',()=>{
 const store=storage();store.setItem(SOLO_STORAGE_KEY,'bad json');assert.equal(loadSoloSession(store),null);
 const state=startNewRound(createInitialGameState(config,['Vous','Amine']));const saved=session(state);
 store.setItem(SOLO_STORAGE_KEY,JSON.stringify({...saved,version:99}));assert.equal(loadSoloSession(store),null);
 const duplicate={...state,deck:[...state.deck,state.players[0].hand[0]]};assert(!saveSoloSession(store,session(duplicate)));
 assert(saveSoloSession(store,{...saved,state:{...state,phase:'game_end'}}));assert.equal(loadSoloSession(store),null);
});
test('Configured cumulative limit ends the game only after round scoring; next round is refused',()=>{
 const deck=createDeck();const last=deck[0];let state=startNewRound(createInitialGameState(config,['Vous','Amine']));
 state={...state,players:state.players.map((p,i)=>({...p,hand:i===0?[last]:deck.slice(1,3),status:i===0?'opened':'not_opened'})),deck:deck.slice(3)};
 assertDeckIntegrity(state);const end=discard(state,last.id);assert.equal(end.phase,'game_end');assert.equal(end.players[1].score,100);assert.equal(startNewRound(end),end);assertDeckIntegrity(end);
 const unlimited=discard({...state,config:{...config,targetScore:0}},last.id);assert.equal(unlimited.phase,'round_end');
});
test('User settings, cycle count and score target survive storage; invalid bounds rejected',()=>{
 const store=storage();const cfg={...DEFAULT_CONFIG,maxCycles:4,targetScore:3000,aiDifficulty:'hard' as const};saveGameConfig(store,cfg);assert.deepEqual(loadGameConfig(store),cfg);
 saveGameConfig(store,{...cfg,maxCycles:90,targetScore:4000});const restored=loadGameConfig(store);assert.equal(restored.maxCycles,3);assert.equal(restored.targetScore,undefined);
});
console.log(`Solo/settings: ${passed} scenarios passed, 0 failed`);
