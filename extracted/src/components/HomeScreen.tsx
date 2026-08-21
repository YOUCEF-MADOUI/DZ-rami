'use client';

import { useState } from 'react';
import { GameConfig } from '@/game/core/types';

interface Props {
  onStartSolo: (playerCount: 2 | 3 | 4 | 5) => void;
  onStartMulti: (playerCount: 2 | 3 | 4 | 5, names: string[]) => void;
  onSettings: () => void;
  config: GameConfig;
}

export default function HomeScreen({ onStartSolo, onStartMulti, onSettings, config }: Props) {
  const [mode, setMode] = useState<'menu' | 'solo' | 'multi'>('menu');
  const [playerCount, setPlayerCount] = useState<2 | 3 | 4 | 5>(4);
  const [names, setNames] = useState<string[]>(['', '', '', '', '']);

  if (mode === 'solo') {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 bg-gradient-to-b from-slate-900 via-emerald-950 to-slate-900">
        <h2 className="text-2xl font-bold text-amber-400 mb-6">Mode Solo</h2>
        <p className="text-slate-300 mb-4 text-center">Choisissez le nombre de joueurs</p>
        
        <div className="grid grid-cols-2 gap-3 mb-8 w-full max-w-xs">
          {([2, 3, 4, 5] as const).map(n => (
            <button
              key={n}
              onClick={() => setPlayerCount(n)}
              className={`p-4 rounded-xl text-lg font-bold transition-all ${
                playerCount === n
                  ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {n} Joueurs
            </button>
          ))}
        </div>

        <div className="text-center mb-6 text-sm text-slate-400">
          <p>Seuil: {config.playerCount === 2 ? 111 : config.playerCount === 3 ? 101 : config.playerCount === 4 ? 91 : 71}</p>
        </div>

        <button onClick={() => onStartSolo(playerCount)} className="btn-primary w-full max-w-xs text-lg py-3 mb-3">
          🎮 Commencer
        </button>
        <button onClick={() => setMode('menu')} className="btn-secondary w-full max-w-xs">
          ← Retour
        </button>
      </div>
    );
  }

  if (mode === 'multi') {
    return (
      <div className="h-full flex flex-col items-center justify-start p-6 pt-12 bg-gradient-to-b from-slate-900 via-emerald-950 to-slate-900 overflow-y-auto">
        <h2 className="text-2xl font-bold text-amber-400 mb-4">Multijoueur Local</h2>
        
        <div className="flex gap-2 mb-4">
          {([2, 3, 4, 5] as const).map(n => (
            <button
              key={n}
              onClick={() => setPlayerCount(n)}
              className={`px-4 py-2 rounded-lg text-sm font-bold ${
                playerCount === n ? 'bg-amber-500 text-white' : 'bg-slate-700 text-slate-300'
              }`}
            >
              {n}J
            </button>
          ))}
        </div>

        <div className="w-full max-w-xs space-y-3 mb-6">
          {Array.from({ length: playerCount }, (_, i) => (
            <input
              key={i}
              type="text"
              placeholder={`Joueur ${i + 1}`}
              value={names[i]}
              onChange={e => {
                const newNames = [...names];
                newNames[i] = e.target.value;
                setNames(newNames);
              }}
              className="w-full px-4 py-3 rounded-lg bg-slate-700 text-white placeholder-slate-400 border border-slate-600 focus:border-amber-500 focus:outline-none"
            />
          ))}
        </div>

        <button
          onClick={() => {
            const finalNames = Array.from({ length: playerCount }, (_, i) =>
              names[i] || `Joueur ${i + 1}`
            );
            onStartMulti(playerCount, finalNames);
          }}
          className="btn-primary w-full max-w-xs text-lg py-3 mb-3"
        >
          🎮 Commencer
        </button>
        <button onClick={() => setMode('menu')} className="btn-secondary w-full max-w-xs">
          ← Retour
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center justify-center p-6 bg-gradient-to-b from-slate-900 via-emerald-950 to-slate-900">
      {/* Logo/Title */}
      <div className="text-center mb-10">
        <div className="text-6xl mb-3">🃏</div>
        <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-200">
          DZ-rami
        </h1>
        <p className="text-2xl text-amber-400/90 font-bold mt-1">رامي</p>
        <p className="text-lg text-amber-400/80 font-semibold mt-1">Rami Algérien</p>
        <p className="text-xs text-slate-400 mt-1">Règles de Bordj Bou Arréridj</p>
      </div>

      {/* Menu Buttons */}
      <div className="w-full max-w-xs space-y-3">
        <button
          onClick={() => setMode('solo')}
          className="btn-primary w-full text-lg py-4 flex items-center justify-center gap-3"
        >
          <span className="text-2xl">🤖</span>
          Mode Solo
        </button>

        <button
          onClick={() => setMode('multi')}
          className="btn-primary w-full text-lg py-4 flex items-center justify-center gap-3"
        >
          <span className="text-2xl">👥</span>
          Multijoueur
        </button>

        <button
          onClick={onSettings}
          className="btn-secondary w-full text-lg py-4 flex items-center justify-center gap-3"
        >
          <span className="text-2xl">⚙️</span>
          Paramètres
        </button>
      </div>

      <p className="text-xs text-slate-500 mt-8 text-center">
        2 paquets · 108 cartes · 4 Jokers
      </p>
    </div>
  );
}
