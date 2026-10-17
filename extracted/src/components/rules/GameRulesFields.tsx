"use client";
import { GameConfig } from "@/game/core/types";

type NumericConfigField = {
  [Key in keyof GameConfig]-?: Exclude<
    GameConfig[Key],
    undefined
  > extends number
    ? Key
    : never;
}[keyof GameConfig];
type BooleanConfigField = {
  [Key in keyof GameConfig]-?: GameConfig[Key] extends boolean ? Key : never;
}[keyof GameConfig];

export interface RulesFieldsProps {
  config: GameConfig;
  onChange: <K extends keyof GameConfig>(key: K, value: GameConfig[K]) => void;
  /** Field → why it is not editable (mode-incompatible, read-only table, …). */
  locked?: Partial<Record<keyof GameConfig, string>>;
  /** Read-only display (waiting room: joiners see the host's rules, they never edit them). */
  readOnly?: boolean;
  /** Online tables never contain robots. */
  showAi?: boolean;
}

interface NumberSettingProps {
  label: string;
  value: number;
  field: NumericConfigField;
  min?: number;
  max?: number;
  step?: number;
  reason?: string;
  onUpdate: (field: NumericConfigField, value: number) => void;
}

function NumberSetting({
  label,
  value,
  field,
  min = 0,
  max = 999,
  step = field.includes("malus") ? 5 : 10,
  reason,
  onUpdate,
}: NumberSettingProps) {
  const disabled = Boolean(reason);
  return (
    <div
      data-setting={field}
      className="flex items-center justify-between py-3 border-b border-slate-700"
    >
      <span
        className={`text-sm ${disabled ? "text-slate-500" : "text-slate-300"}`}
      >
        {label}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          aria-label={`Diminuer ${label}`}
          onClick={() => onUpdate(field, Math.max(min, value - step))}
          className="w-8 h-8 rounded-full bg-slate-600 text-white font-bold text-lg flex items-center justify-center disabled:opacity-40"
        >
          −
        </button>
        <span
          className={`w-12 text-center font-mono font-bold ${disabled ? "text-slate-400" : "text-amber-400"}`}
        >
          {value}
        </span>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Augmenter ${label}`}
          onClick={() => onUpdate(field, Math.min(max, value + step))}
          className="w-8 h-8 rounded-full bg-slate-600 text-white font-bold text-lg flex items-center justify-center disabled:opacity-40"
        >
          +
        </button>
      </div>
      {reason && (
        <span className="text-[11px] text-slate-500 basis-full pt-1">
          {reason}
        </span>
      )}
    </div>
  );
}

interface ToggleSettingProps {
  label: string;
  value: boolean;
  field: BooleanConfigField;
  reason?: string;
  onUpdate: (field: BooleanConfigField, value: boolean) => void;
}

function ToggleSetting({
  label,
  value,
  field,
  reason,
  onUpdate,
}: ToggleSettingProps) {
  const disabled = Boolean(reason);
  return (
    <div
      data-setting={field}
      className="flex flex-wrap items-center justify-between py-3 border-b border-slate-700"
    >
      <span
        className={`text-sm ${disabled ? "text-slate-500" : "text-slate-300"}`}
      >
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={value}
        disabled={disabled}
        onClick={() => onUpdate(field, !value)}
        className={`w-14 h-7 rounded-full transition-colors relative disabled:opacity-40 ${value && !disabled ? "bg-amber-500" : "bg-slate-600"}`}
      >
        <div
          className={`w-5 h-5 rounded-full bg-white absolute top-1 transition-transform ${value ? "translate-x-8" : "translate-x-1"}`}
        />
      </button>
      {reason && (
        <span className="text-[11px] text-slate-500 basis-full pt-1">
          {reason}
        </span>
      )}
    </div>
  );
}

/**
 * The single editable source of the game rules. Shared by the local settings
 * screen and the online table-creation panel so both never diverge.
 */
export default function GameRulesFields({
  config,
  onChange,
  locked = {},
  readOnly = false,
  showAi = true,
}: RulesFieldsProps) {
  const reasonFor = (field: keyof GameConfig) =>
    readOnly ? "Règles de la table, définies par le créateur." : locked[field];
  const update = <K extends keyof GameConfig>(key: K, value: GameConfig[K]) => {
    if (readOnly || locked[key]) return;
    onChange(key, value);
  };
  const updateNumber: NumberSettingProps["onUpdate"] = (field, value) =>
    update(field, value);
  const updateToggle: ToggleSettingProps["onUpdate"] = (field, value) =>
    update(field, value);
  const chopLocked = reasonFor("chopObligatoire");
  return (
    <div className="space-y-6">
      {/* CHOP */}
      <div>
        <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">
          CHOP
        </h3>
        <div className="bg-slate-800 rounded-lg px-4">
          <ToggleSetting
            label="CHOP obligatoire"
            value={config.chopObligatoire}
            field="chopObligatoire"
            reason={chopLocked}
            onUpdate={updateToggle}
          />
          <p className="text-[11px] text-slate-500 pb-2 pt-1">
            Quand une carte peut être chopée, le moteur bloque la pioche normale
            jusqu&apos;au CHOP ou à son annulation.
          </p>
          <NumberSetting
            label="Malus CHOP ouverture"
            value={config.malusChopOuverture}
            field="malusChopOuverture"
            min={0}
            max={200}
            reason={chopLocked}
            onUpdate={updateNumber}
          />
          <ToggleSetting
            label="Malus CHOP joueur ouvert"
            value={config.malusChopJoueurOuvertActif}
            field="malusChopJoueurOuvertActif"
            reason={reasonFor("malusChopJoueurOuvertActif")}
            onUpdate={updateToggle}
          />
          {config.malusChopJoueurOuvertActif && (
            <NumberSetting
              label="↳ Valeur du malus"
              value={config.malusChopJoueurOuvert}
              field="malusChopJoueurOuvert"
              min={0}
              max={100}
              reason={reasonFor("malusChopJoueurOuvert")}
              onUpdate={updateNumber}
            />
          )}
          <ToggleSetting
            label="CHOP uniquement pour ouverture"
            value={config.chopSeulementOuverture}
            field="chopSeulementOuverture"
            reason={reasonFor("chopSeulementOuverture")}
            onUpdate={updateToggle}
          />
          <p className="text-[11px] text-slate-500 pb-3 pt-1">
            Si activé, un joueur non ouvert qui chope doit obligatoirement
            ouvrir ce tour-ci : il ne peut pas défausser sans avoir ouvert, ou
            doit annuler pour rendre la carte chopée.
          </p>
          <ToggleSetting
            label="Carte CHOP obligatoire à jouer ce tour"
            value={config.chopCarteObligatoireAJouer}
            field="chopCarteObligatoireAJouer"
            reason={reasonFor("chopCarteObligatoireAJouer")}
            onUpdate={updateToggle}
          />
          <p className="text-[11px] text-slate-500 pb-3 pt-1">
            La carte chopée doit entrer dans une combinaison valide avant la
            défausse. Le CHOP peut être annulé avant toute autre action.
          </p>
        </div>
      </div>

      {/* Règles d'ouverture */}
      <div>
        <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">
          Ouverture
        </h3>
        <div className="bg-slate-800 rounded-lg px-4">
          <ToggleSetting
            label="Tierce obligatoire à l'ouverture"
            value={config.tierceObligatoire}
            field="tierceObligatoire"
            reason={reasonFor("tierceObligatoire")}
            onUpdate={updateToggle}
          />
          <p className="text-[11px] text-slate-500 pb-3 pt-1">
            Si activé, le moteur refuse l&apos;ouverture tant qu&apos;une tierce
            naturelle (sans Joker) n&apos;est pas présente dans la VIERGE.
          </p>
        </div>
      </div>

      {/* Carré */}
      <div>
        <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">
          Carré
        </h3>
        <div className="bg-slate-800 rounded-lg px-4">
          <div className="flex flex-wrap items-center justify-between py-3 border-b border-slate-700">
            <span
              className={`text-sm ${reasonFor("carreResponsable") ? "text-slate-500" : "text-slate-300"}`}
            >
              Responsable du retrait
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => update("carreResponsable", "detenteur")}
                disabled={Boolean(reasonFor("carreResponsable"))}
                className={`px-3 py-1 rounded text-xs font-bold disabled:opacity-40 ${config.carreResponsable === "detenteur" ? "bg-amber-500 text-white" : "bg-slate-600 text-slate-300"}`}
              >
                Détenteur
              </button>
              <button
                onClick={() => update("carreResponsable", "completeur")}
                disabled={Boolean(reasonFor("carreResponsable"))}
                className={`px-3 py-1 rounded text-xs font-bold disabled:opacity-40 ${config.carreResponsable === "completeur" ? "bg-amber-500 text-white" : "bg-slate-600 text-slate-300"}`}
              >
                Compléteur
              </button>
            </div>
            {reasonFor("carreResponsable") && (
              <span className="text-[11px] text-slate-500 basis-full pt-1">
                {reasonFor("carreResponsable")}
              </span>
            )}
          </div>
          <NumberSetting
            label="Pénalité carré non récupéré"
            value={config.carreNotRecoveredPenalty}
            field="carreNotRecoveredPenalty"
            min={0}
            max={300}
            reason={reasonFor("carreNotRecoveredPenalty")}
            onUpdate={updateNumber}
          />
        </div>
      </div>

      {/* Fautes */}
      <div>
        <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">
          Fautes
        </h3>
        <div className="bg-slate-800 rounded-lg px-4">
          <NumberSetting
            label="Pénalité standard"
            value={config.faultePenalty}
            field="faultePenalty"
            min={0}
            max={500}
            reason={reasonFor("faultePenalty")}
            onUpdate={updateNumber}
          />
          <NumberSetting
            label="Pénalité spéciale Joker"
            value={config.faulteJokerPenalty}
            field="faulteJokerPenalty"
            min={0}
            max={500}
            reason={reasonFor("faulteJokerPenalty")}
            onUpdate={updateNumber}
          />
          <NumberSetting
            label="Pénalité défausse jouable"
            value={config.playableDiscardPenalty}
            field="playableDiscardPenalty"
            min={0}
            max={300}
            reason={reasonFor("playableDiscardPenalty")}
            onUpdate={updateNumber}
          />
        </div>
      </div>

      {/* Scores */}
      <div>
        <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">
          Scores
        </h3>
        <div className="bg-slate-800 rounded-lg px-4">
          <NumberSetting
            label="RS par carte restante"
            value={config.rsScorePerCard}
            field="rsScorePerCard"
            min={5}
            max={50}
            reason={reasonFor("rsScorePerCard")}
            onUpdate={updateNumber}
          />
          <NumberSetting
            label="RJ par carte restante"
            value={config.rjScorePerCard}
            field="rjScorePerCard"
            min={10}
            max={100}
            reason={reasonFor("rjScorePerCard")}
            onUpdate={updateNumber}
          />
          <NumberSetting
            label="RS joueur non ouvert"
            value={config.rsNonOpenedPenalty}
            field="rsNonOpenedPenalty"
            min={50}
            max={500}
            reason={reasonFor("rsNonOpenedPenalty")}
            onUpdate={updateNumber}
          />
          <NumberSetting
            label="RJ joueur non ouvert"
            value={config.rjNonOpenedPenalty}
            field="rjNonOpenedPenalty"
            min={100}
            max={500}
            reason={reasonFor("rjNonOpenedPenalty")}
            onUpdate={updateNumber}
          />
        </div>
      </div>

      {/* Intelligence artificielle */}
      {showAi && (
        <div>
          <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">
            Robots
          </h3>
          <div className="bg-slate-800 rounded-lg p-3">
            <p
              className={`text-sm mb-2 ${reasonFor("aiDifficulty") ? "text-slate-500" : "text-slate-300"}`}
            >
              Difficulté
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["easy", "Facile"],
                  ["normal", "Normal"],
                  ["hard", "Difficile"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={config.aiDifficulty === value}
                  disabled={Boolean(reasonFor("aiDifficulty"))}
                  onClick={() => update("aiDifficulty", value)}
                  className={`min-h-10 rounded-lg px-2 text-sm font-bold disabled:opacity-40 ${config.aiDifficulty === value ? "bg-amber-500 text-white" : "bg-slate-700 text-slate-300"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              {reasonFor("aiDifficulty") ??
                "Le niveau ajuste la prise de risque au CHOP; toutes les combinaisons et ouvertures restent validées par le moteur."}
            </p>
          </div>
        </div>
      )}

      {/* Cycles */}
      <div>
        <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">
          Cycles
        </h3>
        <div className="bg-slate-800 rounded-lg px-4">
          <NumberSetting
            label="Nombre max de cycles"
            value={config.maxCycles}
            field="maxCycles"
            step={1}
            min={1}
            max={10}
            reason={reasonFor("maxCycles")}
            onUpdate={updateNumber}
          />
        </div>
      </div>

      <div className="bg-slate-800 rounded-lg px-4">
        <NumberSetting
          label="Limite de points de la partie"
          field="targetScore"
          value={config.targetScore ?? 0}
          min={0}
          max={3000}
          step={100}
          reason={reasonFor("targetScore")}
          onUpdate={updateNumber}
        />
        <p className="text-xs text-slate-400 pb-3">
          0 : sans limite. Sinon, fin de partie après une manche dès qu&apos;un
          joueur atteint cette limite. Le score le plus bas gagne.
        </p>
      </div>
    </div>
  );
}
