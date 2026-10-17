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
}

export default function SettingsScreen({ config, onSave, onBack }: Props) {
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
          ⚙️ Paramètres
        </h2>
        <div className="w-16" />
      </div>

      {/* Settings */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
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
        >
          ✅ Sauvegarder
        </button>
      </div>
    </div>
  );
}
