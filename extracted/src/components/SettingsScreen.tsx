"use client";

import { useState } from "react";
import {
  GameConfig,
  DEFAULT_CONFIG,
  INITIAL_THRESHOLDS,
} from "@/game/core/types";
import GameRulesFields from "./rules/GameRulesFields";

interface Props {
  config: GameConfig;
  onSave: (config: GameConfig) => void;
  onBack: () => void;
  /**
   * Pre-game configuration: the same rules, but reached by "Commencer".
   * The confirm button starts the game instead of only returning to the menu.
   */
  preGame?: {
    /** Table that is about to be launched, e.g. "4 Joueurs — 2 contre 2". */
    table: string;
    detail?: string;
  };
}

export default function SettingsScreen({ config, onSave, onBack, preGame }: Props) {
  const [localConfig, setLocalConfig] = useState<GameConfig>({ ...config });

  const update = <K extends keyof GameConfig>(key: K, value: GameConfig[K]) => {
    setLocalConfig((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="h-full flex flex-col bg-slate-900">
      {/* Header */}
      <div className="flex items-center p-4 border-b border-slate-700">
        <button onClick={onBack} className="text-amber-400 font-bold mr-4">
          ← Retour
        </button>
        <h2 className="text-xl font-bold text-amber-400 flex-1 text-center">
          ⚙️ {preGame ? 'Paramètres de la partie' : 'Paramètres'}
        </h2>
        <div className="w-16" />
      </div>

      {/* Settings */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {preGame && (
          <div className="bg-slate-800 border border-amber-900/60 rounded-lg p-3" data-pregame-summary>
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
              Partie à lancer
            </p>
            <p className="text-white font-bold mt-0.5">{preGame.table}</p>
            {preGame.detail && (
              <p className="text-xs text-slate-400 mt-0.5">{preGame.detail}</p>
            )}
            <p className="text-xs text-slate-400 mt-1.5">
              Réglez les règles ci-dessous, puis lancez la partie.
            </p>
          </div>
        )}
        {/* Seuils */}
        <div>
          <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">
            Seuils Initiaux (lecture seule)
          </h3>
          <div className="bg-slate-800 rounded-lg p-3 space-y-1">
            {[2, 3, 4, 5].map((n) => (
              <div key={n} className="flex justify-between text-sm">
                <span className="text-slate-400">{n} joueurs</span>
                <span className="text-amber-400 font-mono font-bold">
                  {INITIAL_THRESHOLDS[n]}
                </span>
              </div>
            ))}
          </div>
        </div>

        <GameRulesFields config={localConfig} onChange={update} />

        {/* Reset */}
        <button
          onClick={() => setLocalConfig({ ...DEFAULT_CONFIG })}
          className="btn-danger w-full py-3"
        >
          🔄 Réinitialiser par défaut
        </button>
      </div>

      {/* Save Button */}
      <div className="p-4 border-t border-slate-700">
        <button
          onClick={() => onSave(localConfig)}
          className="btn-primary w-full py-3 text-lg"
          data-pregame-start={preGame ? 'true' : undefined}
        >
          {preGame ? '🎮 Commencer la partie' : '✅ Sauvegarder'}
        </button>
        {preGame && (
          <button onClick={onBack} className="btn-secondary w-full py-2.5 mt-2">
            ← Changer de table
          </button>
        )}
      </div>
    </div>
  );
}
