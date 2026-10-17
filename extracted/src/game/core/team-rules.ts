import { isCardPlayableOnTable, canRecoverJoker, getJokerRepresentation, validateCombination } from './validation';
import { GameCard, Combination, GameConfig, GameState, Player, RoundEndType, RoundResult, ScoreBreakdownItem } from './types';
export type TeamId = 'team-1' | 'team-2';
export const TEAM_IDS: TeamId[] = ['team-1','team-2'];
export const TEAM_NAMES: Record<TeamId,string> = {'team-1':'Équipe 1 · Sud + Nord','team-2':'Équipe 2 · Est + Ouest'};
export function isTeamMode(config: GameConfig): boolean { return config.variant === 'teams'; }
export function normalizeVariantConfig(config: GameConfig): GameConfig {
  if(!isTeamMode(config))return config;
  if(config.playerCount!==4)throw new Error('Le mode 2 contre 2 exige quatre joueurs.');
  return {...config,chopObligatoire:false,malusChopOuverture:0,malusChopJoueurOuvert:0,malusChopJoueurOuvertActif:false,
    rsScorePerCard:10,rjScorePerCard:20,rsNonOpenedPenalty:100,rjNonOpenedPenalty:200};
}
export function teamOf(player: Pick<Player,'seat'>): TeamId {
  return player.seat==='south'||player.seat==='north'?'team-1':'team-2';
}
export function teamOfPlayer(state: Pick<GameState,'players'>, id: string): TeamId|undefined {
  const player=state.players.find(p=>p.id===id);return player?teamOf(player):undefined;
}
export function openingRequirements(state: GameState, playerId: string) {
  const team=teamOfPlayer(state,playerId);
  const waived=isTeamMode(state.config)&&state.players.some(p=>p.id!==playerId&&teamOf(p)===team&&p.status==='opened');
  return {waived,natural:waived?0:state.initialThreshold,total:waived?0:state.suite};
}
/** Only own/team public melds are evidence of a playable-discard fault in teams. */
export function discardFaultTable(state: GameState, playerId: string, table: Combination[]): Combination[] {
  if(!isTeamMode(state.config))return table;
  const team=teamOfPlayer(state,playerId);
  return table.filter(c=>c.ownerId===playerId||state.players.some(p=>p.id===c.ownerId&&teamOf(p)===team&&p.status==='opened'));
}
export function calculateTeamScores(state: GameState,winnerId: string|null,endType:RoundEndType):RoundResult {
  const winnerTeam=winnerId?teamOfPlayer(state,winnerId):undefined;
  const scores:Record<string,number>={};const scoreBreakdown:Record<string,ScoreBreakdownItem[]>={};
  const perCard=endType==='RJ'?20:10,nonOpened=endType==='RJ'?200:100;
  for(const team of TEAM_IDS){
    const players=state.players.filter(p=>teamOf(p)===team);const items:ScoreBreakdownItem[]=[];
    if(team!==winnerTeam && endType!=='null_round'){
      const unopened=players.filter(p=>p.status==='not_opened').length;
      if(winnerTeam){
        if(unopened===2)items.push({label:`Deux adversaires non ouverts (${endType})`,points:nonOpened*2});
        else{
          const counted=endType==='RS'?players.filter(p=>p.status==='opened'):players;
          const cards=counted.reduce((sum,p)=>sum+p.hand.length,0);
          items.push({label:`${cards} cartes restantes × ${perCard}`,points:cards*perCard});
          if(unopened)items.push({label:'Un adversaire non ouvert',points:nonOpened});
        }
      }else{
        // Exhausted cycles retain the existing individual remainder rule, aggregated once.
        for(const p of players)items.push({label:p.name,points:p.status==='not_opened'?state.config.rsNonOpenedPenalty:p.hand.length*state.config.rsScorePerCard});
      }
    }
    if(endType!=='null_round')for(const fault of state.faults.filter(f=>players.some(p=>p.id===f.playerId)))items.push({label:fault.description,points:fault.penalty});
    scores[team]=items.reduce((sum,item)=>sum+item.points,0);scoreBreakdown[team]=items;
  }
  return {winnerId,endType,scores,scoreBreakdown,teamScoreVersion:2,faults:endType==='null_round'?[]:[...state.faults]};
}
/** Recompute from the round ledger; repeated rejected actions cannot double-count a round. */
export function settleTeamScores(state: GameState): GameState {
  if(!isTeamMode(state.config))return state;
  const totals=Object.fromEntries(TEAM_IDS.map(id=>[id,state.roundResults.reduce((sum,r)=>sum+(r.scores[id]??0),0)]));
  if(state.players.every(p=>p.score===totals[teamOf(p)]&&p.roundScores.length===state.roundResults.length))return state;
  return {...state,players:state.players.map(p=>({...p,score:totals[teamOf(p)],roundScores:state.roundResults.map(r=>r.scores[teamOf(p)]??0)}))};
}
export type ScoreState = Pick<GameState,'config'|'roundResults'> & {players:Pick<Player,'id'|'name'|'seat'|'score'|'roundScores'>[]};
export function scoreEntries(state:ScoreState) {
  if(!isTeamMode(state.config))return state.players.map(p=>({id:p.id,name:p.name,score:p.score,roundScores:p.roundScores}));
  return TEAM_IDS.map(id=>({id,name:TEAM_NAMES[id],score:state.roundResults.reduce((n,r)=>n+(r.scores[id]??0),0),roundScores:state.roundResults.map(r=>r.scores[id]??0)}));
}
export function winnerScoreId(state:ScoreState,result:RoundResult):string|undefined {
  const winner=state.players.find(p=>p.id===result.winnerId);
  return winner?(isTeamMode(state.config)?teamOf(winner):winner.id):undefined;
}

/** Team faults also cover a legal exact Joker replacement (including both missing cards). */
export function isDiscardPlayable(state:GameState,playerId:string,card:GameCard,table:Combination[]):boolean {
  const eligible=discardFaultTable(state,playerId,table);
  if(isCardPlayableOnTable(card,eligible))return true;
  if(!isTeamMode(state.config)||card.isJoker)return false;
  const hand=state.players.find(p=>p.id===playerId)?.hand??[];
  return eligible.some(combo=>{
    if(!validateCombination(combo).valid)return false;
    const metadata=getJokerRepresentation(combo);
    if(!metadata)return false;
    const replacements=metadata.candidates.map(candidate=>{
      if(card.rank===candidate.rank&&card.suit===candidate.suit)return card;
      return hand.find(c=>!c.isJoker&&c.rank===candidate.rank&&c.suit===candidate.suit);
    }).filter((c):c is GameCard=>!!c);
    return replacements.some(c=>c.id===card.id)&&canRecoverJoker(combo,replacements);
  });
}

/** Only the just-finished saved round still has the exact hands needed for a safe correction. */
export function refreshSavedTeamRS(state:GameState):GameState {
  const last=state.roundResults.at(-1);
  if(!isTeamMode(state.config)||state.phase!=='round_end'||state.roundResults.length!==state.roundNumber||last?.endType!=='RS'||last.teamScoreVersion===2||!last.winnerId)return state;
  const corrected=calculateTeamScores(state,last.winnerId,'RS');
  return settleTeamScores({...state,roundResults:[...state.roundResults.slice(0,-1),corrected]});
}
