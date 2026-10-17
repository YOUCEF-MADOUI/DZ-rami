"use client";
import { useEffect, useState, type CSSProperties } from "react";
import type { OnlineAction, RoomView } from "@/game/online/protocol";
import {
  getSeatOrder,
  type Combination,
  type GameCard,
  type FaultType,
  type JokerPlacement,
  SUIT_SYMBOLS,
} from "@/game/core/types";
import { detectHandGroups, moveBlock } from "@/game/core/hand-groups";
import {
  detectCombinationType,
  resolveJokerPlacement,
  getJokerExtensionChoices,
  getJokerRepresentation,
} from "@/game/core/validation";
import { REPORTABLE_FAULTS } from "@/game/core/engine";
import { getCombinationClassLabel } from "@/game/core/validation";
import {
  tableCards,
  tableCombinations,
  playerColor,
} from "../presentation/table-order";
import { sortCards } from "../GameScreen";
import PlayerHand, { type SortMode } from "../PlayerHand";
import CardView from "../CardView";
import OpponentHand from "../OpponentHand";
import DiscardSpread from "../DiscardSpread";
import StockEffects from "../StockEffects";
import DiscardEffects from "../DiscardEffects";
import FittedTable from "../FittedTable";
import ScoreBoard from "../ScoreBoard";
/** Same label the local screen shows for a chosen Joker slot. */
function jokerPlacementLabel(placement: JokerPlacement): string {
  return `${placement.represents.rank}${SUIT_SYMBOLS[placement.represents.suit]}`;
}
interface Props {
  room: RoomView;
  disabled: boolean;
  send: (action: OnlineAction) => Promise<boolean | undefined>;
  onBack: () => void;
  onLeave: () => void;
  onClaimHost: () => void;
}
interface HandView {
  order: string[];
  locks: string[][];
  mode: SortMode;
}
export default function OnlineGameScreen({
  room,
  disabled,
  send,
  onBack,
  onLeave,
  onClaimHost,
}: Props) {
  const spectator = room.viewerRole === "spectator";
  const game = room.game!,
    viewer = spectator
      ? // Watchers have no seat: a neutral placeholder keeps the layout identical.
        {
          id: "",
          name: "Spectateur",
          seat: "south" as const,
          status: "not_opened" as const,
          isAI: false,
          score: 0,
          roundScores: [],
          handCount: 0,
        }
      : game.players.find((p) => p.id === game.viewerId)!;
  const storageKey = `dz-rami:online-view:${room.id}:${game.viewerId}`;
  const [view, setView] = useState<HandView>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (
        saved &&
        Array.isArray(saved.order) &&
        Array.isArray(saved.locks) &&
        ["rank", "suit", "manual"].includes(saved.mode)
      )
        return saved;
    } catch {}
    return { order: [], locks: [], mode: "rank" };
  });
  const [selected, setSelected] = useState<string[]>([]),
    [scores, setScores] = useState(false),
    [zoom, setZoom] = useState<Combination[] | null>(null),
    [inspect, setInspect] = useState(false),
    [report, setReport] = useState(""),
    [fault, setFault] = useState<FaultType>("playable_discard"),
    [joker, setJoker] = useState<{ card: GameCard; combo: Combination } | null>(
      null,
    );
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(view));
    } catch {}
  }, [storageKey, view]);
  const byId = new Map(game.localHand.map((c) => [c.id, c]));
  const cards =
    view.mode === "manual"
      ? [
          ...view.order
            .map((id) => byId.get(id))
            .filter((c): c is GameCard => !!c),
          ...game.localHand.filter((c) => !view.order.includes(c.id)),
        ]
      : sortCards(game.localHand, view.mode);
  const selection = cards.filter((c) => selected.includes(c.id)),
    selectedIds = selection.map((c) => c.id);
  const locks = view.locks
    .map((ids) => ids.filter((id) => byId.has(id)))
    .filter((ids) => ids.length >= 2);
  const mine =
      !spectator &&
      game.currentPlayerId === game.viewerId &&
      game.phase === "playing",
    canPlay = mine && !disabled && game.turnPhase === "playing",
    actions = game.actions;
  /** Same derivations as the local screen, from the authoritative server state. */
  const detectedType =
    selectedIds.length >= 3 ? detectCombinationType(selection) : null;
  const pendingJokerPlacement = detectedType
    ? resolveJokerPlacement(selection, detectedType)
    : null;
  /**
   * Same behaviour as the local screen: the card just drawn from the deck is
   * selected automatically, so the next action applies to it straight away.
   * Derived during render (the documented React pattern) instead of in an effect.
   */
  const [acknowledgedDraw, setAcknowledgedDraw] = useState<string | null>(null);
  const drawnCardId =
    game.draw?.source === "deck" && game.draw.targetCardId
      ? game.draw.targetCardId
      : null;
  const drawnCard = drawnCardId
    ? game.localHand.find((c) => c.id === drawnCardId)
    : undefined;
  if (drawnCard && game.draw && acknowledgedDraw !== game.draw.id) {
    setAcknowledgedDraw(game.draw.id);
    setSelected([drawnCard.id]);
  }

  const longestRecovery = selection.length
    ? actions?.possibleJokerRecoveries.find((r) =>
        r.replacementCardIds.every((id) => selectedIds.includes(id)),
      )
    : undefined;
  const discardCard = (cardId: string, faceDown: boolean) =>
    act({ type: "discard", cardId, faceDown });
  const act = async (action: OnlineAction) => {
    if (disabled) return;
    if (await send(action)) setSelected([]);
  };
  const add = (cardId: string, combo: Combination) => {
    const card = byId.get(cardId);
    if (!card || !canPlay) return;
    const recovery = actions?.possibleJokerRecoveries.find(
      (r) =>
        r.combinationId === combo.id && r.replacementCardIds.includes(cardId),
    );
    if (recovery) {
      void act({
        type: "recover",
        comboId: combo.id,
        cardIds: recovery.replacementCardIds,
      });
      return;
    }
    if (card.isJoker && combo.type === "tierce") {
      setJoker({ card, combo });
      return;
    }
    void act({ type: "add", cardId, comboId: combo.id });
  };
  const comboView = (combo: Combination, large = false) => (
    <div
      key={combo.id}
      data-online-combo={combo.id}
      className="table-meld rounded p-1 border border-white/20"
      onClick={() => {
        if (selection.length === 1 && !large) add(selection[0].id, combo);
      }}
    >
      <div
        className={`meld-fan ${large ? "meld-fan-zoom" : ""}`}
        style={{ "--fan-count": combo.cards.length } as CSSProperties}
      >
        {tableCards(combo).map((c) => (
          <CardView
            key={c.id}
            card={c}
            small={!large}
            groupColor={playerColor(game.players, combo.ownerId)}
            jokerAs={
              c.isJoker
                ? (() => {
                    const r = getJokerRepresentation(combo);
                    return (
                      r?.candidates
                        .map((c) => `${c.rank}${SUIT_SYMBOLS[c.suit]}`)
                        .join(" / ") ?? "?"
                    );
                  })()
                : undefined
            }
          />
        ))}
      </div>
      <div className="flex gap-1">
        <button
          className="text-xs text-sky-200"
          aria-label="Agrandir la combinaison"
          onClick={(e) => {
            e.stopPropagation();
            setZoom([combo]);
          }}
        >
          ⌕
        </button>
        {!large && actions?.returnableCarreIds.includes(combo.id) && (
          <button
            className="text-xs text-amber-200"
            disabled={!canPlay}
            onClick={(e) => {
              e.stopPropagation();
              void act({ type: "returnCarre", comboId: combo.id });
            }}
          >
            Rentrer le carré
          </button>
        )}
        {!large && selection.length === 1 && (
          <button
            className="text-xs"
            disabled={!canPlay}
            onClick={(e) => {
              e.stopPropagation();
              add(selection[0].id, combo);
            }}
          >
            Ajouter / remplacer Joker
          </button>
        )}
      </div>
    </div>
  );
  if (scores)
    return <ScoreBoard gameState={game} onBack={() => setScores(false)} />;
  const currentName = game.players.find(
    (p) => p.id === game.currentPlayerId,
  )?.name;
  const seatOrder = getSeatOrder(game.players.length),
    viewerSeat = seatOrder.indexOf(viewer.seat);
  return (
    <div
      data-game-root
      data-player-count={game.players.length}
      className="game-layout online-game flex-1 min-h-0 flex flex-col text-white table-large"
    >
      <DiscardEffects event={game.lastDiscard} />
      <StockEffects
        round={game.roundNumber}
        dealerId={game.firstPlayerId}
        starterId={game.firstPlayerId}
        viewerId={viewer.id}
        players={game.players}
        draw={game.draw}
        pristine={game.pristine}
        animateInitialDeal={false}
      />
      <div className="game-table-surface arena-stage flex-1 min-h-0 relative">
        <div
          className="pointer-events-none absolute inset-2 rounded-2xl border-4 border-amber-900/50"
          style={{
            background:
              "radial-gradient(ellipse at center, #2d7a45 0%, #1a5c2e 60%, #14472a 100%)",
            boxShadow: "inset 0 0 50px rgba(0,0,0,0.4)",
          }}
        />
        <div className="opponent-strip">
          {game.players
            .filter((p) => p.id !== viewer.id)
            .map((p) => {
              const seat =
                seatOrder[
                  (seatOrder.indexOf(p.seat) - viewerSeat + seatOrder.length) %
                    seatOrder.length
                ];
              return (
                <section
                  key={p.id}
                  data-player-zone={p.id}
                  data-seat={seat}
                  className="seat-panel"
                >
                  <div className="seat-panel-heading">
                    <button
                      className="seat-player-name"
                      style={{ color: playerColor(game.players, p.id) }}
                      onClick={() => setReport(p.id)}
                    >
                      {p.name} ({p.handCount}){" "}
                      {p.status === "opened" ? "✓" : ""}
                    </button>
                    <span className="text-[9px]">
                      {room.members.find((m) => m.playerId === p.id)?.connected
                        ? "En ligne"
                        : "Absent · siège réservé"}
                    </span>
                    <button
                      className="seat-zoom"
                      aria-label={`Combinaisons publiques de ${p.name}`}
                      onClick={() =>
                        setZoom(
                          game.tableCombinations.filter(
                            (c) => c.ownerId === p.id,
                          ),
                        )
                      }
                    >
                      ⌕
                    </button>
                  </div>
                  <OpponentHand count={p.handCount} name={p.name} />
                </section>
              );
            })}
        </div>
        <FittedTable>
          <section
            aria-label="Combinaisons publiques"
            className="public-meld-table player-meld-zone"
          >
            {tableCombinations(game.tableCombinations).map((c) => comboView(c))}
          </section>
          {game.myDraft.length > 0 && (
            <section
              className="public-meld-table border border-dashed border-amber-400"
              aria-label="Votre brouillon privé"
            >
              <span>Brouillon — à valider</span>
              {tableCombinations(game.myDraft).map((c) => comboView(c))}
            </section>
          )}
        </FittedTable>
      </div>
      {/* Identical to the local screen: the discard dock sits above the hand. */}
      <div
        data-discard-zone="true"
        data-discard-hub
        aria-label="Défausse au-dessus de la main"
        className="discard-dock relative z-20 flex w-full items-center justify-center gap-1 sm:gap-3 rounded-2xl border-2 px-1 transition-colors border-amber-900/70 bg-slate-950/65"
      >
        <div
          data-stock-zone
          className="relative z-10 flex-shrink-0 text-center"
        >
          <CardView
            card={{
              id: "deck",
              isJoker: false,
              rank: "A",
              suit: "spades",
              pack: 1,
            }}
            faceDown
            small
            disabled={
              !(
                mine &&
                !disabled &&
                game.turnPhase === "must_draw" &&
                actions?.canDraw
              )
            }
            onClick={
              mine &&
              !disabled &&
              game.turnPhase === "must_draw" &&
              actions?.canDraw
                ? () => void act({ type: "draw" })
                : undefined
            }
          />
          <div className="text-[9px] text-white/60 mt-0.5">
            Pioche · {game.deckCount}
          </div>
        </div>
        <DiscardSpread
          cards={game.discardPile.map(
            (c, i) =>
              c ?? {
                id: `hidden-${i}`,
                isJoker: false,
                rank: "A",
                suit: "spades",
                pack: 1,
              },
          )}
          faceDown={game.lastDiscard?.kind === "RS"}
          eventId={game.lastDiscard?.id}
          canChop={
            mine &&
            !disabled &&
            game.turnPhase === "must_draw" &&
            !!actions?.canChop
          }
          onChop={() => void act({ type: "chop" })}
          onInspect={() => setInspect(true)}
        />
      </div>
      {game.phase === "playing" && !spectator && (
        <section
          aria-label={`Zone de ${viewer.name}`}
          data-player-zone={viewer.id}
          data-local-hand-panel
          data-seat="south"
          className="game-hand-panel bg-slate-800 border-t-2 border-amber-900/40"
        >
          {game.phase === "playing" && !mine && (
            <div className="text-center py-1 bg-slate-900/50 border-b border-slate-700/50">
              <span className="text-amber-400 font-bold text-sm card-pulse">
                ⏳ {currentName} joue…
              </span>
            </div>
          )}
          {/* Exactly the local contextual action bar: only relevant buttons appear. */}
          <div className="hand-actions flex gap-1.5 p-1.5 overflow-x-auto border-b border-slate-700/50 items-center">
            {mine && game.turnPhase === "must_draw" && (
              <button
                onClick={() => void act({ type: "draw" })}
                disabled={!actions?.canDraw}
                className="btn-primary min-h-10 text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                📥 Piocher
              </button>
            )}
            {mine && game.turnPhase === "playing" && (
              <button
                onClick={() =>
                  selection.length === 1 &&
                  discardCard(selection[0].id, !selection[0].isJoker)
                }
                disabled={selection.length !== 1}
                className="btn-danger min-h-10 text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                🗑️ Défausser
              </button>
            )}
            {mine && game.turnPhase === "must_draw" && actions?.canChop && (
              <button
                onClick={() => void act({ type: "chop" })}
                className="btn-primary min-h-10 text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0 bg-gradient-to-r from-purple-600 to-purple-800"
              >
                ✋ CHOP
              </button>
            )}
            {mine &&
              game.turnPhase === "must_draw" &&
              game.config.chopObligatoire &&
              actions?.canChop && (
                <span className="text-purple-300 text-[10px] whitespace-nowrap">
                  CHOP obligatoire
                </span>
              )}
            {mine && game.turnPhase === "playing" && (
              <>
                {game.chopMustOpen && (
                  <span className="text-amber-400 text-[11px] self-center whitespace-nowrap font-bold">
                    ✋ CHOP : vous devez ouvrir ou annuler
                  </span>
                )}
                {game.chopPending && (
                  <span className="text-purple-300 text-[11px] self-center whitespace-nowrap font-bold">
                    La carte CHOP doit être jouée dans une combinaison
                  </span>
                )}
                {actions?.canCancelChop && (
                  <button
                    onClick={() => void act({ type: "cancelChop" })}
                    className="btn-secondary min-h-10 text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0"
                  >
                    ↩️ Annuler CHOP
                  </button>
                )}
                {detectedType && (
                  <button
                    onClick={() =>
                      void act({
                        type: "place",
                        kind: detectedType,
                        cardIds: selectedIds,
                        jokerPlacement: pendingJokerPlacement ?? undefined,
                      })
                    }
                    className="btn-primary text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0"
                  >
                    🃏 Poser{" "}
                    {getCombinationClassLabel({
                      id: "preview",
                      type: detectedType,
                      cards: selection,
                      ownerId: viewer.id,
                    })}
                    {pendingJokerPlacement
                      ? ` (Joker→${jokerPlacementLabel(pendingJokerPlacement)})`
                      : ""}
                  </button>
                )}
                {!game.myDraft.length &&
                  selection.length >= 3 &&
                  !detectedType && (
                    <span className="text-red-400 text-[10px] self-center">
                      Invalide
                    </span>
                  )}
                {game.myDraft.length > 0 && (
                  <button
                    onClick={() => void act({ type: "confirmOpening" })}
                    className="btn-primary text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0"
                  >
                    Valider l’ouverture
                  </button>
                )}
                {longestRecovery && (
                  <button
                    onClick={() =>
                      void act({
                        type: "recover",
                        comboId: longestRecovery.combinationId,
                        cardIds: longestRecovery.replacementCardIds,
                      })
                    }
                    className="btn-primary text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0"
                  >
                    Récupérer le Joker
                  </button>
                )}
                {game.myDraft.length > 0 && (
                  <button
                    onClick={() => void act({ type: "takeBack" })}
                    className="btn-secondary text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0"
                  >
                    ↩️ Reprendre
                  </button>
                )}
                {!!actions?.returnableCarreIds.length && (
                  <button
                    onClick={() =>
                      void act({
                        type: "returnCarre",
                        comboId: actions.returnableCarreIds[0],
                      })
                    }
                    className="text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0 rounded-lg font-bold bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-900"
                  >
                    📦 Rentrer le carré dans la base
                  </button>
                )}
                {selection.length === 1 && selection[0].isJoker && (
                  <button
                    onClick={() => discardCard(selection[0].id, false)}
                    className="btn-danger text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0 bg-gradient-to-r from-purple-600 to-purple-800"
                  >
                    🃏 RJ
                  </button>
                )}
                {selection.length >= 2 && (
                  <button
                    onClick={() =>
                      setView((v) => ({
                        ...v,
                        locks: [
                          ...locks.filter(
                            (l) => !l.some((id) => selectedIds.includes(id)),
                          ),
                          selectedIds,
                        ],
                      }))
                    }
                    className="text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0 rounded-lg font-bold bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-900"
                  >
                    🔒 Verrouiller la sélection ({selection.length})
                  </button>
                )}
                {selection.length > 0 && (
                  <button
                    onClick={() => setSelected([])}
                    className="btn-secondary text-xs px-2 py-1.5 flex-shrink-0"
                  >
                    ✕
                  </button>
                )}
              </>
            )}
            {!mine && game.phase === "playing" && (
              <span className="text-[10px] text-slate-400 whitespace-nowrap">
                Cliquez sur un nom adverse pour le signaler
              </span>
            )}
          </div>
          <PlayerHand
            cards={cards}
            selectedCards={selectedIds}
            groups={detectHandGroups(cards)}
            sortMode={view.mode}
            onSortChange={(mode) => setView((v) => ({ ...v, mode }))}
            onSelectCard={(id) =>
              setSelected((s) =>
                s.includes(id) ? s.filter((i) => i !== id) : [...s, id],
              )
            }
            onSelectGroup={setSelected}
            lockedSetForCard={(id) => locks.find((l) => l.includes(id)) ?? null}
            onUnlockSet={(id) =>
              setView((v) => ({
                ...v,
                locks: locks.filter((l) => !l.includes(id)),
              }))
            }
            onLockGroup={(ids) =>
              setView((v) => ({
                ...v,
                locks: [
                  ...locks.filter((l) => !l.some((id) => ids.includes(id))),
                  ids,
                ],
              }))
            }
            onReorder={(block, to) =>
              setView((v) => ({
                ...v,
                mode: "manual",
                order: moveBlock(
                  cards.map((c) => c.id),
                  block,
                  to,
                ),
              }))
            }
            onTouchDrop={(cardId, x, y) => {
              if (!canPlay || locks.some((l) => l.includes(cardId)))
                return false;
              const target = document.elementFromPoint(x, y);
              const comboId = target?.closest<HTMLElement>(
                "[data-online-combo]",
              )?.dataset.onlineCombo;
              const combo = [...game.tableCombinations, ...game.myDraft].find(
                (c) => c.id === comboId,
              );
              if (combo) {
                add(cardId, combo);
                return true;
              }
              if (target?.closest("[data-discard-hub],[data-online-discard]")) {
                void act({ type: "discard", cardId });
                return true;
              }
              return false;
            }}
          />
        </section>
      )}
      {/* Identical info bar to the local screen, in the same place. */}
      <div className="game-info-bar flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-800/90 border-b border-slate-700 z-20">
        <button onClick={onBack} className="text-amber-400 text-sm font-bold">
          ← Menu
        </button>
        <div className="min-w-0 flex-1 flex flex-wrap justify-center items-center gap-x-2 text-[11px]">
          <span className="text-slate-400">
            VIERGE :{" "}
            <span className="text-emerald-300 font-bold">{game.vierge}</span>
          </span>
          <span className="text-slate-400">
            SUITE :{" "}
            <span className="text-amber-400 font-bold">{game.suite}</span>
          </span>
          <span className="text-slate-400">
            TOTAL :{" "}
            <span className="text-amber-400 font-bold">
              {game.lastOpeningTotal}
            </span>
          </span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400">
            R{game.roundNumber} · Pioche:{" "}
            <span className="text-amber-400 font-bold">{game.deckCount}</span>
          </span>
        </div>
        <button
          onClick={() => setScores(true)}
          className="text-amber-400 text-sm font-bold"
          aria-label="Scores"
        >
          📊
        </button>
      </div>

      {spectator && (
        <div
          className="local-player-summary px-3 py-0.5 bg-slate-900/60 text-[10px] text-sky-200"
          data-spectator-banner
        >
          <span>
            👁 Vous regardez cette table en spectateur · {room.name}
            {room.allowReplacement ? " · remplacement activé" : ""}
          </span>
          {room.canReplace && (
            <button
              className="btn-primary w-auto justify-self-end px-3 py-1 text-xs"
              disabled={disabled}
              onClick={() => void act({ type: "replace" })}
            >
              ✋ Prendre le siège de {room.leftSeats.find((s) => s.slot === room.canReplaceSlot)?.name ?? "ce joueur"}
            </button>
          )}
          <button
            className="btn-secondary w-auto justify-self-end text-xs px-2 py-1.5 flex-shrink-0"
            disabled={disabled}
            onClick={() => void act({ type: "stopWatching" })}
          >
            Quitter le spectacle
          </button>
        </div>
      )}

      {game.phase === "playing" && !spectator && (
        <div className="local-player-summary px-3 py-0.5 bg-slate-900/50 text-[10px] text-slate-400">
          <span>
            <span
              className="player-color-dot"
              style={{ backgroundColor: playerColor(game.players, viewer.id) }}
            />{" "}
            {viewer.name} · {viewer.seat} · {viewer.handCount} cartes
            {game.config.variant === "teams"
              ? ` · Équipe ${["south", "north"].includes(viewer.seat) ? 1 : 2}`
              : ""}
            {` · ${room.name}`}
          </span>
          <span>
            {viewer.status === "opened" ? "✅ Ouvert" : "⏳ Non ouvert"}
          </span>
          <span>Score : {viewer.score}</span>
          <button
            className="btn-secondary w-auto justify-self-end text-xs px-2 py-1.5 flex-shrink-0"
            onClick={onLeave}
          >
            🚪 Quitter la table
          </button>
        </div>
      )}

      {game.phase === "round_end" && (
        <div className="local-player-summary px-3 py-1 bg-slate-900/50 text-[10px] text-slate-400">
          <span>Manche terminée — {room.name}</span>
          {room.hostPlayerId === room.viewerId ? (
            <button
              className="btn-primary px-3 py-1 text-xs"
              disabled={disabled}
              onClick={() => void act({ type: "nextRound" })}
            >
              Manche Suivante
            </button>
          ) : (
            <span>En attente de l’hôte…</span>
          )}
          <button
            className="btn-secondary w-auto justify-self-end text-xs px-2 py-1.5 flex-shrink-0"
            onClick={onLeave}
          >
            🚪 Quitter la table
          </button>
        </div>
      )}

      {!room.members.find((m) => m.playerId === room.hostPlayerId)?.connected &&
        room.hostPlayerId !== room.viewerId && (
          <div className="local-player-summary px-3 py-0.5 bg-slate-900/50 text-[10px] text-slate-400">
            <span>L’hôte est absent.</span>
            <button
              className="btn-secondary px-2 py-0.5 text-[10px]"
              disabled={disabled}
              onClick={onClaimHost}
            >
              👑 Reprendre le rôle d’hôte
            </button>
          </div>
        )}
      {(zoom || inspect || report || joker) && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={
            report
              ? "Signaler une faute"
              : joker
                ? "Choisir la valeur du Joker"
                : "Cartes publiques"
          }
          className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-5"
        >
          <div className="bg-slate-800 rounded-xl p-5 max-h-[85vh] max-w-full overflow-auto">
            <button
              className="btn-secondary mb-3"
              onClick={() => {
                setZoom(null);
                setInspect(false);
                setReport("");
                setJoker(null);
              }}
            >
              Fermer
            </button>
            {zoom && (
              <div className="flex gap-4 flex-wrap">
                {zoom.length ? (
                  zoom.map((c) => comboView(c, true))
                ) : (
                  <p>Aucune combinaison publique.</p>
                )}
              </div>
            )}
            {inspect && (
              <div className="flex flex-wrap gap-2">
                {game.discardPile.map((c, i) => (
                  <CardView
                    key={c?.id ?? i}
                    card={
                      c ?? {
                        id: "back",
                        isJoker: false,
                        rank: "A",
                        suit: "spades",
                        pack: 1,
                      }
                    }
                    small
                    faceDown={!c}
                  />
                ))}
              </div>
            )}
            {report && (
              <div>
                <h2>
                  Signaler {game.players.find((p) => p.id === report)?.name}
                </h2>
                <select
                  className="bg-slate-950 p-2"
                  value={fault}
                  onChange={(e) => setFault(e.target.value as FaultType)}
                >
                  {REPORTABLE_FAULTS.map((f) => (
                    <option key={f.type} value={f.type}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <button
                  disabled={disabled || game.phase !== "playing"}
                  onClick={() => {
                    void act({ type: "report", accusedId: report, fault });
                    setReport("");
                  }}
                >
                  Confirmer le signalement
                </button>
              </div>
            )}
            {joker && (
              <div>
                <h2>Choisir la valeur du Joker</h2>
                {getJokerExtensionChoices(joker.combo, joker.card).map(
                  (choice) => (
                    <button
                      className="btn-primary m-2"
                      disabled={disabled || !choice.valid}
                      key={choice.side}
                      onClick={() => {
                        void act({
                          type: "add",
                          cardId: joker.card.id,
                          comboId: joker.combo.id,
                          side: choice.side,
                        });
                        setJoker(null);
                      }}
                    >
                      {choice.rank ?? "—"}
                      {choice.suit ? SUIT_SYMBOLS[choice.suit] : ""} ·{" "}
                      {choice.side === "higher" ? "Supérieur" : "Inférieur"}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
