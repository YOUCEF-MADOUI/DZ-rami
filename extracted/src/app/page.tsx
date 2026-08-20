'use client';

import { useState } from 'react';
import { GameConfig, DEFAULT_CONFIG } from '@/game/core/types';
import HomeScreen from '@/components/HomeScreen';
import SettingsScreen from '@/components/SettingsScreen';
import GameScreen from '@/components/GameScreen';
import ScoreBoard from '@/components/ScoreBoard';

type Screen = 'home' | 'settings' | 'game' | 'scores';

export default function Page() {
  const [screen, setScreen] = useState<Screen>('home');
  const [config, setConfig] = useState<GameConfig>(DEFAULT_CONFIG);
  const [playerNames, setPlayerNames] = useState<string[]>([]);
  const [gameKey, setGameKey] = useState(0);

  const handleStartSolo = (playerCount: 2 | 3 | 4 | 5) => {
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
    setPlayerNames(names);
    setConfig(prev => ({ ...prev, playerCount }));
    setGameKey(k => k + 1);
    setScreen('game');
  };

  return (
    <div className="h-screen w-screen overflow-hidden">
      {screen === 'home' && (
        <HomeScreen
          onStartSolo={handleStartSolo}
          onStartMulti={handleStartMulti}
          onSettings={() => setScreen('settings')}
          config={config}
        />
      )}
      {screen === 'settings' && (
        <SettingsScreen
          config={config}
          onSave={(c: GameConfig) => { setConfig(c); setScreen('home'); }}
          onBack={() => setScreen('home')}
        />
      )}
      {screen === 'game' && (
        <GameScreen
          key={gameKey}
          config={config}
          playerNames={playerNames}
          onBack={() => setScreen('home')}
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
