'use client';

import { useEffect, useState, useCallback } from 'react';
import { GameConfig, DEFAULT_CONFIG } from '@/game/core/types';
import { loadGameConfig, saveGameConfig } from '@/game/core/config-storage';
import { loadSoloSession, saveSoloSession, clearSoloSession, SoloSession } from '@/game/core/solo-storage';
import { normalizeVariantConfig } from '@/game/core/team-rules';
import OnlineLobby from '@/components/online/OnlineLobby';
import HomeScreen, { type HomeDraft } from '@/components/HomeScreen';
import SettingsScreen from '@/components/SettingsScreen';
import GameScreen from '@/components/GameScreen';
import ScoreBoard from '@/components/ScoreBoard';
import { backTarget, installAndroidBackButton } from '@/game/native/android-back';

type Screen = 'home' | 'settings' | 'game' | 'scores' | 'online' | 'local';
type MenuMode = 'menu' | 'solo' | 'multi';
/**
 * A game that has been configured on its way to the table: "Commencer" opens the
 * rules first, and the launch only happens once the player confirms them.
 */
type PendingStart =
  | { kind: 'solo'; playerCount: 2 | 3 | 4 | 5; teams: boolean }
  | { kind: 'multi'; playerCount: 2 | 3 | 4 | 5; names: string[] };

export default function Page() {
  const [screen, setScreen] = useState<Screen>('home');
  const [pendingStart, setPendingStart] = useState<PendingStart | null>(null);
  const [menuMode, setMenuMode] = useState<MenuMode>('menu');
  /** Count / names of the setup form, kept when the rules screen opens and closes. */
  const [menuDraft, setMenuDraft] = useState<HomeDraft | null>(null);
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

  /**
   * Android hardware/gesture back button. The hook is a no-op in a plain
   * browser, so the web build keeps its normal history behaviour; inside the
   * APK, back returns to the menu and only leaves the app from the home screen.
   */
  useEffect(() => installAndroidBackButton(() => {
    const target = backTarget(screen);
    if (!target) return false;
    setPendingStart(null);
    setMenuMode('menu');
    setScreen(target);
    return true;
  }), [screen]);

  /** Actual launch, once the rules have been confirmed. */
  const handleStartSolo = (playerCount: 2 | 3 | 4 | 5, teams=false, rules: GameConfig = config) => {
    if(savedSession && !window.confirm('Commencer une nouvelle partie remplacera la sauvegarde solo. Continuer ?'))return false;
    setResumeSession(null);setSolo(true);setTeamMode(teams);
    try{clearSoloSession(window.localStorage);}catch{}
    setSavedSession(null);
    const names = ['Vous'];
    const aiNames = ['Amine', 'Karim', 'Yacine', 'Fatima'];
    for (let i = 1; i < playerCount; i++) {
      names.push(aiNames[i - 1]);
    }
    setPlayerNames(names);
    setConfig({ ...rules, playerCount: teams ? 4 : playerCount });
    setGameKey(k => k + 1);
    setScreen('game');
    return true;
  };

  const handleStartMulti = (playerCount: 2 | 3 | 4 | 5, names: string[], rules: GameConfig = config) => {
    setResumeSession(null);setSolo(false);setTeamMode(false);
    setPlayerNames(names);
    setConfig({ ...rules, playerCount });
    setGameKey(k => k + 1);
    setScreen('game');
  };

  /** "Commencer" always shows the rules of the game before it starts. */
  const requestStart = (start: PendingStart) => {
    setPendingStart(start);
    setMenuMode(start.kind === 'solo' ? 'solo' : 'multi');
    setScreen('settings');
  };

  const saveSettings = (next: GameConfig) => {
    try{setSaveError(saveGameConfig(window.localStorage,next)?'':'Impossible de sauvegarder les paramètres dans ce navigateur.');}catch{setSaveError('Stockage local indisponible.');}
    setConfig(next);
    const start = pendingStart;
    if (!start) { setScreen('home'); return; }
    setPendingStart(null);
    if (start.kind === 'solo') {
      if (!handleStartSolo(start.playerCount, start.teams, next)) setScreen('home');
    } else {
      handleStartMulti(start.playerCount, start.names, next);
    }
  };

  const startLabel = pendingStart
    ? pendingStart.kind === 'solo'
      ? pendingStart.teams
        ? '4 Joueurs — 2 contre 2'
        : `${pendingStart.playerCount} Joueurs`
      : `${pendingStart.playerCount} joueurs · même appareil`
    : '';
  const startDetail = pendingStart
    ? pendingStart.kind === 'solo'
      ? pendingStart.teams
        ? '2 équipes de 2 · votre partenaire est assis face à vous'
        : `Partie classique · vous contre l’IA (${pendingStart.playerCount} sièges)`
      : 'Chacun leur tour · écran « Passe l’appareil » entre les joueurs'
    : '';

  if(!configLoaded)return <div className="h-dvh bg-slate-900 text-white p-6">Chargement…</div>;
  return (
    <div className="app-shell w-screen overflow-hidden">
      {saveError&&<p role="alert" className="fixed top-0 z-50 bg-red-950 text-white p-2 text-xs">{saveError}</p>}
      {(screen === 'home' || screen === 'local') && (
        <HomeScreen
          key={screen === 'local' ? 'local' : 'home'}
          initialMode={screen==='local'?'multi':menuMode}
          draft={menuDraft}
          onDraftChange={setMenuDraft}
          onOnline={()=>setScreen('online')}
          onResume={savedSession?()=>{setResumeSession(savedSession);setPlayerNames(savedSession.state.players.map(p=>p.name));setSolo(true);setGameKey(k=>k+1);setScreen('game');}:undefined}
          onStartSolo={(playerCount, teams) => requestStart({ kind: 'solo', playerCount, teams: Boolean(teams) })}
          onStartMulti={(playerCount, names) => requestStart({ kind: 'multi', playerCount, names })}
          onSettings={() => { setPendingStart(null); setMenuMode('menu'); setScreen('settings'); }}
          config={config}
        />
      )}
      {screen === 'online' && <OnlineLobby config={config} onBack={()=>{setMenuMode('menu');setScreen('home');}} onLocal={()=>{setMenuMode('multi');setScreen('local');}}/>}
      {screen === 'settings' && (
        <SettingsScreen
          config={config}
          preGame={pendingStart ? { table: startLabel, detail: startDetail } : undefined}
          onSave={saveSettings}
          onBack={() => {
            // Back from a pending game returns to its setup, not to the main menu.
            setMenuMode(pendingStart ? menuMode : 'menu');
            setPendingStart(null);
            setScreen('home');
          }}
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
          onBack={() => { setMenuMode('menu'); setScreen('home'); }}
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
