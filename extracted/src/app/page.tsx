'use client';

import { useEffect, useState, useCallback } from 'react';
import { GameConfig, DEFAULT_CONFIG } from '@/game/core/types';
import { loadGameConfig, saveGameConfig } from '@/game/core/config-storage';
import { loadSoloSession, saveSoloSession, clearSoloSession, SoloSession } from '@/game/core/solo-storage';
import { normalizeVariantConfig } from '@/game/core/team-rules';
import OnlineLobby from '@/components/online/OnlineLobby';
import HomeScreen from '@/components/HomeScreen';
import SettingsScreen from '@/components/SettingsScreen';
import GameScreen from '@/components/GameScreen';
import ScoreBoard from '@/components/ScoreBoard';

type Screen = 'home' | 'settings' | 'game' | 'scores' | 'online' | 'local';

export default function Page() {
  const [screen, setScreen] = useState<Screen>('home');
  const [config, setConfig] = useState<GameConfig>(DEFAULT_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [playerNames, setPlayerNames] = useState<string[]>([]);
  const [savedSession,setSavedSession]=useState<SoloSession|null>(null);
  const [resumeSession,setResumeSession]=useState<SoloSession|null>(null);
  const [teamMode,setTeamMode]=useState(false);
  const [solo,setSolo]=useState(false);
  const [saveError,setSaveError]=useState('');
  const persistSolo=useCallback((session:SoloSession)=>{
    let ok=false;
    try{ok=saveSoloSession(window.localStorage,session);}catch{}
    setSavedSession(session.state.phase==='game_end'?null:session);
    setSaveError(ok?'':'Sauvegarde locale impossible : vérifiez l’espace ou les autorisations du navigateur.');
  },[]);
  const [gameKey, setGameKey] = useState(0);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      if (!active) return;
      try {
        setConfig(loadGameConfig(window.localStorage));
        setSavedSession(loadSoloSession(window.localStorage));
      } catch {
        // Storage can be disabled by the browser/host; gameplay still works.
      } finally {
        setConfigLoaded(true);
      }
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (!configLoaded) return;
    try {
      saveGameConfig(window.localStorage, config);
    } catch {
      // Local storage is an optional persistence adapter, not a game dependency.
    }
  }, [config, configLoaded]);

  const handleStartSolo = (playerCount: 2 | 3 | 4 | 5, teams=false) => {
    if(savedSession && !window.confirm('Commencer une nouvelle partie remplacera la sauvegarde solo. Continuer ?'))return;
    setResumeSession(null);setSolo(true);setTeamMode(teams);
    try{clearSoloSession(window.localStorage);}catch{}
    setSavedSession(null);
    const names = ['Vous'];
    const aiNames = ['Amine', 'Karim', 'Yacine', 'Fatima'];
    for (let i = 1; i < playerCount; i++) {
      names.push(aiNames[i - 1]);
    }
    setPlayerNames(names);
    setConfig(prev => ({ ...prev, playerCount }));
    setGameKey(k => k + 1);
    setScreen('game');
  };

  const handleStartMulti = (playerCount: 2 | 3 | 4 | 5, names: string[]) => {
    setResumeSession(null);setSolo(false);setTeamMode(false);
    setPlayerNames(names);
    setConfig(prev => ({ ...prev, playerCount }));
    setGameKey(k => k + 1);
    setScreen('game');
  };

  if(!configLoaded)return <div className="h-screen bg-slate-900 text-white p-6">Chargement…</div>;
  return (
    <div className="h-screen w-screen overflow-hidden">
      {saveError&&<p role="alert" className="fixed top-0 z-50 bg-red-950 text-white p-2 text-xs">{saveError}</p>}
      {(screen === 'home' || screen === 'local') && (
        <HomeScreen
          key={screen}
          initialMode={screen==='local'?'multi':'menu'}
          onOnline={()=>setScreen('online')}
          onResume={savedSession?()=>{setResumeSession(savedSession);setPlayerNames(savedSession.state.players.map(p=>p.name));setSolo(true);setGameKey(k=>k+1);setScreen('game');}:undefined}
          onStartSolo={handleStartSolo}
          onStartTeams={()=>handleStartSolo(4,true)}
          onStartMulti={handleStartMulti}
          onSettings={() => setScreen('settings')}
          config={config}
        />
      )}
      {screen === 'online' && <OnlineLobby config={config} onBack={()=>setScreen('home')} onLocal={()=>setScreen('local')}/>}
      {screen === 'settings' && (
        <SettingsScreen
          config={config}
          onSave={(c: GameConfig) => { try{setSaveError(saveGameConfig(window.localStorage,c)?'':'Impossible de sauvegarder les paramètres dans ce navigateur.');}catch{setSaveError('Stockage local indisponible.');}setConfig(c);setScreen('home'); }}
          onBack={() => setScreen('home')}
        />
      )}
      {screen === 'game' && (
        <GameScreen
          key={gameKey}
          initialState={resumeSession?.state}
          initialView={resumeSession?.view}
          onPersist={solo?persistSolo:undefined}
          config={resumeSession?.state.config??normalizeVariantConfig({...config,variant:teamMode?'teams':'classic',playerCount:teamMode?4:config.playerCount})}
          playerNames={playerNames}
          onBack={() => setScreen('home')}
          hotseat={!solo}
        />
      )}
      {screen === 'scores' && (
        <ScoreBoard
          onBack={() => setScreen('game')}
          gameState={null}
        />
      )}
    </div>
  );
}
