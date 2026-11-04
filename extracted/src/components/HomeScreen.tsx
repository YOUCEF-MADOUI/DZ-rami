'use client';

import { useEffect, useState } from 'react';
import { GameConfig, INITIAL_THRESHOLDS } from '@/game/core/types';

/** What the setup form holds, kept by the page so opening the rules never resets it. */
export interface HomeDraft {
  playerCount: 2 | 3 | 4 | 5;
  teams: boolean;
  names: string[];
}

interface Props {
  onOnline?: () => void;
  initialMode?: 'menu' | 'solo' | 'multi';
  draft?: HomeDraft | null;
  onDraftChange?: (draft: HomeDraft) => void;
  onResume?: () => void;
  /** `teams` selects the 2-versus-2 variant, which always seats 4 players. */
  onStartSolo: (playerCount: 2 | 3 | 4 | 5, teams?: boolean) => void;
  onStartMulti: (playerCount: 2 | 3 | 4 | 5, names: string[]) => void;
  onSettings: () => void;
  config: GameConfig;
}

export default function HomeScreen({ onStartSolo, onStartMulti, onSettings, config, onResume, onOnline, initialMode='menu', draft, onDraftChange }: Props) {
  const [mode, setMode] = useState<'menu' | 'solo' | 'multi'>(initialMode);
  const [playerCount, setPlayerCount] = useState<2 | 3 | 4 | 5>(draft?.playerCount ?? config.playerCount);
  const [teams, setTeams] = useState(Boolean(draft?.teams));
  const [names, setNames] = useState<string[]>(draft?.names ?? ['', '', '', '', '']);

  // The page keeps the form so "← Changer de table" restores it untouched.
  useEffect(() => {
    onDraftChange?.({ playerCount, teams, names });
  }, [playerCount, teams, names, onDraftChange]);

  if (mode === 'solo') {
    /**
     * Everyone plays against the AI. The 2v2 variant is one more way to choose
     * the table, so it belongs here with the player counts, not in the main menu.
     */
    const soloOptions: { key: string; label: string; count: 2 | 3 | 4 | 5; teams: boolean; hint?: string }[] = [
      { key: 'solo-2', label: '2 Joueurs', count: 2, teams: false },
      { key: 'solo-3', label: '3 Joueurs', count: 3, teams: false },
      { key: 'solo-4', label: '4 Joueurs', count: 4, teams: false },
      {
        key: 'solo-4-teams',
        label: '4 Joueurs — 2 contre 2',
        count: 4,
        teams: true,
        hint: '2 équipes de 2 · votre partenaire est assis face à vous',
      },
      { key: 'solo-5', label: '5 Joueurs', count: 5, teams: false },
    ];
    const choose = (option: (typeof soloOptions)[number]) => {
      setPlayerCount(option.count);
      setTeams(option.teams);
    };
    return (
      <div className="h-full flex flex-col items-center justify-start p-6 pt-6 bg-gradient-to-b from-slate-900 via-emerald-950 to-slate-900 overflow-y-auto">
        <h2 className="text-2xl font-bold text-amber-400 mb-4">Mode Solo</h2>
        <p className="text-slate-300 mb-4 text-center">Choisissez le nombre de joueurs</p>

        <div className="w-full max-w-xs space-y-2.5 mb-4">
          {soloOptions.map(option => {
            const selected = option.teams ? teams : playerCount === option.count && !teams;
            return (
              <button
                key={option.key}
                onClick={() => choose(option)}
                aria-pressed={selected}
                className={`w-full px-4 py-3 rounded-xl font-bold transition-all flex flex-col items-center gap-0.5 ${
                  selected
                    ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                <span className="text-lg leading-tight">{option.label}</span>
                {option.hint && (
                  <span className={`text-[11px] font-normal ${selected ? 'text-amber-50/90' : 'text-slate-400'}`}>
                    {option.hint}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="text-center mb-5 text-sm text-slate-400 space-y-1">
          <p>{teams ? 'Variante 2 contre 2 · 4 joueurs' : `Partie classique · ${playerCount} joueurs`}</p>
          <p>Seuil: {INITIAL_THRESHOLDS[playerCount]}</p>
        </div>

        <button
          onClick={() => onStartSolo(playerCount, teams)}
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

  if (mode === 'multi') {
    return (
      <div className="h-full flex flex-col items-center justify-start p-6 pt-12 bg-gradient-to-b from-slate-900 via-emerald-950 to-slate-900 overflow-y-auto">
        <h2 className="text-2xl font-bold text-amber-400 mb-2">Multijoueur local</h2>
        <p className="text-sm text-slate-300 text-center mb-1 max-w-sm">
          Plusieurs joueurs sur le même appareil, chacun leur tour.
        </p>
        <p className="text-[11px] text-slate-500 text-center mb-5 max-w-sm">
          Avant chaque tour, l’écran « Passe l’appareil » masque la main du joueur précédent.
        </p>
        
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
        {onResume&&<button onClick={onResume} className="btn-primary w-full py-3">▶ Continuer la partie solo</button>}
        <button
          onClick={() => setMode('solo')}
          className="btn-primary w-full text-lg py-4 flex items-center justify-center gap-3"
        >
          <span className="text-2xl">🤖</span>
          Mode Solo
        </button>

        <button
          onClick={() => onOnline ? onOnline() : setMode('multi')}
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
