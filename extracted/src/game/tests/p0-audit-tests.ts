import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, GameState, GameCard, Combination, Rank, Suit } from '../core/types';
import { createDeck } from '../core/deck';
import { assertDeckIntegrity } from '../core/deck-integrity';
import { createInitialGameState, startNewRound, placeCombination, confirmOpening, discard, drawCard, chopCard, rejectChop, addToCombination, recoverJoker, returnCarreToBase, reportFault, setTransitionAuditor } from '../core/engine';
import { validateFirstPose, classifyCombination, resolveJokerPlacement } from '../core/validation';
let passed = 0;
function test(name: string, run: () => void) { run(); passed++; console.log(`✅ ${name}`); }
const deck = createDeck();
function c(rank: Rank, suit: Suit, pack: 1|2 = 1) { return deck.find(c => !c.isJoker && c.rank === rank && c.suit === suit && c.pack === pack)!; }
const joker = deck.find(c=>c.isJoker)!;
function run(ranks: Rank[], suit: Suit, id: string): Combination {
  return {id,type:'tierce',ownerId:'player-0',cards:ranks.map(r=>c(r,suit))};
}
const high = [run(['10','J','Q'],'hearts','h'),run(['10','J','Q'],'spades','s')];
const poses = {
  p81: [...high,run(['6','7','8'],'clubs','c')],
  p72: [high[0],run(['7','8','9'],'spades','s'),run(['5','6','7'],'clubs','c')],
  p80: [...high,run(['2','3','4','5','6'],'clubs','c')],
};
function jokerRun(ranks: (Rank|'joker')[], suit: Suit, id: string): Combination {
  const cards = ranks.map(rank=>rank==='joker'?joker:c(rank,suit));
  return {id,type:'tierce',ownerId:'player-0',cards,jokerPlacement:resolveJokerPlacement(cards,'tierce')!};
}
const p90n80 = [...poses.p80,jokerRun(['A','2','joker','4'],'diamonds','j10')];
const p90n70 = [run(['Q','K','A'],'hearts','h31'),run(['7','8','9'],'spades','s24'),run(['4','5','6'],'clubs','c15'),jokerRun(['2','3','4','joker','6'],'diamonds','j20')];
/** Build a complete physical state, allocating each manifest ID to exactly one zone. */
function physical(hand: GameCard[], table: Combination[] = [], opened = false): GameState {
  const base = startNewRound(createInitialGameState({...DEFAULT_CONFIG,playerCount:5},['Vous','Amine','Karim','Yacine','Fatima']));
  const used = new Set([...hand,...table.flatMap(c=>c.cards)].map(c=>c.id));
  const state: GameState = {...base,tableCombinations:table,discardPile:[],basePile:[],
    deck:deck.filter(c=>!used.has(c.id)),
    players:base.players.map((p,i)=>({...p,isAI:false,status:i===0&&!opened?'not_opened':'opened',hand:i===0?hand:[]}))};
  assertDeckIntegrity(state); return state;
}
function staged(melds: Combination[], suite: number) {
  let state = {...physical([...melds.flatMap(c=>c.cards),c('2','hearts',2),c('3','hearts',2)]),suite};
  for (const meld of melds) state = placeCombination(state,meld.cards.map(c=>c.id),meld.type);
  return state;
}
test('Exact dual thresholds: 81 accepted, then 72/80 rejected; natural 70 rejected; 90/80 accepted',()=>{
  const first = confirmOpening(staged(poses.p81,71));
  assert.equal(first.initialThreshold,71); assert.equal(first.suite,82); assert.equal(first.lastOpeningTotal,81);
  for (const melds of [poses.p72,poses.p80,p90n70]) {
    const state: GameState = {...staged(melds,first.suite),lastOpeningTotal:81};
    const before = JSON.stringify(state);
    assert.equal(confirmOpening(state),state);
    assert.equal(discard(state,c('2','hearts',2).id),state);
    assert.equal(JSON.stringify(state),before);
    assert.equal(state.suite,82); assert.equal(state.lastOpeningTotal,81);
    assert(state.turnState!.temporaryCombinations.length>0);
    assertDeckIntegrity(state);
  }
  const check = validateFirstPose(p90n70,71,DEFAULT_CONFIG,82);
  assert.equal(check.vierge,70); assert.equal(check.total,90); assert(!check.valid);
  const valid = validateFirstPose(p90n80,71,DEFAULT_CONFIG,82);
  assert.equal(valid.vierge,80); assert.equal(valid.total,90); assert(valid.valid);
  const opened = confirmOpening(staged(p90n80,82));
  assert.equal(opened.suite,91); assert.equal(opened.initialThreshold,71); assert.equal(opened.lastOpeningTotal,90);
  assertDeckIntegrity(opened);
});
test('108 unique physical cards: audit rejects duplicate, lost card and mutated identity',()=>{
  const state = physical([]);
  assert.equal(deck.length,108); assert.equal(new Set(deck.map(c=>c.id)).size,108);
  assert.throws(()=>assertDeckIntegrity({...state,deck:[...state.deck,state.deck[0]]}),/Duplicate/);
  assert.throws(()=>assertDeckIntegrity({...state,deck:state.deck.slice(1)}),/107\/108/);
  assert.throws(()=>assertDeckIntegrity({...state,deck:state.deck.map((card,i)=>i===0?{...c('3','hearts'),id:card.id}:card)}),/Mutated/);
});
test('8♥ 8♣ 8♠ + Joker with 8♦: authorized recovery forms natural carré, reserve transfer conserves all IDs',()=>{
  const meld: Combination = {id:'eights',type:'carre',ownerId:'player-0',cards:[c('8','hearts'),c('8','clubs'),c('8','spades'),joker]};
  let state = physical([c('8','diamonds'),c('2','clubs')],[meld],true);
  assert.equal(classifyCombination(meld),'brelan_avec_joker');
  assert.equal(returnCarreToBase(state,'eights'),state);
  state = recoverJoker(state,'eights',c('8','diamonds').id);
  assertDeckIntegrity(state); assert.equal(classifyCombination(state.tableCombinations[0]),'carre_naturel');
  assert(state.players[0].hand.some(c=>c.id===joker.id && c.isJoker));
  state = returnCarreToBase(state,'eights'); assertDeckIntegrity(state);
  assert.equal(state.basePile.length,4); assert.equal(state.discardPile.length,0); assert.equal(state.discardHistory!.length,0);
  assert.equal(state.tableCombinations.length,0);
});
test('Deck recycle retains four-card Joker set instead of losing its four physical cards',()=>{
  const meld: Combination={id:'keep',type:'carre',ownerId:'player-0',cards:[c('8','hearts'),c('8','clubs'),c('8','spades'),joker]};
  const base=physical([c('2','hearts')],[meld],true);
  let state: GameState={...base,deck:[],discardPile:base.deck,turnState:{...base.turnState!,phase:'must_draw',isInitialDealTurn:false}};
  assertDeckIntegrity(state); state=drawCard(state); assertDeckIntegrity(state);
  assert.equal(state.tableCombinations[0].cards.length,4);
});
test('Every draw, CHOP, undo, pose, opening, extension and discard conserves physical cards',()=>{
  const actions = new Set<string>();
  setTransitionAuditor((state,action)=>{assertDeckIntegrity(state);actions.add(action);});
  try {
    let state=physical([...poses.p81.flatMap(c=>c.cards),c('9','clubs'),c('2','hearts',2),c('3','hearts',2)]);
    const top=state.deck[0];
    state={...state,deck:state.deck.slice(1),discardPile:[top],turnState:{...state.turnState!,phase:'must_draw',isInitialDealTurn:false}};
    state=chopCard(state); state=rejectChop(state); state=drawCard(state);
    for(const meld of poses.p81) state=placeCombination(state,meld.cards.map(c=>c.id),meld.type);
    state=confirmOpening(state);
    const run=state.tableCombinations.find(m=>m.cards.some(c=>!c.isJoker&&c.rank==='8'))!;
    state=addToCombination(state,c('9','clubs').id,run.id);
    state=discard(state,c('2','hearts',2).id); assertDeckIntegrity(state);
    for(const name of ['drawCard','chopCard','rejectChop','placeCombination','confirmOpening','addToCombination','discard']) assert(actions.has(name),name);
    assertDeckIntegrity(startNewRound(state));
  } finally { setTransitionAuditor(); }
});
test('Confirmed report during an opening draft returns draft cards before ending the round',()=>{
  let state=staged(poses.p81,71);
  const ace=c('A','spades',2);
  state={...state,lastCompletedTurnActionsByPlayer:{'player-4':{id:'proof',roundNumber:1,playerId:'player-4',discardedCardId:ace.id,discardedCard:ace,wasOpenedBeforeDiscard:true,wasDiscardPlayable:true,openingHadNaturalTierce:true,invalidCombinationIds:[],unrecoveredCarreResponsibleIds:[]}}};
  const result=reportFault(state,'player-0','player-4','playable_discard');
  assert(result.valid); assert.equal(result.state.phase,'round_end'); assertDeckIntegrity(result.state);
});

test('Screenshot: opened player replaces Fatima Joker with CHOPped 8♦ and can end the turn',()=>{
  const meld: Combination={id:'fatima-eights',type:'carre',ownerId:'player-4',cards:[c('8','hearts'),c('8','clubs'),c('8','spades'),joker]};
  const oldJoker=deck.find(c=>c.id==='joker-2')!;
  const base=physical([c('8','diamonds'),oldJoker],[meld],true);
  const initial: GameState={...base,config:{...base.config,chopCarteObligatoireAJouer:true},turnState:{...base.turnState!,isInitialDealTurn:false,hasDrawn:true,drawSource:'chop',mandatoryChopCardId:c('8','diamonds').id}};
  const next=recoverJoker(initial,meld.id,c('8','diamonds').id);
  assert.notEqual(next,initial);assertDeckIntegrity(next);
  assert.equal(next.tableCombinations[0].ownerId,'player-4');
  assert(next.tableCombinations[0].cards.every(c=>!c.isJoker));
  assert.deepEqual(new Set(next.players[0].hand.map(c=>c.id)),new Set([joker.id,oldJoker.id]));
  assert.equal(next.players[0].score,initial.players[0].score);
  const ended=discard(next,joker.id,false);assert.notEqual(ended.currentPlayerIndex,next.currentPlayerIndex);assertDeckIntegrity(ended);
});

console.log(`P0 audit tests: ${passed} passed, 0 failed`);
