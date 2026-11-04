"use client";
import { useCallback, useRef, useState } from "react";
import type { GameConfig } from "@/game/core/types";
import type { OnlineAction, OnlineSnapshot } from "@/game/online/protocol";
import { useOnlineConnection } from "@/game/hooks/useOnlineConnection";
import {
  creationIssues,
  onlineRequest,
  OnlineRequestError,
} from "@/game/online/client";
import GameRulesFields from "../rules/GameRulesFields";
import OnlineGameScreen from "./OnlineGameScreen";
interface Props {
  config: GameConfig;
  onBack: () => void;
  onLocal: () => void;
}
type Tab = "list" | "create" | "join";
/** Rules the 2v2 mode normalises away on the server, with the reason shown to the creator. */
const TEAMS_LOCKED = {
  chopObligatoire: "Le mode 2 contre 2 joue sans obligation ni malus CHOP.",
  malusChopOuverture: "Le mode 2 contre 2 joue sans obligation ni malus CHOP.",
  malusChopJoueurOuvertActif:
    "Le mode 2 contre 2 joue sans obligation ni malus CHOP.",
  malusChopJoueurOuvert:
    "Le mode 2 contre 2 joue sans obligation ni malus CHOP.",
  chopSeulementOuverture:
    "Le mode 2 contre 2 joue sans obligation ni malus CHOP.",
  chopCarteObligatoireAJouer:
    "Le mode 2 contre 2 joue sans obligation ni malus CHOP.",
} as const;
const ONLINE_AI_LOCKED = {
  aiDifficulty:
    "Aucun robot dans une table en ligne : ce réglage ne s'applique pas.",
} as const;
export default function OnlineLobby({ config, onBack, onLocal }: Props) {
  const [snapshot, setSnapshot] = useState<OnlineSnapshot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [canRetry, setCanRetry] = useState(false);
  const [name, setName] = useState(""),
    [tableName, setTableName] = useState(""),
    [privateTable, setPrivate] = useState(false),
    [password, setPassword] = useState(""),
    [joinId, setJoinId] = useState(""),
    [joinPassword, setJoinPassword] = useState(""),
    [joinAsSpectator, setJoinAsSpectator] = useState(false),
    // Table option: chosen at creation, adjustable by the host before start.
    [allowReplacement, setAllowReplacement] = useState(false);
  const [variant, setVariant] = useState<"classic" | "teams">("classic"),
    [count, setCount] = useState(4),
    [tab, setTab] = useState<Tab>("list"),
    [showRules, setShowRules] = useState(false);
  // A table keeps the rules chosen here, even if the general settings change later.
  const [rules, setRules] = useState<GameConfig>(() => ({
    ...config,
    variant: config.variant ?? "classic",
  }));
  const pending = useRef(false),
    retry = useRef<Record<string, unknown> | null>(null);
  const accept = useCallback(
    (incoming: OnlineSnapshot) =>
      setSnapshot((old) =>
        (old && incoming.serial < old.serial) ||
        (old?.room &&
          incoming.room?.id === old.room.id &&
          incoming.room.revision < old.room.revision)
          ? old
          : incoming,
      ),
    [],
  );
  const profile = useCallback(
    (savedName: string) => setName((current) => current || savedName),
    [],
  );
  const {
    connected,
    detail: connectionDetail,
    error: connectionError,
    transport,
    lastFailure,
    reconnect,
  } = useOnlineConnection(accept, profile);
  /** Why a public table cannot be joined right now (empty string = joinable). */
  const joinBlockReason = (
    table: { name: string; capacity: number; count: number; status: string },
    playerName: string,
    offline: boolean,
  ): string => {
    if (offline) return "Connexion au serveur requise.";
    if (!playerName.trim()) return "Renseignez votre nom pour rejoindre.";
    if (table.status === "playing") return "La partie a déjà commencé.";
    if (table.status === "finished") return "La partie est terminée.";
    if (table.count >= table.capacity)
      return "Table complète : plus aucune place.";
    return "";
  };
  const blockers = creationIssues({
    name,
    tableName,
    privateTable,
    password,
    connected,
    busy,
  });
  const teamMode = variant === "teams";
  const tableConfig: GameConfig = {
    ...rules,
    variant: teamMode ? "teams" : "classic",
    playerCount: teamMode ? 4 : (count as GameConfig["playerCount"]),
  };
  const submit = async (
    fields: Record<string, unknown>,
    repeat = false,
    retries = 0,
  ) => {
    if (pending.current || !connected) return;
    pending.current = true;
    setBusy(true);
    setCanRetry(false);
    setError("");
    setNotice("");
    const body = repeat
      ? retry.current
      : {
          ...fields,
          requestId: crypto.randomUUID(),
          revision: snapshot?.room?.revision,
        };
    if (!body) {
      pending.current = false;
      setBusy(false);
      return;
    }
    retry.current = body;
    try {
      const data = await onlineRequest(body);
      retry.current = null;
      accept(data.snapshot);
      setNotice(data.message ?? "");
      setPassword("");
      setJoinPassword("");
      return true;
    } catch (e) {
      // Stale revision (another player acted first). Refresh through an
      // authenticated POST — a GET carries no body, so it cannot present the
      // session token when the preview proxy strips cookies and headers — then
      // replay the SAME requestId, which the server dedupes. Bounded retries.
      const stale =
        e instanceof OnlineRequestError && e.status === 409 && retries < 2;
      if (stale) {
        try {
          const fresh = await onlineRequest({ command: "heartbeat" });
          accept(fresh.snapshot);
          if (retry.current)
            retry.current = {
              ...retry.current,
              revision: fresh.snapshot.room?.revision,
            };
        } catch {}
      } else if (
        e instanceof OnlineRequestError &&
        e.status >= 400 &&
        e.status < 500
      ) {
        retry.current = null;
      }
      setCanRetry(!!retry.current);
      setError(e instanceof Error ? e.message : "Connexion interrompue.");
      if (!stale) return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
    return submit({}, true, retries + 1);
  };
  const room = snapshot?.room,
    disabled = busy || !connected;
  const send = (action: OnlineAction) =>
    action.type === "replace" || action.type === "stopWatching"
      ? // Seating commands live at the top level of the protocol.
        submit({
          command: action.type,
          ...(action.type === "replace" && action.slot !== undefined ? { slot: action.slot } : {}),
        })
      : submit({ command: "action", action });
  const banner = (
    <div className="online-status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          {connected
            ? "● Connecté"
            : connectionError
              ? "Serveur ou session indisponible"
              : "Connexion au serveur…"}
        </span>
        {/* Stable, testable proof of which credential the server accepted. */}
        <span
          className="font-semibold"
          data-online-transport={transport ?? "none"}
          data-online-connected={connected ? "true" : "false"}
        >
          {transport === "token"
            ? "Session vérifiée par jeton sécurisé (cookie refusé par le navigateur)"
            : transport === "cookie"
              ? "Session vérifiée par cookie sécurisé"
              : "Aucune session vérifiée"}
        </span>
        {!connected && (
          <>
            <button type="button" className="underline" onClick={reconnect}>
              Reconnecter
            </button>
            <a
              className="underline"
              href="/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Ouvrir le jeu dans un nouvel onglet
            </a>
          </>
        )}
      </div>
      <p>{connectionDetail}</p>
      {/* Both the connection diagnostic and the last command error stay visible. */}
      {(connectionError || error) && (
        <p role="alert">{connectionError || error}</p>
      )}
      {lastFailure && (
        <p className="text-[11px] text-rose-200" data-online-last-failure>
          Requête en échec : {lastFailure}
        </p>
      )}
      {notice && <p>{notice}</p>}
      {canRetry && error && (
        <button onClick={() => void submit({}, true)}>
          Réessayer la même requête
        </button>
      )}
    </div>
  );
  if (room?.game)
    return (
      <div className="h-full flex flex-col">
        {/* Connection diagnostic stays visible while playing. */}
        {banner}
        <OnlineGameScreen
          room={room}
          disabled={disabled}
          send={send}
          onBack={onBack}
          onLeave={async () => {
            const question = room.allowReplacement
              ? "Quitter la partie ? Votre siège et vos cartes sont conservés, et un spectateur peut reprendre votre place. Vous pourrez revenir à tout moment avec ce navigateur."
              : "Quitter l’écran de jeu ? Votre siège et vos cartes resteront réservés, et vous pourrez revenir avec ce navigateur.";
            if (window.confirm(question)) {
              if (await submit({ command: "leave" })) onBack();
            }
          }}
          onClaimHost={() => void submit({ command: "claimHost" })}
        />
      </div>
    );
  const playerNameField = (
    <label className="block mb-3">
      <span className="text-sm text-slate-300">Votre nom</span>
      <input
        value={name}
        maxLength={30}
        required
        autoComplete="nickname"
        aria-invalid={!name.trim()}
        onChange={(e) => setName(e.target.value)}
        className="mt-1 w-full px-4 py-3 rounded-lg bg-slate-700 text-white placeholder-slate-400 border border-slate-600 focus:border-amber-500 focus:outline-none"
      />
    </label>
  );
  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-slate-900 via-emerald-950 to-slate-900">
      {/* Header, same convention as Settings / Scores */}
      <div className="flex items-center p-4 border-b border-slate-700">
        <button
          onClick={() => (room || tab === "list" ? onBack() : setTab("list"))}
          className="text-amber-400 font-bold mr-4"
        >
          ← Retour
        </button>
        <h2 className="text-xl font-bold text-amber-400 flex-1 text-center">
          👥 Multijoueur en ligne
        </h2>
        <div className="w-16" />
      </div>
      {banner}
      <div className="flex-1 overflow-y-auto p-4">
        {!snapshot && (
          <p className="text-center text-slate-400">
            {connectionError
              ? "Création indisponible tant que la session n’est pas vérifiée."
              : "Vérification de l’accès au serveur…"}
          </p>
        )}
        {room ? (
          /* ---------------- Waiting room ---------------- */
          <div className="space-y-6 max-w-md mx-auto">
            <div className="text-center">
              <h3 className="text-2xl font-bold text-amber-400">
                Salle d’attente — {room.name}
              </h3>
              <p className="text-sm text-slate-300 mt-1">
                {room.variant === "teams"
                  ? "2 contre 2 · Sud + Nord / Est + Ouest"
                  : "Rami classique"}{" "}
                · {room.count}/{room.capacity} ·{" "}
                {room.private ? "Privée" : "Publique"}
              </p>
              <p className="text-sm text-slate-400">
                Code :{" "}
                <strong className="text-amber-300 font-mono">{room.id}</strong>
              </p>
            </div>
            <div>
              <h4 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">
                Joueurs
              </h4>
              <ol className="bg-slate-800 rounded-lg p-3 space-y-1 text-sm">
                {Array.from({ length: room.capacity }, (_, i) => {
                  const m = room.members.find(
                    (x) => x.playerId === `player-${i}`,
                  );
                  return (
                    <li key={i} className="flex justify-between gap-2">
                      <span className={m ? "text-slate-200" : "text-slate-500"}>
                        {m ? m.name : "Place disponible"}
                      </span>
                      <span
                        className={
                          m?.connected ? "text-emerald-300" : "text-slate-500"
                        }
                      >
                        {m
                          ? `${m.seat} · ${m.ready ? "Prêt" : "Non prêt"} · ${m.connected ? "connecté" : "déconnecté"}${m.playerId === room.hostPlayerId ? " · Hôte" : ""}`
                          : "—"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div>
              <h4 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">
                Spectateurs{" "}
                {room.spectators.length ? `(${room.spectators.length})` : ""}
              </h4>
              <div
                className="bg-slate-800 rounded-lg p-3 text-sm text-slate-300"
                data-room-spectators
              >
                {room.spectators.length ? (
                  <ul className="space-y-1">
                    {room.spectators.map((sp, i) => (
                      <li key={i}>
                        {sp.name} · {sp.connected ? "connecté" : "absent"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-500">
                    Personne ne suit la table pour le moment.
                  </p>
                )}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">
                Options de la table
              </h4>
              <div className="bg-slate-800 rounded-lg p-3 text-sm text-slate-300">
                <p data-room-replacement>
                  Remplacement d’un joueur ayant quitté la partie :{" "}
                  <strong>
                    {room.allowReplacement ? "activé" : "désactivé"}
                  </strong>
                </p>
                {room.hostPlayerId === room.viewerId && !room.game && (
                  <button
                    className="btn-secondary w-full mt-2"
                    disabled={disabled}
                    onClick={() =>
                      void submit({
                        command: "setOptions",
                        allowReplacement: !room.allowReplacement,
                      })
                    }
                  >
                    {room.allowReplacement
                      ? "Désactiver le remplacement"
                      : "Activer le remplacement"}
                  </button>
                )}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">
                Règles de la table (définies par le créateur)
              </h4>
              <div
                className="bg-slate-800 rounded-lg p-3 text-sm text-slate-300"
                data-room-rules-summary
              >
                <ul className="space-y-1">
                  <li>
                    Mode :{" "}
                    {room.config.variant === "teams"
                      ? "2 contre 2"
                      : "Rami classique"}{" "}
                    · {room.config.playerCount} joueurs
                  </li>
                  <li>
                    CHOP obligatoire :{" "}
                    {room.config.chopObligatoire ? "oui" : "non"}
                  </li>
                  <li>
                    CHOP uniquement pour ouverture :{" "}
                    {room.config.chopSeulementOuverture ? "oui" : "non"}
                  </li>
                  <li>
                    Carte CHOP obligatoire à jouer :{" "}
                    {room.config.chopCarteObligatoireAJouer ? "oui" : "non"}
                  </li>
                  <li>
                    Tierce obligatoire :{" "}
                    {room.config.tierceObligatoire ? "oui" : "non"}
                  </li>
                  <li>
                    Carré retiré par :{" "}
                    {room.config.carreResponsable === "detenteur"
                      ? "le détenteur"
                      : "le compléteur"}
                  </li>
                  <li>
                    Malus CHOP ouverture : {room.config.malusChopOuverture} ·
                    joueur ouvert :{" "}
                    {room.config.malusChopJoueurOuvertActif
                      ? room.config.malusChopJoueurOuvert
                      : "désactivé"}
                  </li>
                  <li>
                    RS {room.config.rsScorePerCard}/carte · RJ{" "}
                    {room.config.rjScorePerCard}/carte · non ouvert RS{" "}
                    {room.config.rsNonOpenedPenalty} / RJ{" "}
                    {room.config.rjNonOpenedPenalty}
                  </li>
                  <li>
                    Pénalités : standard {room.config.faultePenalty} · Joker{" "}
                    {room.config.faulteJokerPenalty} · défausse jouable{" "}
                    {room.config.playableDiscardPenalty} · carré non récupéré{" "}
                    {room.config.carreNotRecoveredPenalty}
                  </li>
                  <li>
                    Cycles max : {room.config.maxCycles} · limite de points :{" "}
                    {room.config.targetScore ?? 0}
                  </li>
                </ul>
              </div>
              <details className="mt-2">
                <summary className="text-xs text-amber-300 cursor-pointer">
                  Voir le détail complet en lecture seule
                </summary>
                <div className="mt-3">
                  <GameRulesFields
                    config={room.config}
                    onChange={() => {}}
                    readOnly
                  />
                </div>
              </details>
            </div>
            <div className="space-y-3" data-room-actions>
              {room.viewerRole === "spectator" ? (
                <>
                  <p className="text-sm text-sky-200">
                    👁 Vous suivez cette table en spectateur. Vous ne pouvez pas
                    jouer
                    {room.allowReplacement
                      ? " tant qu’un siège n’est pas libéré ; le remplacement est activé."
                      : " : le remplacement d’un joueur ayant quitté la partie est désactivé."}
                  </p>
                  <button
                    disabled={disabled}
                    className="btn-secondary w-full py-3"
                    onClick={async () => {
                      if (await submit({ command: "stopWatching" }))
                        setTab("list");
                    }}
                  >
                    🚪 Quitter le spectacle
                  </button>
                </>
              ) : (
                <>
                  <button
                    disabled={disabled}
                    className="btn-primary w-full py-3"
                    onClick={() =>
                      void submit({
                        command: "ready",
                        ready: !room.members.find(
                          (m) => m.playerId === room.viewerId,
                        )?.ready,
                      })
                    }
                  >
                    {room.members.find((m) => m.playerId === room.viewerId)
                      ?.ready
                      ? "⏸ Ne plus être prêt"
                      : "✅ Prêt"}
                  </button>
                  {room.hostPlayerId === room.viewerId ? (
                    <>
                      <button
                        disabled={
                          disabled ||
                          room.count !== room.capacity ||
                          room.members.some((m) => !m.ready || !m.connected)
                        }
                        className="btn-primary w-full py-3 text-lg"
                        onClick={() => void submit({ command: "start" })}
                      >
                        🎮 Démarrer la partie
                      </button>
                      <button
                        className="btn-secondary w-full py-3"
                        onClick={async () => {
                          const invitation = `DZ-Rami — ${room.name}\n${location.origin}\nMultijoueur → Rejoindre une table\nCode : ${room.id}${room.private ? "\nMot de passe : à communiquer séparément par l’hôte." : ""}`;
                          try {
                            await navigator.clipboard.writeText(invitation);
                            setNotice("Invitation copiée.");
                          } catch {
                            setNotice(invitation);
                          }
                        }}
                      >
                        📋 Copier l’invitation
                      </button>
                    </>
                  ) : (
                    !room.members.find((m) => m.playerId === room.hostPlayerId)
                      ?.connected && (
                      <button
                        disabled={disabled}
                        className="btn-secondary w-full py-3"
                        onClick={() => void submit({ command: "claimHost" })}
                      >
                        👑 Reprendre le rôle d’hôte (après 30 s)
                      </button>
                    )
                  )}
                  {room.hostPlayerId === room.viewerId && !room.game && (
                    <button
                      disabled={disabled}
                      className="btn-danger w-full py-3"
                      onClick={async () => {
                        if (
                          !window.confirm(
                            "Supprimer cette table pour tout le monde ?",
                          )
                        )
                          return;
                        if (await submit({ command: "close" })) setTab("list");
                      }}
                    >
                      🗑 Supprimer la table
                    </button>
                  )}
                  <button
                    disabled={busy}
                    className="btn-secondary w-full py-3"
                    onClick={async () => {
                      if (await submit({ command: "leave" })) setTab("list");
                    }}
                  >
                    🚪 Quitter la table
                  </button>
                </>
              )}
            </div>
            <p className="text-sm text-slate-400">
              Reconnexion au même siège avec ce navigateur. Conservation :{" "}
              {snapshot.retentionMinutes} minutes après la dernière activité. Ne
              supprimez pas vos cookies.
            </p>
          </div>
        ) : (
          /* ---------------- Lobby ---------------- */
          <div className="max-w-md mx-auto space-y-6">
            {playerNameField}
            {tab === "create" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (blockers.length) return;
                  void submit({
                    command: "create",
                    name,
                    tableName,
                    private: privateTable,
                    password,
                    allowReplacement,
                    config: tableConfig,
                  });
                }}
              >
                <h3 className="text-xl font-bold text-amber-400 mb-3">
                  ➕ Créer une table
                </h3>
                <label className="block mb-3">
                  <span className="text-sm text-slate-300">
                    Nom de la table
                  </span>
                  <input
                    required
                    maxLength={60}
                    value={tableName}
                    aria-invalid={!tableName.trim()}
                    aria-describedby="create-blockers"
                    onChange={(e) => setTableName(e.target.value)}
                    className="mt-1 w-full px-4 py-3 rounded-lg bg-slate-700 text-white placeholder-slate-400 border border-slate-600 focus:border-amber-500 focus:outline-none"
                  />
                </label>
                <label className="block mb-3">
                  <span className="text-sm text-slate-300">Mode</span>
                  <select
                    value={variant}
                    onChange={(e) =>
                      setVariant(e.target.value as "classic" | "teams")
                    }
                    className="mt-1 w-full px-4 py-3 rounded-lg bg-slate-700 text-white border border-slate-600 focus:border-amber-500 focus:outline-none"
                  >
                    <option value="classic">Rami classique</option>
                    <option value="teams">2 contre 2</option>
                  </select>
                </label>
                <label className="block mb-3">
                  <span className="text-sm text-slate-300">
                    Nombre de joueurs
                  </span>
                  <select
                    value={teamMode ? 4 : count}
                    disabled={teamMode}
                    onChange={(e) => setCount(Number(e.target.value))}
                    className="mt-1 w-full px-4 py-3 rounded-lg bg-slate-700 text-white border border-slate-600 focus:border-amber-500 focus:outline-none disabled:opacity-50"
                  >
                    {[2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n} joueurs
                      </option>
                    ))}
                  </select>
                  {teamMode && (
                    <span className="text-[11px] text-slate-500">
                      Le 2 contre 2 se joue obligatoirement à 4 joueurs.
                    </span>
                  )}
                </label>
                <label className="flex items-center gap-2 mb-3 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={privateTable}
                    onChange={(e) => setPrivate(e.target.checked)}
                  />
                  Table privée
                </label>
                <label className="flex items-center gap-2 mb-1 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={allowReplacement}
                    onChange={(e) => setAllowReplacement(e.target.checked)}
                  />
                  Remplacement d’un joueur ayant quitté la partie
                </label>
                <p className="text-[11px] text-slate-500 mb-3">
                  Si activé, un spectateur peut reprendre le siège (et la main
                  déjà distribuée) d’un joueur qui quitte la partie. Sinon le
                  siège reste réservé à son propriétaire.
                </p>
                {privateTable && (
                  <label className="block mb-3">
                    <span className="text-sm text-slate-300">
                      Mot de passe (8 caractères minimum)
                    </span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      maxLength={128}
                      value={password}
                      aria-invalid={password.length < 8}
                      aria-describedby="create-blockers"
                      onChange={(e) => setPassword(e.target.value)}
                      className="mt-1 w-full px-4 py-3 rounded-lg bg-slate-700 text-white border border-slate-600 focus:border-amber-500 focus:outline-none"
                    />
                  </label>
                )}
                <div className="bg-slate-800 rounded-lg p-4 mb-4">
                  <button
                    type="button"
                    data-create-rules-toggle
                    className="w-full flex items-center justify-between text-left"
                    aria-expanded={showRules}
                    onClick={() => setShowRules((v) => !v)}
                  >
                    <span className="text-sm font-bold text-amber-400 uppercase tracking-wider">
                      Règles de cette table
                    </span>
                    <span className="text-amber-300 text-sm">
                      {showRules ? "▲ masquer" : "▼ personnaliser"}
                    </span>
                  </button>
                  <p className="text-xs text-slate-400 mt-2">
                    Elles sont enregistrées avec la table et s&apos;appliquent à
                    tous ses joueurs, même si vos paramètres généraux changent.
                  </p>
                  <div
                    className="mt-2 text-xs text-slate-300"
                    data-create-rules-summary
                  >
                    Mode {teamMode ? "2 contre 2" : "classique"} ·{" "}
                    {tableConfig.playerCount} joueurs · CHOP obligatoire{" "}
                    {tableConfig.chopObligatoire ? "oui" : "non"} · tierce
                    obligatoire {tableConfig.tierceObligatoire ? "oui" : "non"}{" "}
                    · malus CHOP {tableConfig.malusChopOuverture}/{" "}
                    {tableConfig.malusChopJoueurOuvertActif
                      ? tableConfig.malusChopJoueurOuvert
                      : "off"}{" "}
                    · cycles {tableConfig.maxCycles} · limite{" "}
                    {tableConfig.targetScore ?? 0}
                  </div>
                </div>
                {showRules && (
                  <div className="mb-6">
                    <GameRulesFields
                      config={tableConfig}
                      showAi={false}
                      locked={{
                        ...ONLINE_AI_LOCKED,
                        ...(teamMode ? TEAMS_LOCKED : {}),
                      }}
                      onChange={(key, value) =>
                        setRules((prev) => ({ ...prev, [key]: value }))
                      }
                    />
                    <button
                      type="button"
                      className="btn-secondary w-full py-3 mt-3"
                      onClick={() =>
                        setRules({ ...config, variant: rules.variant })
                      }
                    >
                      🔄 Règles par défaut
                    </button>
                  </div>
                )}
                <div
                  id="create-blockers"
                  role="status"
                  aria-live="polite"
                  className="mb-3 text-sm"
                >
                  {blockers.length ? (
                    <>
                      <p className="text-rose-200">
                        Création impossible pour le moment :
                      </p>
                      <ul className="list-disc pl-5 text-rose-200">
                        {blockers.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="text-emerald-200">
                      Tous les champs obligatoires sont remplis. Vous pouvez
                      créer la table.
                    </p>
                  )}
                </div>
                <button
                  type="submit"
                  className="btn-primary w-full py-3 text-lg"
                  disabled={blockers.length > 0}
                  aria-describedby="create-blockers"
                >
                  {busy ? "Création en cours…" : "➕ Créer la table"}
                </button>
              </form>
            )}
            {tab === "join" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit({
                    command: "join",
                    name,
                    tableId: joinId,
                    password: joinPassword,
                  });
                }}
              >
                <h3 className="text-xl font-bold text-amber-400 mb-3">
                  🔑 Rejoindre une table
                </h3>
                <label className="block mb-3">
                  <span className="text-sm text-slate-300">
                    Code ou nom de la table
                  </span>
                  <input
                    required
                    maxLength={80}
                    value={joinId}
                    onChange={(e) => setJoinId(e.target.value)}
                    className="mt-1 w-full px-4 py-3 rounded-lg bg-slate-700 text-white placeholder-slate-400 border border-slate-600 focus:border-amber-500 focus:outline-none"
                  />
                </label>
                <label className="block mb-3">
                  <span className="text-sm text-slate-300">
                    Mot de passe (table privée)
                  </span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    maxLength={128}
                    value={joinPassword}
                    onChange={(e) => setJoinPassword(e.target.value)}
                    className="mt-1 w-full px-4 py-3 rounded-lg bg-slate-700 text-white border border-slate-600 focus:border-amber-500 focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-2 mb-3 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={joinAsSpectator}
                    onChange={(e) => setJoinAsSpectator(e.target.checked)}
                  />
                  Entrer en spectateur (sans jouer)
                </label>
                <button
                  type="submit"
                  className={
                    joinAsSpectator
                      ? "btn-secondary w-full py-3 text-lg"
                      : "btn-primary w-full py-3 text-lg"
                  }
                  disabled={disabled || !name.trim()}
                >
                  {busy
                    ? "Connexion en cours…"
                    : joinAsSpectator
                      ? "👁 Regarder la table"
                      : "🔑 Rejoindre la table"}
                </button>
              </form>
            )}
            {tab === "list" && (
              <>
                <div className="w-full space-y-3" data-lobby-menu>
                  <button
                    className="btn-primary w-full py-3 text-lg"
                    onClick={() => setTab("create")}
                  >
                    ➕ Créer une table
                  </button>
                  <button
                    className="btn-primary w-full py-3 text-lg"
                    onClick={() => setTab("join")}
                  >
                    🔑 Rejoindre une table
                  </button>
                  <button
                    className="btn-secondary w-full py-3"
                    onClick={onLocal}
                  >
                    💻 Mode local existant
                  </button>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2">
                    Tables publiques · actualisation automatique
                  </h3>
                  {!snapshot?.tables.length && (
                    <p className="text-sm text-slate-400">
                      Aucune table publique disponible.
                    </p>
                  )}
                  <div className="space-y-2">
                    {snapshot?.tables.map((t) => (
                      <div key={t.id} className="bg-slate-800 rounded-lg p-3">
                        <div className="flex flex-wrap gap-2 items-center justify-between">
                          <div className="text-sm">
                            <strong className="text-slate-100">{t.name}</strong>
                            <span className="text-slate-400">
                              {" "}
                              ·{" "}
                              {t.variant === "teams"
                                ? "2 contre 2"
                                : "Classique"}{" "}
                              · {t.count}/{t.capacity}
                              {t.spectatorCount > 0
                                ? ` · 👁 ${t.spectatorCount}`
                                : ""}{" "}
                              ·{" "}
                              {
                                {
                                  waiting: "En attente",
                                  full: "Complète",
                                  playing: "En cours",
                                  finished: "Terminée",
                                }[t.status]
                              }
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              className="btn-primary"
                              disabled={Boolean(
                                joinBlockReason(t, name, !connected),
                              )}
                              title={
                                joinBlockReason(t, name, !connected) ??
                                `Rejoindre ${t.name}`
                              }
                              onClick={() =>
                                void submit({
                                  command: "join",
                                  tableId: t.id,
                                  name,
                                })
                              }
                            >
                              Rejoindre
                            </button>
                            <button
                              className="btn-secondary"
                              disabled={disabled}
                              title={`Regarder ${t.name} sans jouer`}
                              onClick={() =>
                                void submit({
                                  command: "join",
                                  tableId: t.id,
                                  name,
                                  asSpectator: true,
                                })
                              }
                            >
                              👁 Spectateur
                            </button>
                          </div>
                        </div>
                        {joinBlockReason(t, name, !connected) && (
                          <p className="text-[11px] text-rose-200 mt-1">
                            {joinBlockReason(t, name, !connected)}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
