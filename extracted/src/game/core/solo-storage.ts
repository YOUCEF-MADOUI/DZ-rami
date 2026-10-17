import { refreshSavedTeamRS } from './team-rules';
import { GameState } from './types';
import { KeyValueStorage } from './config-storage';
import { assertDeckIntegrity } from './deck-integrity';
export const SOLO_STORAGE_KEY='dz-rami:solo:v1';
export interface SoloView { sortMode:'rank'|'suit'|'manual'; manualOrder:string[]; lockedSets:string[][]; selectedCards:string[]; }
export interface SoloSession { version:1; state:GameState; view:SoloView; }
export function saveSoloSession(storage:KeyValueStorage,session:SoloSession): boolean {
  try {
    if(session.state.phase==='game_end'){storage.setItem(SOLO_STORAGE_KEY,'null');return true;}
    assertDeckIntegrity(session.state);
    storage.setItem(SOLO_STORAGE_KEY,JSON.stringify(session));return true;
  }catch{return false;}
}
export function loadSoloSession(storage:KeyValueStorage): SoloSession|null {
  try {
    const value=JSON.parse(storage.getItem(SOLO_STORAGE_KEY)??'null') as SoloSession|null;
    if(!value||value.version!==1||!['playing','round_end'].includes(value.state.phase))return null;
    value.state=refreshSavedTeamRS(value.state);
    const {state,view}=value;
    if(state.config.variant && !['classic','teams'].includes(state.config.variant))return null;
    if(state.config.variant==='teams'&&state.config.playerCount!==4)return null;
    const target=state.config.targetScore;
    if(target && state.players.some(p=>p.score>=Math.min(3000,target)))return null;
    if(!Array.isArray(state.players)||state.players.length!==state.config.playerCount||state.players[0].isAI||state.players.slice(1).some(p=>!p.isAI))return null;
    if(!view||!['rank','suit','manual'].includes(view.sortMode)||!Array.isArray(view.manualOrder)||!Array.isArray(view.lockedSets)||!Array.isArray(view.selectedCards))return null;
    if(!view.manualOrder.every(id=>typeof id==='string')||!view.selectedCards.every(id=>typeof id==='string')||!view.lockedSets.every(ids=>Array.isArray(ids)&&ids.every(id=>typeof id==='string')))return null;
    if(new Set(view.manualOrder).size!==view.manualOrder.length||new Set(view.selectedCards).size!==view.selectedCards.length||view.lockedSets.some(ids=>new Set(ids).size!==ids.length))return null;
    if(state.phase==='playing'&&(!state.turnState||state.turnState.playerId!==state.players[state.currentPlayerIndex]?.id))return null;
    assertDeckIntegrity(state);
    // Undo logic relies on shared action references; JSON alone cannot preserve them.
    if(state.turnState){
      const actions=new Map(state.actionHistory.map(action=>[JSON.stringify(action),action]));
      state.turnState.actionsThisTurn=state.turnState.actionsThisTurn.map(action=>actions.get(JSON.stringify(action))??action);
    }
    return value;
  }catch{return null;}
}
export function clearSoloSession(storage:KeyValueStorage): void { storage.setItem(SOLO_STORAGE_KEY,'null'); }
