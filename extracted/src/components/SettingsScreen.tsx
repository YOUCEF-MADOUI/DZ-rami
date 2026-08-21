'use client';

import { useState } from 'react';
import { GameConfig, DEFAULT_CONFIG, INITIAL_THRESHOLDS } from '@/game/core/types';

interface Props {
  config: GameConfig;
  onSave: (config: GameConfig) => void;
  onBack: () => void;
}

export default function SettingsScreen({ config, onSave, onBack }: Props) {
  const [localConfig, setLocalConfig] = useState<GameConfig>({ ...config });

  const update = <K extends keyof GameConfig>(key: K, value: GameConfig[K]) => {
    setLocalConfig(prev => ({ ...prev, [key]: value }));
  };

  const NumberSetting = ({
    label,
    value,
    field,
    min = 0,
    max = 999,
  }: {
    label: string;
    value: number;
    field: keyof GameConfig;
    min?: number;
    max?: number;
  }) => (
    <div className="flex items-center justify-between py-3 border-b border-slate-700">
      <span className="text-sm text-slate-300">{label}</span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => update(field, Math.max(min, (value as number) - (field.includes('malus') ? 5 : 10)) as GameConfig[typeof field])}
          className="w-8 h-8 rounded-full bg-slate-600 text-white font-bold text-lg flex items-center justify-center"
        >
          −
        </button>
        <span className="w-12 text-center font-mono text-amber-400 font-bold">{value}</span>
        <button
          onClick={() => update(field, Math.min(max, (value as number) + (field.includes('malus') ? 5 : 10)) as GameConfig[typeof field])}
          className="w-8 h-8 rounded-full bg-slate-600 text-white font-bold text-lg flex items-center justify-center"
        >
          +
        </button>
      </div>
    </div>
  );

  const ToggleSetting = ({
    label,
    value,
    field,
  }: {
    label: string;
    value: boolean;
    field: keyof GameConfig;
  }) => (
    <div className="flex items-center justify-between py-3 border-b border-slate-700">
      <span className="text-sm text-slate-300">{label}</span>
      <button
        onClick={() => update(field, !value as GameConfig[typeof field])}
        className={`w-14 h-7 rounded-full transition-colors relative ${
          value ? 'bg-amber-500' : 'bg-slate-600'
        }`}
      >
        <div
          className={`w-5 h-5 rounded-full bg-white absolute top-1 transition-transform ${
            value ? 'translate-x-8' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-slate-900">
      {/* Header */}
      <div className="flex items-center p-4 border-b border-slate-700">
        <button onClick={onBack} className="text-amber-400 font-bold mr-4">
          ← Retour
        </button>
        <h2 className="text-xl font-bold text-amber-400 flex-1 text-center">⚙️ Paramètres</h2>
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
            {[2, 3, 4, 5].map(n => (
              <div key={n} className="flex justify-between text-sm">
                <span className="text-slate-400">{n} joueurs</span>
                <span className="text-amber-400 font-mono font-bold">{INITIAL_THRESHOLDS[n]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* CHOP */}
        <div>
          <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">CHOP</h3>
          <div className="bg-slate-800 rounded-lg px-4">
            <ToggleSetting
              label="CHOP obligatoire"
              value={localConfig.chopObligatoire}
              field="chopObligatoire"
            />
            <NumberSetting
              label="Malus CHOP ouverture"
              value={localConfig.malusChopOuverture}
              field="malusChopOuverture"
              min={0}
              max={200}
            />
            <NumberSetting
              label="Malus CHOP joueur ouvert"
              value={localConfig.malusChopJoueurOuvert}
              field="malusChopJoueurOuvert"
              min={0}
              max={100}
            />
          </div>
        </div>

        {/* Règles d'ouverture */}
        <div>
          <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">Ouverture</h3>
          <div className="bg-slate-800 rounded-lg px-4">
            <ToggleSetting
              label="Tierce obligatoire à l'ouverture"
              value={localConfig.tierceObligatoire}
              field="tierceObligatoire"
            />
            <p className="text-[11px] text-slate-500 pb-3 pt-1">
              Si activé, ouvrir sans aucune tierce est une faute qu'un autre joueur peut signaler.
            </p>
          </div>
        </div>

        {/* Carré */}
        <div>
          <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">Carré</h3>
          <div className="bg-slate-800 rounded-lg px-4">
            <div className="flex items-center justify-between py-3 border-b border-slate-700">
              <span className="text-sm text-slate-300">Responsable du retrait</span>
              <div className="flex gap-2">
                <button
                  onClick={() => update('carreResponsable', 'detenteur')}
                  className={`px-3 py-1 rounded text-xs font-bold ${
                    localConfig.carreResponsable === 'detenteur'
                      ? 'bg-amber-500 text-white'
                      : 'bg-slate-600 text-slate-300'
                  }`}
                >
                  Détenteur
                </button>
                <button
                  onClick={() => update('carreResponsable', 'completeur')}
                  className={`px-3 py-1 rounded text-xs font-bold ${
                    localConfig.carreResponsable === 'completeur'
                      ? 'bg-amber-500 text-white'
                      : 'bg-slate-600 text-slate-300'
                  }`}
                >
                  Compléteur
                </button>
              </div>
            </div>
            <NumberSetting
              label="Pénalité carré non récupéré"
              value={localConfig.carreNotRecoveredPenalty}
              field="carreNotRecoveredPenalty"
              min={0}
              max={300}
            />
          </div>
        </div>

        {/* Fautes */}
        <div>
          <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">Fautes</h3>
          <div className="bg-slate-800 rounded-lg px-4">
            <NumberSetting
              label="Pénalité standard"
              value={localConfig.faultePenalty}
              field="faultePenalty"
              min={0}
              max={500}
            />
            <NumberSetting
              label="Pénalité spéciale Joker"
              value={localConfig.faulteJokerPenalty}
              field="faulteJokerPenalty"
              min={0}
              max={500}
            />
            <NumberSetting
              label="Pénalité défausse jouable"
              value={localConfig.playableDiscardPenalty}
              field="playableDiscardPenalty"
              min={0}
              max={300}
            />
          </div>
        </div>

        {/* Scores */}
        <div>
          <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">Scores</h3>
          <div className="bg-slate-800 rounded-lg px-4">
            <NumberSetting
              label="RS par carte restante"
              value={localConfig.rsScorePerCard}
              field="rsScorePerCard"
              min={5}
              max={50}
            />
            <NumberSetting
              label="RJ par carte restante"
              value={localConfig.rjScorePerCard}
              field="rjScorePerCard"
              min={10}
              max={100}
            />
            <NumberSetting
              label="RS joueur non ouvert"
              value={localConfig.rsNonOpenedPenalty}
              field="rsNonOpenedPenalty"
              min={50}
              max={500}
            />
            <NumberSetting
              label="RJ joueur non ouvert"
              value={localConfig.rjNonOpenedPenalty}
              field="rjNonOpenedPenalty"
              min={100}
              max={500}
            />
          </div>
        </div>

        {/* Cycles */}
        <div>
          <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">Cycles</h3>
          <div className="bg-slate-800 rounded-lg px-4">
            <NumberSetting
              label="Nombre max de cycles"
              value={localConfig.maxCycles}
              field="maxCycles"
              min={1}
              max={10}
            />
          </div>
        </div>

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
        <button onClick={() => onSave(localConfig)} className="btn-primary w-full py-3 text-lg">
          ✅ Sauvegarder
        </button>
      </div>
    </div>
  );
}
