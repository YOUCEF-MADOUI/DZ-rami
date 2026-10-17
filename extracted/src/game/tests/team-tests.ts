import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, GameConfig, GameState, GameCard, Combination, Rank, Suit } from '../core/types';
import { createDeck } from '../core/deck';
import { createInitialGameState,startNewRound,placeCombination,confirmOpening,discard,drawCard,chopCard,addToCombination,returnCarreToBase,hasPlayedMandatoryChopCard,rejectChop,calculateRoundScores,reportFault,validateOpening,getNextSeatIndex,setTransitionAuditor } from '../core/engine';
import { teamOf,openingRequirements,scoreEntries,refreshSavedTeamRS } from '../core/team-rules';
import { assertDeckIntegrity } from '../core/deck-integrity';
import { executeAITurn } from '../ai/ai-player';
const config:GameConfig={...DEFAULT_CONFIG,playerCount:4,variant:'teams',chopObligatoire:true,chopSeulementOuverture:true,chopCarteObligatoireAJouer:true};
const deck=createDeck();const c=(r:Rank,s:Suit,p:1|2=1)=>deck.find(c=>!c.isJoker&&c.rank===r&&c.suit===s&&c.pack===p)!;
let tests=0;function test(name:string,fn:()=>void){fn();tests++;console.log(`✅ ${name}`);}
function base(){return startNewRound(createInitialGameState(config,['Sud','Est','Nord','Ouest']));}
function fixture(hands:GameCard[][],combos:Combination[]=[]):GameState {
 const state=base();const used=new Set([...hands.flat(),...combos.flatMap(c=>c.cards)].map(c=>c.id));
 return {...state,players:state.players.map((p,i)=>({...p,hand:hands[i]??[]})),deck:deck.filter(c=>!used.has(c.id)),tableCombinations:combos};
}
const meld=(id:string,ranks:Rank[],suit:Suit):Combination=>({id,type:'tierce',ownerId:'player-0',cards:ranks.map(r=>c(r,suit))});
const opening=[meld('a',['Q','K','A'],'hearts'),meld('b',['10','J','Q'],'clubs'),meld('c',['10','J','Q'],'diamonds')];
function stage(state:GameState,combos:Combination[]){for(const combo of combos)state=placeCombination(state,combo.cards.map(c=>c.id),combo.type);return state;}
function turn(state:GameState,index:number):GameState{return {...state,currentPlayerIndex:index,turnState:{...state.turnState!,playerId:state.players[index].id,phase:'playing',temporaryCombinations:[],actionsThisTurn:[]}};}
test('Team seats and rotation are fixed independently of human/AI flags',()=>{
 const state=base();assert.deepEqual(state.players.map(p=>p.seat),['south','east','north','west']);assert.deepEqual(state.players.map(teamOf),['team-1','team-2','team-1','team-2']);
 const shuffled={...state,players:[state.players[2],state.players[0],state.players[3],state.players[1]]};assert.equal(shuffled.players[getNextSeatIndex(shuffled,1)].seat,'east');assertDeckIntegrity(state);
});
test('First team opener uses 91/current SUITE; partner opens immediately without thresholds and cannot change SUITE',()=>{
 const small=meld('small',['2','3','4'],'spades');
 let state=fixture([[...opening.flatMap(c=>c.cards),c('2','clubs',2)],[],[...small.cards,c('3','clubs',2)],[]]);
 const low=stage(fixture([[...small.cards,c('2','clubs',2)]]),[small]);assert.equal(confirmOpening(low),low);
 state=confirmOpening(stage(state,opening));assert.equal(state.suite,92);assert.equal(state.players[0].status,'opened');
 assert.equal(openingRequirements(state,'player-1').total,92);assert.equal(openingRequirements(state,'player-2').total,0);
 const east=turn(state,1);assert(!validateOpening(east,'player-1',[small]).valid,'Opposing first opener still needs thresholds');
 state=turn(state,2);assert(!validateOpening(state,'player-2',[]).valid);
 state=confirmOpening(stage(state,[small]));assert.equal(state.players[2].status,'opened');assert.equal(state.players[2].openingThreshold,0);assert.equal(state.suite,92);assert.equal(state.lastOpeningTotal,91);assert.equal(state.currentPlayerIndex,2);assertDeckIntegrity(state);
 const ended=discard(state,c('3','clubs',2).id);assert.equal(ended.suite,92);assert.equal(ended.roundResults.at(-1)?.scores['team-1'],0);assertDeckIntegrity(ended);
});
test('Team CHOP preserves opening/use options, without forced draw or malus',()=>{
 let state=base();assert.equal(state.config.chopObligatoire,false);assert.equal(state.config.chopCarteObligatoireAJouer,true);assert.equal(state.config.chopSeulementOuverture,true);
 const top=state.deck[0];state={...state,deck:state.deck.slice(1),discardPile:[top],turnState:{...state.turnState!,phase:'must_draw',isInitialDealTurn:false}};
 assert.notEqual(drawCard(state),state);
 for(const opening of [false,true])for(const use of [false,true])for(const opened of [false,true]){
   const initial={...state,config:{...state.config,chopSeulementOuverture:opening,chopCarteObligatoireAJouer:use},players:state.players.map(p=>({...p,status:opened?'opened' as const:'not_opened' as const}))};
   const chopped=chopCard(initial);assert.equal(chopped.faults.length,0);
   assert.equal(chopped.turnState?.mandatoryChopCardId,use?top.id:undefined);
   const ended=discard(chopped,top.id);
   if(use||(opening&&!opened))assert.equal(ended,chopped,'Illegal turn end must be refused without mutation');
   else assert.notEqual(ended.currentPlayerIndex,initial.currentPlayerIndex);
   const undone=rejectChop(chopped);assert.equal(undone.discardPile.at(-1)?.id,top.id);assertDeckIntegrity(undone);assertDeckIntegrity(chopped);
 }
 const classic=createInitialGameState({...config,variant:'classic'},['S','E','N','W']);assert(classic.config.chopObligatoire);assert.equal(classic.config.malusChopOuverture,50);
});
test('Team CHOP permits a legal opening using the chopped card, including exempt partner',()=>{
 for(const partnerOpened of [false,true]){
   const combos=partnerOpened?[meld('small',['2','3','4'],'spades')]:opening;
   const cards=combos.flatMap(c=>c.cards), top=cards[0], last=c('2','clubs',2);
   let state=fixture([[...cards.slice(1),last]]);
   state={...state,deck:state.deck.filter(c=>c.id!==top.id),discardPile:[top],players:state.players.map((p,i)=>i===2&&partnerOpened?{...p,status:'opened'}:p),turnState:{...state.turnState!,phase:'must_draw',isInitialDealTurn:false}};
   state=chopCard(state);state=stage(state,combos);
   const ended=discard(state,last.id);assert.notEqual(ended,state);assert.equal(ended.players[0].status,'opened');assertDeckIntegrity(ended);
 }
});
test('CHOP played on partner carré stays satisfied after return to base and JSON restore',()=>{
 for(const variant of ['teams','classic'] as const){
  const top=c('8','diamonds'), spare=c('2','clubs'), last=c('3','clubs');
  const combo:Combination={id:'partner-set',ownerId:'player-2',type:'carre',cards:[c('8','hearts'),c('8','clubs'),c('8','spades')]};
  let state=fixture([[spare,last]], [combo]);
  state={...state,config:{...state.config,variant},deck:state.deck.filter(card=>card.id!==top.id),discardPile:[top],players:state.players.map(p=>({...p,status:'opened'})),turnState:{...state.turnState!,phase:'must_draw',isInitialDealTurn:false}};
  state=chopCard(state);assert.equal(hasPlayedMandatoryChopCard(state),false);assert.equal(discard(state,last.id),state);
  state=addToCombination(state,top.id,combo.id);assert.equal(hasPlayedMandatoryChopCard(state),true);
  state=returnCarreToBase(state,combo.id);assert.equal(state.tableCombinations.length,0);assert(state.basePile.some(card=>card.id===top.id));assertDeckIntegrity(state);
  state=JSON.parse(JSON.stringify(state)) as GameState;
  assert.equal(hasPlayedMandatoryChopCard(state),true);
  const wrongCopy={...state,turnState:{...state.turnState!,mandatoryChopCardId:c('8','diamonds',2).id}};
  assert.equal(hasPlayedMandatoryChopCard(wrongCopy),false);
  const oldEvidence={...state,turnState:{...state.turnState!,actionsThisTurn:[]}};
  assert.equal(hasPlayedMandatoryChopCard(oldEvidence),false);assert.equal(discard(oldEvidence,last.id),oldEvidence);
  const ended=discard(state,last.id);assert.notEqual(ended,state);assert.notEqual(ended.currentPlayerIndex,state.currentPlayerIndex);assert.equal(hasPlayedMandatoryChopCard(ended),false);assertDeckIntegrity(ended);
 }
});
for(const endType of ['RS','RJ'] as const)for(const opened of [0,1,2])test(`${endType} exact team score, ${opened} opened opponents`,()=>{
 let state=fixture([[],deck.slice(0,4),deck.slice(6,20),deck.slice(4,6)]);state={...state,players:state.players.map((p,i)=>({...p,status:(i===1&&opened>=1)||(i===3&&opened===2)?'opened':'not_opened'}))};assertDeckIntegrity(state);
 const result=calculateRoundScores(state,'player-0',endType);const expected=endType==='RS'?[200,140,60][opened]:[400,320,120][opened];
 assert.deepEqual(Object.keys(result.scores).sort(),['team-1','team-2']);assert.equal(result.scores['team-1'],0);assert.equal(result.scores['team-2'],expected);
});
test('Team ledger accumulates once across rounds and both teammates share the score',()=>{
 const last=c('2','clubs');let state=fixture([[last],[],[],[]]);state.players[0]={...state.players[0],status:'opened'};
 state=discard(state,last.id);assert.equal(state.players[1].score,200);assert.equal(state.players[3].score,200);assert.equal(scoreEntries(state).length,2);
 const repeated=drawCard(state);assert.equal(repeated.players[1].score,200);
 const second=startNewRound(state);assert.equal(second.players[1].score,200);assert.equal(second.suite,91);
 assert.equal(teamOf(second.players[2]),'team-1');assertDeckIntegrity(second);
});
test('Discard fault checks teammate snapshot, not opponents; confirmed report applies existing penalty and ends round',()=>{
 const run={...meld('public',['J','Q','K'],'spades'),ownerId:'player-2'};const ace=c('A','spades');
 let state=fixture([[ace,c('2','clubs')],[],[],[]],[run]);state={...state,players:state.players.map(p=>({...p,status:'opened'}))};
 const ended=discard(state,ace.id);assert.equal(ended.faults.length,0);assert(ended.lastCompletedTurnAction!.wasDiscardPlayable);
 const report=reportFault({...ended,tableCombinations:[]},'player-1','player-0','playable_discard');assert(report.valid);assert.equal(report.state.phase,'round_end');assert.equal(report.state.roundResults.at(-1)!.scores['team-1'],110);assert.equal(report.state.faults[0].penalty,DEFAULT_CONFIG.playableDiscardPenalty);
 const opposing={...state,tableCombinations:[{...run,ownerId:'player-1'}]};assert(!discard(opposing,ace.id).lastCompletedTurnAction!.wasDiscardPlayable);
 const closedMate={...state,players:state.players.map(p=>p.id==='player-2'?{...p,status:'not_opened' as const}:p)};assert(!discard(closedMate,ace.id).lastCompletedTurnAction!.wasDiscardPlayable);
 const classic={...state,config:{...DEFAULT_CONFIG,playerCount:4 as const},tableCombinations:[{...run,ownerId:'player-1'}]};assert(discard(classic,ace.id).lastCompletedTurnAction!.wasDiscardPlayable);
});
test('Each team first opener advances SUITE; neither later teammate opening changes it',()=>{
 const sets:Combination[]=(['A','K','Q'] as Rank[]).map((rank,i)=>({id:`set${i}`,ownerId:'player-1',type:'carre',cards:(['hearts','diamonds','spades'] as Suit[]).map(s=>c(rank,s,2))}));
 const small=meld('small2',['2','3','4'],'spades'),other=meld('small4',['5','6','7'],'diamonds');
 let state=fixture([[...opening.flatMap(c=>c.cards),c('2','clubs',2)],[...sets.flatMap(c=>c.cards),c('5','spades',2)],[...small.cards,c('6','spades',2)],[...other.cards,c('8','diamonds',2)]]);
 state=confirmOpening(stage(state,opening));assert.equal(state.suite,92);
 state=confirmOpening(stage(turn(state,2),[small]));assert.equal(state.suite,92);
 state=confirmOpening(stage(turn(state,1),sets));assert.equal(state.suite,94);
 state=confirmOpening(stage(turn(state,3),[other]));assert.equal(state.suite,94);assert(state.players.every(p=>p.status==='opened'));assertDeckIntegrity(state);
});
test('Team points really add across two RS rounds without double-counting teammates',()=>{
 let state=fixture([[c('2','clubs')],[],[],[]]);state.players[0]={...state.players[0],status:'opened'};
 state=discard(state,c('2','clubs').id);assert.equal(state.players[1].score,200);
 state=startNewRound(state);const hand=state.players[0].hand;
 state={...turn(state,0),deck:[...state.deck,...hand.slice(1)],players:state.players.map((p,i)=>i===0?{...p,hand:hand.slice(0,1),status:'opened'}:p)};
 state=discard(state,hand[0].id,true);assert.equal(state.roundResults.length,2);assert.equal(state.players[1].score,400);assert.equal(state.players[3].score,400);assert.equal(scoreEntries(state)[1].score,400);assertDeckIntegrity(state);
});
test('Partner exemption also waives natural-tierce requirement; hard AI uses the same rule',()=>{
 const small=meld('partner-run',['2','3','4'],'spades');const reserve=c('2','clubs',2);
 let state=fixture([[...small.cards,reserve],[],[],[]]);state={...state,config:{...state.config,aiDifficulty:'hard',tierceObligatoire:true},players:state.players.map((p,i)=>i===2?{...p,status:'opened'}:p)};
 const invalid:Combination={id:'set',type:'carre',ownerId:'player-0',cards:[c('K','hearts'),c('K','clubs'),c('K','diamonds')]};
 assert(validateOpening(state,'player-0',[invalid]).valid,'Opened teammate also waives the tierce requirement');
 const firstOpener={...state,players:state.players.map(p=>({...p,status:'not_opened' as const}))};
 assert(!validateOpening(firstOpener,'player-0',[invalid]).valid,'First opener still obeys normal rules');
 const result=executeAITurn(state);assert.equal(result.players[0].status,'opened');assert.equal(result.players[0].openingThreshold,0);assert.equal(result.suite,91);assertDeckIntegrity(result);
});
test('Discarding an exact card that could replace a teammate Joker is reportable',()=>{
 const joker=deck.find(c=>c.isJoker)!;
 const meld:Combination={id:'partner-joker',type:'carre',ownerId:'player-2',cards:[c('8','hearts'),c('8','clubs'),c('8','spades'),joker]};
 let state=fixture([[c('8','diamonds'),c('2','clubs')],[],[],[]],[meld]);state={...state,players:state.players.map(p=>({...p,status:'opened'}))};
 const ended=discard(state,c('8','diamonds').id);assert(ended.lastCompletedTurnAction!.wasDiscardPlayable);assert.equal(ended.faults.length,0);
 assert(reportFault(ended,'player-1','player-0','playable_discard').valid);
});
test('Screenshot RS: Yacine opened with two cards + Amine unopened with fourteen = 120',()=>{
 let state=fixture([[],deck.slice(0,14),[],deck.slice(14,16)]);
 state={...state,players:state.players.map((p,i)=>({...p,status:i===1?'not_opened':'opened'}))};
 assert.equal(calculateRoundScores(state,'player-0','RS').scores['team-2'],120);
 // The fixed 100 replaces (rather than adds to) the unopened player's card count.
 const old={...state,phase:'round_end' as const,roundResults:[{...calculateRoundScores(state,'player-0','RS'),scores:{'team-1':0,'team-2':260},teamScoreVersion:undefined}]};
 const restored=refreshSavedTeamRS(old);assert.equal(restored.roundResults[0].scores['team-2'],120);assert.equal(restored.players[1].score,120);assert.equal(refreshSavedTeamRS(restored),restored);
 const fewer={...state,players:state.players.map((p,i)=>i===1?{...p,hand:p.hand.slice(0,1)}:p)};
 assert.equal(calculateRoundScores(fewer,'player-0','RS').scores['team-2'],120);
});
test('An opened teammate waives tierce obligatoire for an actual brelan opening, not for the first opener',()=>{
 const kings:Combination={id:'free-kings',type:'carre',ownerId:'player-0',cards:[c('K','hearts'),c('K','clubs'),c('K','diamonds')]};
 const sets:Combination[]=(['A','K','Q'] as Rank[]).map((rank,i)=>({id:`mandatory-${i}`,type:'carre',ownerId:'player-0',cards:(['hearts','clubs','diamonds'] as Suit[]).map(s=>c(rank,s))}));
 const initial={...fixture([[...kings.cards,c('2','clubs',2),c('3','clubs',2)],[],[c('5','spades')],[]]),config:{...config,tierceObligatoire:true}};
 const first=validateOpening(initial,'player-0',sets);assert.equal(first.vierge,93);assert(!first.valid&&first.errors.some(e=>e.includes('tierce')));
 const partner={...initial,players:initial.players.map((p,i)=>i===2?{...p,status:'opened' as const}:p)};
 const opened=confirmOpening(stage(partner,[kings]));assert.equal(opened.players[0].status,'opened');assert.equal(opened.players[0].openingValue,30);assert.equal(opened.suite,initial.suite);assertDeckIntegrity(opened);
 const ended=discard(opened,c('2','clubs',2).id);
 const accusation=reportFault(ended,'player-1','player-0','opened_without_tierce');
 assert(!accusation.valid&&accusation.state.faults.length===ended.faults.length,'Exempt teammate cannot be penalized for missing tierce');
 const classic={...partner,config:{...partner.config,variant:'classic' as const}};
 assert(!validateOpening(classic,'player-0',sets).valid,'Classic mandatory-tierce rule remains intact');
});
let simulations=0,finished=0,turns=0,audits=0;
for(let seed=1;seed<=110;seed++){
 const original=Math.random;let n=seed;Math.random=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};
 try{setTransitionAuditor(s=>{assertDeckIntegrity(s);audits++;});let state=base();state={...state,config:{...state.config,aiDifficulty:seed>100?'hard':'normal'},players:state.players.map(p=>({...p,isAI:true}))};
 for(let t=0;t<800&&state.phase==='playing';t++){const prior=state.currentPlayerIndex;state=executeAITurn(state);turns++;assert(state.phase!=='playing'||state.currentPlayerIndex!==prior);for(const p of state.players)if(p.status==='opened'){assert(p.openingValue!>=p.openingThreshold!);assert(p.openingTotal!>=p.openingSuiteThreshold!);}}
 if(state.phase!=='playing')finished++;simulations++;
 }finally{Math.random=original;setTransitionAuditor();}
}
console.log(`Team tests: ${tests} passed; ${simulations} simulations, ${finished} finished, ${simulations-finished} capped, ${turns} turns, ${audits} integrity audits`);
