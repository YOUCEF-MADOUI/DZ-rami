'use client';
import FittedTable from './FittedTable';
import type { CSSProperties } from 'react';
import { tableCards, tableCombinations, playerColor } from './presentation/table-order';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  GameState, GameConfig, GameCard, Card, Combination, RANK_ORDER, TablePosition,
  getCardDisplayName, getSeatOrder, SEAT_LABELS, SUIT_SYMBOLS, JokerPlacement,
} from '@/game/core/types';
import type { SoloSession, SoloView } from '@/game/core/solo-storage';
import { useGame } from '@/game/hooks/useGame';
import {
  detectCombinationType, canAddToCombination, calculateVierge, calculateTotal,
  getOpeningHudValues, getJokerRepresentation, canRecoverJoker, resolveJokerPlacement, getCombinationClassLabel, getStableJokerPlacement,
} from '@/game/core/validation';
import { detectHandGroups, moveBlock } from '@/game/core/hand-groups';
import { hasPlayedMandatoryChopCard, REPORTABLE_FAULTS, getJokerAdditionChoices, canPlayerRecoverJoker } from '@/game/core/engine';
import CardView from './CardView';
import ScoreBoard from './ScoreBoard';
import StockEffects from './StockEffects';
import DiscardSpread from './DiscardSpread';
import { drawVisualEvent, visualDealer } from './presentation/table-motion';
import DiscardEffects from './DiscardEffects';
import OpponentHand from './OpponentHand';
import { projectPlayerView, PublicPlayer } from '@/game/core/public-view';
import { isTeamMode, teamOf, TEAM_NAMES, openingRequirements, scoreEntries, winnerScoreId } from '@/game/core/team-rules';
import PlayerHand, { SortMode } from './PlayerHand';
import HotseatPassScreen from './HotseatPassScreen';
import { activeHumanIndex, shouldPassDevice, turnSerial, type PlayMode } from '@/game/core/hotseat';

interface Props { initialView?: SoloView; onPersist?: (session:SoloSession)=>void; initialState?: GameState; config: GameConfig; playerNames: string[]; onBack: () => void; /** Local pass-and-play: every seat is human. */ hotseat?: boolean; }

const EMPTY_HAND: GameCard[] = [];
const SUIT_ORDER: Record<string, number> = { spades: 0, hearts: 1, diamonds: 2, clubs: 3 };

function jokerPlacementLabel(placement: JokerPlacement): string {
  return `${placement.represents.rank}${SUIT_SYMBOLS[placement.represents.suit]}`;
}

/** Row / column of every seat inside the 3×3 table grid. */
const SEAT_CELL: Record<TablePosition, [number, number]> = {
  'north-west': [0, 0],
  'north': [0, 1],
  'north-east': [0, 2],
  'west': [1, 0],
  'east': [1, 2],
  'south': [2, 1],
};

/** Exported for tests: the CSS grid areas of the table for a given table size. */
export function buildGridAreas(playerCount: number): string {
  const rows: string[][] = [
    ['.', '.', '.'],
    ['.', 'hub', '.'],
    ['.', 'south', '.'],
  ];
  for (const seat of getSeatOrder(playerCount)) {
    const [row, column] = SEAT_CELL[seat];
    rows[row][column] = seat;
  }
  return rows.map(row => `"${row.join(' ')}"`).join(' ');
}

/** Exported for tests: the hand ordering used by the player's hand strip. */
export function sortCards(cards: GameCard[], mode: SortMode): GameCard[] {
  const s = [...cards];
  // Suit sorting stays unchanged; value sorting places Jokers first and connects suits at rank boundaries.
  if (mode === 'suit') s.sort((a, b) => {
    if (a.isJoker !== b.isJoker) return a.isJoker ? 1 : -1; if (a.isJoker) return 0;
    const ca = a as Card, cb = b as Card;
    const sd = SUIT_ORDER[ca.suit] - SUIT_ORDER[cb.suit];
    return sd !== 0 ? sd : RANK_ORDER[ca.rank] - RANK_ORDER[cb.rank];
  });
  else if (mode === 'rank') {
    const jokers=s.filter(card=>card.isJoker);
    const natural=s.filter((card):card is Card=>!card.isJoker);
    const rankValue=(card:Card)=>card.rank==='A'?14:RANK_ORDER[card.rank];
    const result:GameCard[]=[...jokers];
    let previousSuit:Card['suit']|undefined;
    for(let rank=14;rank>=2;rank--){
      const bucket=natural.filter(card=>rankValue(card)===rank);
      bucket.sort((a,b)=>Number(b.suit===previousSuit)-Number(a.suit===previousSuit)||SUIT_ORDER[a.suit]-SUIT_ORDER[b.suit]);
      result.push(...bucket);
      if(bucket.length)previousSuit=bucket.at(-1)!.suit;
    }
    return result;
  }
  return s;
}

function applyManualOrder(cards: GameCard[], order: string[]): GameCard[] {
  if (!order.length) return cards;
  const m = new Map(cards.map(c => [c.id, c]));
  const o = order.map(id => m.get(id)).filter((c): c is GameCard => !!c);
  const s = new Set(order); cards.forEach(c => { if (!s.has(c.id)) o.push(c); });
  return o;
}

/** Short label for the card a Joker stands for, e.g. "9♥". */
function jokerRepresentsLabel(combo: Combination): string | null {
  const metadata = getJokerRepresentation(combo);
  return metadata?.candidates.map(c => `${c.rank}${SUIT_SYMBOLS[c.suit]}`).join(' / ') ?? null;
}

export interface OpeningStatusInput {
  opened: boolean;
  /** Natural VIERGE score of the prepared pose. */
  naturalScore: number;
  total: number;
  /** VIERGE threshold of the round (71 / 91 / 101 / 111). */
  vierge: number;
  /** Required TOTAL threshold (last successful opening + 1). */
  suite: number;
  openingThreshold?: number;
  hasCombos: boolean;
}

/**
 * Status line of the opening HUD.
 *
 * The comparison is always made against the VIERGE, never against the SUITE:
 * with VIERGE 71 and SUITE 82, 78 natural points open normally and the message
 * must never claim that points are missing.
 */
export function openingStatusText(input: OpeningStatusInput): string {
  if (input.opened) {
    return `Ouverture validée — naturel ${input.naturalScore} / VIERGE ${input.openingThreshold ?? input.vierge}`;
  }
  if (!input.hasCombos) {
    return `Points naturels nécessaires : VIERGE ${input.vierge}`;
  }
  if (input.naturalScore >= input.vierge && input.total < input.suite) {
    return `TOTAL ${input.total} — il manque ${input.suite - input.total} points au TOTAL (SUITE ${input.suite})`;
  }
  if (input.naturalScore >= input.vierge) {
    return `Naturel ${input.naturalScore} ≥ VIERGE ${input.vierge} : validez l’ouverture puis défaussez`;
  }
  return `Naturel ${input.naturalScore} — il manque ${input.vierge - input.naturalScore} points naturels (VIERGE ${input.vierge})`;
}

export default function GameScreen({ config, playerNames, onBack, initialState, initialView, onPersist, hotseat = false }: Props) {
  const [dealing,setDealing]=useState(false);
  const [animatedDealRound,setAnimatedDealRound]=useState(initialState?.roundNumber??-1);
  const { gameState, selectedCards, availableActions, actions } = useGame(initialState,initialView?.selectedCards,dealing,hotseat);
  // Local hot-seat: the human holding the device is the current player.
  const mode: PlayMode = hotseat ? 'hotseat' : 'solo';
  const activeIndex = gameState ? activeHumanIndex(gameState, mode) : 0;
  /** Last turn explicitly acknowledged on the pass screen. */
  const [readyTurn, setReadyTurn] = useState<string | null>(null);
  const [pendingJoker,setPendingJoker]=useState<{cardId:string;comboId:string}|null>(null);
  const [showScores, setShowScores] = useState(false);
  const [message, setMessage] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>(initialView?.sortMode??'rank');
  const [manualOrder, setManualOrder] = useState<string[]>(initialView?.manualOrder??[]);
  const [discardHover, setDiscardHover] = useState(false);
  const [comboHover, setComboHover] = useState<string | null>(null);
  const [comboHoverValid, setComboHoverValid] = useState(false);
  const [showDiscardPile, setShowDiscardPile] = useState(false);
  // Fault reporting: which player is being accused (null = closed menu).
  const [faultTargetId, setFaultTargetId] = useState<string | null>(null);
  // Read-only zoom on an opponent public combinations (display only, never touches the state).
  const [zoomedPlayerId, setZoomedPlayerId] = useState<string | null>(null);
  // User-defined LOCKED SETS: each is a list of card ids the player froze together
  // from a selection. A locked set moves/selects as one block; its cards (incl. a
  // joker) can't be pulled individually until the set is unlocked.
  const [lockedSets, setLockedSets] = useState<string[][]>(initialView?.lockedSets??[]);
  const dragCardRef = useRef<string | null>(null);

  // Start the game once on mount: `actions` is rebuilt on every render, so it
  // must not be a dependency here.
  useEffect(() => { if (!initialState) actions.startGame(config, playerNames); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (message) { const t = setTimeout(() => setMessage(''), 5000); return () => clearTimeout(t); } }, [message]);

  useEffect(()=>{
    if(!gameState||!onPersist)return;
    const persist=()=>onPersist({version:1,state:gameState,view:{sortMode,manualOrder,lockedSets,selectedCards}});
    persist();
    window.addEventListener('pagehide',persist);
    return ()=>window.removeEventListener('pagehide',persist);
  },[gameState,sortMode,manualOrder,lockedSets,selectedCards,onPersist]);
  const humanCards = gameState?.players[activeIndex]?.hand ?? EMPTY_HAND;
  const activeLockedSets = useMemo(() => {
    const ids = new Set(humanCards.map(card => card.id));
    return lockedSets.map(set => set.filter(id => ids.has(id))).filter(set => set.length >= 2);
  }, [humanCards, lockedSets]);
  const orderedHand = useMemo(
    () => sortMode === 'manual' ? applyManualOrder(humanCards, manualOrder) : sortCards(humanCards, sortMode),
    [humanCards, sortMode, manualOrder]
  );
  // ── AUTO-DETECT GROUPS among adjacent cards ──
  const handGroups = useMemo(() => detectHandGroups(orderedHand), [orderedHand]);
  // Selected cards follow the visual hand order: the Joker's slot in the meld
  // is the slot it occupies in the hand, and it is never re-sorted afterwards.
  const selCards = useMemo(
    () => orderedHand.filter(card => selectedCards.includes(card.id)),
    [orderedHand, selectedCards]
  );
  // Find the locked set (if any) that contains a given card id.
  const lockedSetForCard = useCallback((cardId: string): string[] | null =>
    activeLockedSets.find(set => set.includes(cardId)) ?? null, [activeLockedSets]);
  // Lock a list of cards together as a new set (shared by both flows).
  const lockCards = useCallback((ids: string[]) => {
    if (ids.length < 2) { setMessage('Sélectionnez au moins 2 cartes à verrouiller'); return; }
    const orderedIds = orderedHand.map(card => card.id).filter(id => ids.includes(id));
    setLockedSets(prev => {
      const cleaned = prev
        .map(s => s.filter(id => !orderedIds.includes(id)))
        .filter(s => s.length >= 2);
      return [...cleaned, orderedIds];
    });
    actions.clearSelection();
    setMessage('🔒 Cartes verrouillées ensemble');
  }, [actions, orderedHand]);
  // Flow A — lock exactly the cards currently selected (one-by-one selection).
  const lockSelection = useCallback(() => lockCards(selectedCards), [lockCards, selectedCards]);
  // Flow B — lock a whole detected combo via its chevron.
  const lockGroup = useCallback((cardIds: string[]) => lockCards(cardIds), [lockCards]);
  // Unlock (remove) the set that contains this card.
  const unlockSet = useCallback((cardId: string) => {
    setLockedSets(prev => prev.filter(s => !s.includes(cardId)));
    actions.clearSelection();
  }, [actions]);
  const handleSortChange = useCallback((m: SortMode) => { setSortMode(m); setManualOrder([]); }, []);
  // ── Reorder: move a whole block (group or single card) ──
  const handleReorder = useCallback((blockIds: string[], toIndex: number) => {
    const ids = orderedHand.map(c => c.id);
    const nextOrder = moveBlock(ids, blockIds, toIndex);
    actions.reorderHand(nextOrder);
    setManualOrder(nextOrder);
    setSortMode('manual');
  }, [orderedHand, actions]);
  // ── Select a whole group ──
  const handleSelectGroup = useCallback((cardIds: string[]) => {
    const allSelected = cardIds.every(id => selectedCards.includes(id));
    if (allSelected) {
      cardIds.forEach(id => actions.deselectCard(id));
    } else {
      // Clear then select the group
      actions.clearSelection();
      cardIds.forEach(id => actions.selectCard(id));
    }
  }, [selectedCards, actions]);
  const onCardDragStart = useCallback((cid: string) => { dragCardRef.current = cid; }, []);
  const onCardDragEnd = useCallback(() => { dragCardRef.current = null; setDiscardHover(false); setComboHover(null); }, []);
  const onTableDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); if (dragCardRef.current) setDiscardHover(true); }, []);
  const onTableDragLeave = useCallback(() => setDiscardHover(false), []);
  const onTableDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDiscardHover(false);
    const cid = dragCardRef.current; if (!cid) return;
    const c = humanCards.find(x => x.id === cid); if (!c) return;
    // A natural auto-detected group may still be moved card-by-card. Only a
    // manually locked set must stay together during an external drop.
    if (lockedSetForCard(cid)) { setMessage('Déverrouillez le groupe avant de déplacer cette carte seule'); return; }
    actions.discardCard(cid, !c.isJoker);
  }, [humanCards, actions, lockedSetForCard]);
  const canHumanAddToCombo = useCallback((combo: Combination, card: GameCard) => {
    if (!gameState) return false;
    const human = gameState.players[activeIndex];
    const owner = gameState.players.find(player => player.id === combo.ownerId);
    if (canPlayerRecoverJoker(gameState,human.id,combo) && canRecoverJoker(combo,card)) return true;
    if (human.hand.length <= 1 || !owner) return false;
    const ownProvisional = owner.id === human.id && human.status === 'not_opened';
    if (owner.status !== 'opened' && !ownProvisional) return false;
    if (human.status === 'not_opened' && !ownProvisional) return false;
    return canAddToCombination(combo, card);
  }, [gameState, activeIndex]);
  const requestAddition=useCallback((cardId:string,comboId:string)=>{
    if(!gameState)return;
    const card=gameState.players[activeIndex].hand.find(c=>c.id===cardId);
    const combo=[...gameState.tableCombinations,...(gameState.turnState?.temporaryCombinations??[])].find(c=>c.id===comboId);
    if(card&&combo&&canPlayerRecoverJoker(gameState,gameState.players[activeIndex].id,combo)&&canRecoverJoker(combo,card)) {
      actions.recoverJokerAction(comboId,cardId);
      return;
    }
    if(card?.isJoker&&combo?.type==='tierce')setPendingJoker({cardId,comboId});
    else actions.addToCombo(cardId,comboId);
  },[gameState,activeIndex,actions]);
  const onComboDragOver = useCallback((e: React.DragEvent, combo: Combination) => {
    e.preventDefault(); e.stopPropagation();
    const cid = dragCardRef.current; if (!cid) return;
    const card = humanCards.find(c => c.id === cid);
    setComboHover(combo.id); setComboHoverValid(card ? canHumanAddToCombo(combo, card) : false);
  }, [humanCards, canHumanAddToCombo]);
  const onComboDragLeave = useCallback((e: React.DragEvent) => { e.stopPropagation(); setComboHover(null); }, []);
  const onComboDrop = useCallback((e: React.DragEvent, comboId: string) => {
    e.preventDefault(); e.stopPropagation(); setComboHover(null);
    const cid = dragCardRef.current; if (!cid) return;
    requestAddition(cid, comboId);
  }, [requestAddition]);
  const onHandTouchDrop = useCallback((cardId: string, clientX: number, clientY: number): boolean => {
    if (typeof document === 'undefined') return false;
    const target = document.elementFromPoint(clientX, clientY);
    if (!target) return false;

    if (target.closest('[data-discard-zone]')) {
      if (lockedSetForCard(cardId)) {
        setMessage('Déverrouillez le groupe avant de déplacer cette carte seule');
        return true;
      }
      const card = humanCards.find(item => item.id === cardId);
      if (card) actions.discardCard(cardId, !card.isJoker);
      return true;
    }

    const comboElement = target.closest('[data-combo-id]');
    const comboId = comboElement?.getAttribute('data-combo-id');
    if (comboId) {
      requestAddition(cardId, comboId);
      return true;
    }
    return false;
  }, [actions, humanCards, lockedSetForCard, requestAddition]);

  if (!gameState) return <div className="h-full flex items-center justify-center bg-slate-900"><span className="text-amber-400 text-xl">Chargement...</span></div>;
  if (showScores) return <ScoreBoard gameState={projectPlayerView(gameState,gameState.players[activeIndex].id)} onBack={() => setShowScores(false)} />;

  const publicView=projectPlayerView(gameState,gameState.players[activeIndex].id);
  const entries=scoreEntries(publicView);
  const cp = gameState.players[gameState.currentPlayerIndex];
  const hp = gameState.players[activeIndex];
  /** True when the device must be handed over before the next action. */
  const awaitingPass = shouldPassDevice(gameState, mode, readyTurn);
  const isMyTurn = cp.id === hp.id;
  const phase = gameState.turnState?.phase || 'waiting';
  const canAct = isMyTurn && phase === 'playing' && !dealing && !awaitingPass;
  // Reporting targets EVERY other player, at any moment of the round.
  const reportableIds = availableActions?.reportablePlayerIds ?? [];
  const canReport = Boolean(availableActions?.canReportFault);
  const chopMustOpen = config.chopSeulementOuverture && gameState.turnState?.drawSource === 'chop' && hp.status !== 'opened';

  // Selected cards follow the visual hand order: the Joker's slot in the meld
  // is the slot it occupies in the hand, and it is never re-sorted afterwards.
  const detectedType = selCards.length >= 3 ? detectCombinationType(selCards) : null;
  const pendingJokerPlacement = detectedType ? resolveJokerPlacement(selCards, detectedType) : null;
  const handleAutoPlace = () => {
    if (!detectedType) { setMessage('Combinaison invalide'); return; }
    actions.place(selCards.map(card => card.id), detectedType, pendingJokerPlacement ?? undefined);
  };
  const handleDiscard = () => {
    if (selectedCards.length !== 1) return;
    const c = hp.hand.find(x => x.id === selectedCards[0]); if (!c) return;
    actions.discardCard(selectedCards[0], !c.isJoker);
  };

  const committedHumanCombos = tableCombinations(gameState.tableCombinations.filter(combo => combo.ownerId === hp.id));
  const draftHumanCombos = gameState.turnState?.playerId === hp.id
    ? gameState.turnState.temporaryCombinations.filter(combo => combo.ownerId === hp.id)
    : [];
  const humanCombos = [...committedHumanCombos, ...draftHumanCombos];
  // VIERGE is the fixed threshold of the round (71 / 91 / 101 / 111) — it is
  // never the value of an opening. SUITE records the last successful opening + 1 and
  // TOTAL is the value of the opening (jokers counted at their rank).
  const viergeThreshold = gameState.initialThreshold;
  const openingHud = getOpeningHudValues(gameState, hp.id);
  const liveTotal = openingHud.total;
  const naturalScore = hp.status === 'opened'
    ? (hp.openingValue ?? 0)
    : calculateVierge(humanCombos);
  // Natural points and total have independent thresholds.
  const returnableCarreIds = availableActions?.returnableCarreIds ?? [];

  const currentDiscardPile:GameCard[] = publicView.discardPile.map((c,i)=>c??{id:`hidden-discard-${i}`,rank:'A',suit:'spades',pack:1,isJoker:false});

  const renderCombo = (combo: Combination, interactive: boolean, tiny = false, showBaseButton = false) => {
    const isHov = comboHover === combo.id;
    const selectedCardId = selectedCards.length === 1 ? selectedCards[0] : null;
    const selectedCard = selectedCardId ? hp.hand.find(card => card.id === selectedCardId) : undefined;
    const canTapAdd = Boolean(interactive && canAct && selectedCard && ((selectedCard.isJoker && combo.type==='tierce') || canHumanAddToCombo(combo, selectedCard)));
    const border = isHov ? (comboHoverValid ? 'border-green-400 shadow-green-400/30 scale-[1.03]' : 'border-red-400 shadow-red-400/20') : 'border-white/10';
    const jokerLabel = jokerRepresentsLabel(combo);
    const baseAction = showBaseButton && returnableCarreIds.includes(combo.id);
    return (
      <div key={combo.id}
        data-combo-id={combo.id}
        role={canTapAdd ? 'button' : undefined}
        tabIndex={canTapAdd ? 0 : undefined}
        title={canTapAdd ? 'Touchez pour ajouter la carte sélectionnée' : undefined}
        className={`table-meld inline-flex flex-col items-center gap-0.5 p-1 rounded-lg border-2 bg-black/20 transition-all ${border} ${isHov ? 'shadow-lg' : ''} ${canTapAdd ? 'cursor-pointer ring-1 ring-emerald-300/50' : ''}`}
        onClick={canTapAdd && selectedCardId ? () => requestAddition(selectedCardId, combo.id) : undefined}
        onKeyDown={canTapAdd && selectedCardId ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') requestAddition(selectedCardId, combo.id);
        } : undefined}
        onDragOver={interactive ? (e) => onComboDragOver(e, combo) : undefined}
        onDragLeave={interactive ? onComboDragLeave : undefined}
        onDrop={interactive ? (e) => onComboDrop(e, combo.id) : undefined}>
        <div className={`meld-fan ${tiny ? 'meld-fan-opponent' : ''}`} style={{'--fan-count': combo.cards.length} as CSSProperties}>
          {/* Physical order is preserved: a positioned Joker never moves. */}
          {tableCards(combo).map(c => (
            <CardView key={c.id} card={c} small={!tiny} tiny={tiny} groupColor={playerColor(publicView.players,combo.ownerId)}
              jokerAs={c.isJoker ? (jokerLabel ?? undefined) : undefined} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1 text-[9px] font-bold leading-tight max-w-full">
          <span style={{color:playerColor(publicView.players,combo.ownerId)}}>{publicView.players.find(p=>p.id===combo.ownerId)?.name} · {getCombinationClassLabel(combo)}</span>
          {jokerLabel && <span className="text-purple-300">🃏→{jokerLabel}</span>}
        </div>
        {baseAction && (
          <button
            onClick={(event) => { event.stopPropagation(); actions.returnCarre(combo.id); setMessage('📦 Carré rentré dans la base'); }}
            className="mt-0.5 rounded bg-amber-500 px-1.5 py-0.5 text-[8px] font-black text-slate-900 whitespace-nowrap">
            📦 Rentrer dans la base
          </button>
        )}
      </div>
    );
  };

  const dealer=visualDealer(publicView.players,publicView.firstPlayerId);
  const opponents = publicView.players.filter(player => player.id !== hp.id);
  const renderPlayerZone = (player: PublicPlayer, seat: TablePosition) => {
    const isCurrent = player.id === cp.id;
    const isRoundStarter = gameState.players[gameState.firstPlayerIndex]?.id === player.id;
    const canReportThisPlayer = !awaitingPass && reportableIds.includes(player.id);
    const isHuman = player.id === hp.id;
    return (
      <section key={player.id} aria-label={`Zone de ${player.name}`} data-player-zone={player.id} data-seat={seat} data-current={isCurrent || undefined}
        className="seat-panel player-meld-zone">
        <div className="seat-panel-heading">
          <button
            onClick={() => canReportThisPlayer && setFaultTargetId(player.id)}
            disabled={!canReportThisPlayer}
            title={isHuman ? 'Vous ne pouvez pas vous signaler' : 'Cliquer pour signaler ce joueur'}
            aria-label={canReportThisPlayer ? `Signaler ${player.name}` : undefined}
            className={`seat-player-name ${canReportThisPlayer ? 'cursor-pointer' : 'cursor-default'}`}
            style={{color:isCurrent ? '#fde68a' : playerColor(publicView.players,player.id)}}>
            <span className="player-color-dot" style={{backgroundColor:playerColor(publicView.players,player.id)}} aria-hidden="true"/>
            {isRoundStarter && <span className="seat-starter" title="Premier joueur de la manche · 15 cartes">15 ·</span>}
            <span className="seat-kind" aria-hidden="true">{isHuman ? '🙋' : player.isAI ? '🤖' : '👤'}</span> <span className="seat-name">{player.name}</span> ({player.handCount}) {player.status === 'opened' && '✓'} {canReportThisPlayer && <span className="seat-report-indicator text-red-300">⚠️</span>}
          </button>
          {dealer.id===player.id&&<span className="dealer-marker">Donneur</span>}
          <span className="text-[8px] text-slate-500">{SEAT_LABELS[seat]}{isTeamMode(config)?` · ${teamOf(player)==='team-1'?'Équipe 1':'Équipe 2'}`:''}</span>
          {!isHuman && (
            <button
              onClick={() => setZoomedPlayerId(player.id)}
              title="Agrandir les combinaisons publiques"
              aria-label={`Agrandir les combinaisons de ${player.name}`}
              className="seat-zoom">
              <span aria-hidden="true">⌕</span>
            </button>
          )}
        </div>
        <OpponentHand count={player.handCount} name={player.name}/>

      </section>
    );
  };

  const roundResult = gameState.roundResults[gameState.roundResults.length - 1];
  const zoomedPlayer = publicView.players.find(player => player.id === zoomedPlayerId) ?? null;

  return (
    <div data-game-root data-player-count={config.playerCount} className={`game-layout h-full flex flex-col bg-slate-900 relative ${config.playerCount<=4?'table-large':''}`}>
      <StockEffects round={gameState.roundNumber} dealerId={dealer.id} starterId={publicView.firstPlayerId} viewerId={hp.id} players={publicView.players} draw={drawVisualEvent(gameState,hp.id)} pristine={gameState.actionHistory.length===0} animateInitialDeal={animatedDealRound!==gameState.roundNumber} onDealing={active=>{setDealing(active);if(active)setAnimatedDealRound(gameState.roundNumber);}}/>
      <DiscardEffects event={publicView.lastDiscard}/>

      <div className="game-table-surface arena-stage flex-1 min-h-0 relative">
        <div
          className="pointer-events-none absolute inset-2 rounded-2xl border-4 border-amber-900/50"
          style={{ background: 'radial-gradient(ellipse at center, #2d7a45 0%, #1a5c2e 60%, #14472a 100%)', boxShadow: 'inset 0 0 50px rgba(0,0,0,0.4)' }}
        />
        {message && <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 bg-slate-900/95 text-amber-400 px-4 py-2 rounded-lg text-sm font-bold fade-in cursor-pointer" onClick={() => setMessage('')}>{message}</div>}

        <div className="opponent-strip">
          {[...opponents].sort((a,b)=>['west','north-west','north','north-east','east'].indexOf(a.seat)-['west','north-west','north','north-east','east'].indexOf(b.seat)).map(player=>renderPlayerZone(player,player.seat))}
        </div>
        <FittedTable>
        <section aria-label="Combinaisons publiques sur la table" className="public-meld-table relative z-10 player-meld-zone">
          {tableCombinations(publicView.tableCombinations).map(combo=>renderCombo(combo,canAct,false,true))}
        </section>
        {draftHumanCombos.length>0&&<section aria-label="Brouillon de votre ouverture" className="public-meld-table relative z-10 border border-dashed border-amber-400 p-2">
          <span className="w-full text-xs text-amber-200">Brouillon — à valider</span>
          {tableCombinations(draftHumanCombos).map(combo=>renderCombo(combo,canAct,false,false))}
        </section>}
        </FittedTable>
      </div>

      {pendingJoker && <div role="dialog" aria-modal="true" aria-label="Choisir la valeur du Joker" className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-xl p-4 space-y-3">
          <h3 className="text-white font-bold">Choisir la valeur du Joker</h3>
          {getJokerAdditionChoices(gameState,pendingJoker.cardId,pendingJoker.comboId).map(choice=><div key={choice.side}>
            <button disabled={!choice.valid||!isMyTurn} className="btn-primary w-full disabled:opacity-40" onClick={()=>{actions.addToCombo(pendingJoker.cardId,pendingJoker.comboId,choice.side);setPendingJoker(null);}}>
              Joker = {choice.rank??'—'}{choice.suit?SUIT_SYMBOLS[choice.suit]:''} · {choice.side==='higher'?'Supérieur':'Inférieur'}
            </button>
            {!choice.valid&&<p className="text-sm text-red-300">{choice.error}</p>}
          </div>)}
          {!getJokerAdditionChoices(gameState,pendingJoker.cardId,pendingJoker.comboId).some(c=>c.valid)&&<p className="text-red-300">Aucune extension autorisée pour ce Joker.</p>}
          <button className="btn-secondary w-full" onClick={()=>setPendingJoker(null)}>Annuler</button>
        </div>
      </div>}
      {showDiscardPile && (
        <div className="absolute inset-0 bg-black/70 z-40 flex items-center justify-center p-4" onClick={() => setShowDiscardPile(false)}>
          <div className="bg-slate-800 rounded-2xl p-4 max-w-md w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3"><h3 className="text-amber-400 font-bold">Défausse actuelle ({currentDiscardPile.length})</h3><button onClick={() => setShowDiscardPile(false)} className="text-slate-400 font-bold text-lg">✕</button></div>
            <div className="flex flex-wrap gap-1.5">{currentDiscardPile.map((card, index) => <div key={`${index}-${card.id}`} data-discard-latest={index===currentDiscardPile.length-1?true:undefined}><CardView card={card} small faceDown={index === currentDiscardPile.length - 1 && (gameState.phase === 'round_end' || gameState.phase === 'game_end') && gameState.lastDiscardFaceDown} /></div>)}</div>
            {!currentDiscardPile.length && <p className="text-slate-500 text-center py-4">Vide</p>}
          </div>
        </div>
      )}

      {/* Read-only zoom on an opponent public combinations: display only, the game state is untouched. */}
      {zoomedPlayer && (
        <div className="absolute inset-0 bg-black/80 z-40 flex items-center justify-center p-3" onClick={() => setZoomedPlayerId(null)}>
          <div className="player-meld-zone bg-slate-800 rounded-2xl p-3 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-amber-400 font-bold">Combinaisons de {zoomedPlayer.name}</h3>
              <button onClick={() => setZoomedPlayerId(null)} className="text-slate-400 font-bold text-lg">✕</button>
            </div>
            <p className="text-[10px] text-slate-400 mb-2">Aperçu lecture seule : aucun état de jeu n’est modifié.</p>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {tableCombinations(publicView.tableCombinations.filter(combo => combo.ownerId === zoomedPlayer.id)).map(combo => <div key={combo.id} className="meld-fan meld-fan-zoom" style={{'--fan-count':combo.cards.length} as CSSProperties}>{tableCards(combo).map(card => <CardView key={card.id} card={card} groupColor={playerColor(publicView.players,combo.ownerId)} jokerAs={card.isJoker ? jokerRepresentsLabel(combo) ?? undefined : undefined} />)}</div>)}
            </div>
            <button onClick={() => setZoomedPlayerId(null)} className="btn-secondary w-full mt-3 py-2">Réduire</button>
          </div>
        </div>
      )}

      {faultTargetId && (() => {
        const target = gameState.players.find(p => p.id === faultTargetId);
        const snapshot = gameState.lastCompletedTurnActionsByPlayer[faultTargetId];
        return (
          <div className="absolute inset-0 bg-black/70 z-40 flex items-center justify-center p-4" onClick={() => setFaultTargetId(null)}>
            <div className="bg-slate-800 rounded-2xl p-4 max-w-sm w-full" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-1">
                <h3 className="text-red-400 font-bold">⚠️ Signaler une faute</h3>
                <button onClick={() => setFaultTargetId(null)} className="text-slate-400 font-bold text-lg">✕</button>
              </div>
              <p className="text-slate-300 text-sm mb-2">Contre <span className="font-bold text-amber-400">{target?.name}</span>. Un signalement incorrect n’entraîne aucune pénalité.</p>
              {snapshot ? (
                <p className="text-[11px] text-slate-400 mb-3">
                  Dernière action : défausse de {snapshot.endType==='RS'?'carte face cachée':getCardDisplayName(snapshot.discardedCard)} (tour {snapshot.id}).
                </p>
              ) : (
                <p className="text-[11px] text-slate-400 mb-3">
                  {target?.name} n’a encore terminé aucun tour : aucun signalement n’est possible pour l’instant.
                </p>
              )}
              <div className="space-y-2">
                {REPORTABLE_FAULTS.map(f => (
                  <button
                    key={f.type}
                    disabled={!snapshot}
                    onClick={() => {
                      const res = actions.reportFaultAgainst(faultTargetId, f.type);
                      setFaultTargetId(null);
                      setMessage(res.message);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    {f.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setFaultTargetId(null)} className="btn-secondary w-full mt-3 py-2">Annuler</button>
            </div>
          </div>
        );
      })()}

      {(gameState.phase === 'round_end' || gameState.phase === 'game_end') && (
        <div className="round-summary absolute inset-0 bg-black/80 flex items-center justify-center z-30 p-4">
          <div className="bg-slate-800 rounded-2xl p-5 w-full max-w-sm space-y-3 fade-in overflow-y-auto max-h-[90vh]">
            <h2 className="text-xl font-bold text-amber-400 text-center">
              {gameState.phase === 'game_end' ? '🏁 Fin de partie' : roundResult?.endType === 'null_round' ? '🔄 Manche Nulle'
                : roundResult?.endType === 'cycles' ? '⏱️ Fin des tours disponibles'
                : '🏆 Fin de Manche'}
            </h2>
            {gameState.phase==='game_end'&&<p className="text-center text-green-300">Gagnant(s) : {entries.filter(p=>p.score===Math.min(...entries.map(p=>p.score))).map(p=>p.name).join(', ')} — score le plus bas.</p>}
            {roundResult && (() => {
              const w = entries.find(p => p.id === winnerScoreId(publicView,roundResult));
              return (<>
                {w && <p className="text-center text-green-400 font-bold">{w.name} — {roundResult.endType}</p>}
                {roundResult.endType === 'cycles' && <p className="text-center text-[10px] text-slate-400">Cartes restantes comptabilisées : joueur ouvert = {gameState.config.rsScorePerCard} points par carte, joueur non ouvert = {gameState.config.rsNonOpenedPenalty} points.</p>}
                <div className="space-y-2" data-round-scores>{entries.map(p => {
                  const isW = p.id === winnerScoreId(publicView,roundResult);
                  const score = roundResult.scores[p.id] ?? 0;
                  const details = roundResult.scoreBreakdown?.[p.id] ?? [];
                  return (<div key={p.id} className="bg-slate-900/60 rounded-lg p-2">
                    <div className="flex justify-between text-sm font-bold"><span className={isW && score === 0 ? 'text-green-400' : 'text-slate-200'}>{p.name}</span><span className={isW && score === 0 ? 'text-green-400' : 'text-red-400'}>{isW && score === 0 ? roundResult.endType : `+${score}`}</span></div>
                    {details.length > 0 && <div className="text-[10px] text-slate-400 mt-1 space-y-0.5">
                      {details.map((item, i) => <div key={i} className="text-red-300">+{item.points} — {item.label}</div>)}
                    </div>}
                  </div>);
                })}</div>
                <div className="border-t border-slate-600 pt-2"><p className="text-xs text-slate-400 text-center font-bold mb-1">Classement</p>{[...entries].sort((a, b) => a.score - b.score).map((p, i) => <div key={p.id} className="flex justify-between text-sm"><span className="text-slate-300">{i+1}. {p.name}</span><span className="text-amber-400 font-bold">{p.score}</span></div>)}</div>
              </>);
            })()}
            <div className="flex gap-3">{gameState.phase !== 'game_end' && <button onClick={actions.newRound} className="btn-primary flex-1 py-2.5">Manche Suivante</button>}<button onClick={onBack} className="btn-secondary flex-1 py-2.5">Quitter</button></div>
          </div>
        </div>
      )}

          {/* The discard dock sits immediately above the local hand controls. */}
          <div
            data-discard-zone="true" data-discard-hub
            onDragOver={canAct ? onTableDragOver : undefined}
            onDragLeave={canAct ? onTableDragLeave : undefined}
            onDrop={canAct ? onTableDrop : undefined}
            aria-label="Défausse au-dessus de la main"
            className={`discard-dock relative z-20 flex w-full items-center justify-center gap-1 sm:gap-3 rounded-2xl border-2 px-1 transition-colors ${discardHover ? 'border-amber-300 bg-slate-950/80' : 'border-amber-900/70 bg-slate-950/65'}`}
          >
            {discardHover && <div className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-black/40 text-amber-300 text-sm font-bold pointer-events-none">Défausser ici</div>}
            <div data-stock-zone className="relative z-10 flex-shrink-0 text-center">
              <CardView card={{ id: 'deck', isJoker: false, rank: 'A', suit: 'spades', pack: 1 }} faceDown small
                disabled={awaitingPass || (isMyTurn && phase === 'must_draw' && !availableActions?.canDraw)}
                onClick={!awaitingPass && isMyTurn && phase === 'must_draw' && availableActions?.canDraw ? actions.draw : undefined} />
              <div className="text-[9px] text-white/60 mt-0.5">Pioche · {gameState.deck.length}</div>
            </div>
            <DiscardSpread cards={currentDiscardPile} eventId={publicView.lastDiscard?.id} faceDown={gameState.lastDiscardFaceDown}
              canChop={!awaitingPass&&isMyTurn&&phase==='must_draw'&&!!availableActions?.canChop} onChop={actions.chop} onInspect={()=>setShowDiscardPile(true)}/>
          </div>

      {gameState.phase === 'playing' && (
        <section aria-label={`Zone de ${hp.name}`} data-player-zone={hp.id} data-local-hand-panel data-seat="south" className="game-hand-panel bg-slate-800 border-t-2 border-amber-900/40">
          {awaitingPass ? (
            <HotseatPassScreen
              name={hp.name}
              seat={hp.seat}
              hiddenCount={hp.hand.length}
              chopAvailable={phase === 'must_draw' && !!availableActions?.canChop}
              onReady={() => { setReadyTurn(turnSerial(gameState)); actions.clearSelection(); }}
            />
          ) : (<>
          {dealing&&<div className="text-center text-xs text-sky-200 py-1">Distribution des cartes…</div>}
          {!dealing && !isMyTurn && <div className="text-center py-1 bg-slate-900/50 border-b border-slate-700/50"><span className="text-amber-400 font-bold text-sm card-pulse">🤖 {cp.name} joue...</span></div>}
          <div className="hand-actions flex gap-1.5 p-1.5 overflow-x-auto border-b border-slate-700/50 items-center">
            {isMyTurn && phase === 'must_draw' && (
              /* PIOCHER — the button that becomes DÉFAUSSER, same slot, same size. */
              <button
                onClick={actions.draw}
                disabled={!availableActions?.canDraw}
                className="btn-primary min-h-10 text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed">
                📥 Piocher
              </button>
            )}
            {isMyTurn && phase === 'playing' && (
              /* DÉFAUSSER — exactly where PIOCHER was. No second discard button. */
              <button
                onClick={handleDiscard}
                disabled={selectedCards.length !== 1}
                className="btn-danger min-h-10 text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed">
                🗑️ Défausser
              </button>
            )}
            {isMyTurn && phase === 'must_draw' && availableActions?.canChop && <button onClick={actions.chop} className="btn-primary min-h-10 text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0 bg-gradient-to-r from-purple-600 to-purple-800">✋ CHOP</button>}
            {isMyTurn && phase === 'must_draw' && config.chopObligatoire && availableActions?.canChop && <span className="text-purple-300 text-[10px] whitespace-nowrap">CHOP obligatoire</span>}
            {isMyTurn && phase === 'playing' && (<>
              {chopMustOpen && <span className="text-amber-400 text-[11px] self-center whitespace-nowrap font-bold">✋ CHOP : vous devez ouvrir ou annuler</span>}
              {gameState.turnState?.mandatoryChopCardId && !hasPlayedMandatoryChopCard(gameState) && <span className="text-purple-300 text-[11px] self-center whitespace-nowrap font-bold">La carte CHOP doit être jouée dans une combinaison</span>}
              {availableActions?.canCancelChop && <button onClick={actions.cancelChop} className="btn-secondary min-h-10 text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0">↩️ Annuler CHOP</button>}
              {detectedType && <button onClick={handleAutoPlace} className="btn-primary text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0">🃏 Poser {getCombinationClassLabel({ id: 'preview', type: detectedType, cards: selCards, ownerId: hp.id })}{pendingJokerPlacement ? ` (Joker→${jokerPlacementLabel(pendingJokerPlacement)})` : ''}</button>}
              {hp.status !== 'opened' && humanCombos.length > 0 && <span className="text-[10px] text-slate-300">{openingRequirements(gameState,hp.id).waived?'Équipier ouvert : ouverture sans seuil.':openingStatusText({opened:false,naturalScore,vierge:viergeThreshold,suite:gameState.suite,total:liveTotal,hasCombos:true})}</span>}
              {hp.status !== 'opened' && humanCombos.length > 0 && <button onClick={actions.confirmOpening} className="btn-primary px-3 py-1.5">Valider l’ouverture</button>}
              {[...gameState.tableCombinations,...draftHumanCombos].filter(combo => selCards.length > 0 && canPlayerRecoverJoker(gameState,hp.id,combo) && canRecoverJoker(combo, selCards)).map(combo => <button key={`recover-${combo.id}`} onClick={() => actions.recoverJokerAction(combo.id, selectedCards)} className="btn-primary px-3 py-1.5">Récupérer le Joker</button>)}
              {hp.status !== 'opened' && humanCombos.length > 0 && <button onClick={actions.takeBack} className="btn-secondary text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0">↩️ Reprendre</button>}
              {returnableCarreIds.length > 0 && <button onClick={() => actions.returnCarre(returnableCarreIds[0])} className="text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0 rounded-lg font-bold bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-900">📦 Rentrer le carré dans la base</button>}
              {selCards.length >= 3 && !detectedType && <span className="text-red-400 text-[10px] self-center">Invalide</span>}
              {selectedCards.length === 1 && hp.hand.find(c => c.id === selectedCards[0])?.isJoker && <button onClick={() => actions.discardCard(selectedCards[0], false)} className="btn-danger text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0 bg-gradient-to-r from-purple-600 to-purple-800">🃏 RJ</button>}
              {selectedCards.length >= 2 && <button onClick={lockSelection} className="text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0 rounded-lg font-bold bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-900">🔒 Verrouiller la sélection ({selectedCards.length})</button>}
              {selectedCards.length > 0 && <button onClick={actions.clearSelection} className="btn-secondary text-xs px-2 py-1.5 flex-shrink-0">✕</button>}
            </>)}
            {!isMyTurn && canReport && <span className="text-[10px] text-slate-400 whitespace-nowrap">Cliquez sur un nom adverse pour le signaler</span>}
          </div>
          <PlayerHand
            cards={orderedHand}
            selectedCards={isMyTurn ? selectedCards : []}
            groups={handGroups}
            lockedSetForCard={lockedSetForCard}
            onUnlockSet={unlockSet}
            onLockGroup={lockGroup}
            onSelectCard={isMyTurn ? actions.selectCard : () => {}}
            onSelectGroup={isMyTurn ? handleSelectGroup : () => {}}
            disabled={dealing || !isMyTurn || phase === 'must_draw'}
            sortMode={sortMode} onSortChange={handleSortChange} onReorder={handleReorder}
            onCardDragStart={canAct ? onCardDragStart : undefined}
            onCardDragEnd={canAct ? onCardDragEnd : undefined}
            onTouchDrop={canAct ? onHandTouchDrop : undefined} />
          </>)}
        </section>
      )}

      <div className="game-info-bar flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-800/90 border-b border-slate-700 z-20">
        <button onClick={onBack} className="text-amber-400 text-sm font-bold">← Menu</button>
        <div className="min-w-0 flex-1 flex flex-wrap justify-center items-center gap-x-2 text-[11px]">
          <span className="text-slate-400">VIERGE : <span className="text-emerald-300 font-bold">{viergeThreshold}</span></span>
          <span className="text-slate-400">SUITE : <span className="text-amber-400 font-bold">{gameState.suite}</span></span>
          <span className="text-slate-400">TOTAL : <span className="text-amber-400 font-bold">{liveTotal}</span></span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400">R{gameState.roundNumber} · Pioche: <span className="text-amber-400 font-bold">{gameState.deck.length}</span></span>
        </div>
        <button onClick={() => setShowScores(true)} className="text-amber-400 text-sm font-bold">📊</button>
      </div>

      {gameState.phase === 'playing' && (
          <div className="local-player-summary px-3 py-0.5 bg-slate-900/50 text-[10px] text-slate-400">
            <span><span className="player-color-dot" style={{backgroundColor:playerColor(publicView.players,hp.id)}}/> {hp.name}{dealer.id===hp.id?' · Donneur':''} · {SEAT_LABELS[hp.seat]}{gameState.firstPlayerIndex === 0 ? ' · Départ (15 cartes)' : ''} · {hp.hand.length} cartes</span>
            <span>{hp.status === 'opened' ? '✅ Ouvert' : '⏳ Non ouvert'}</span>
            <span>{isTeamMode(config)?TEAM_NAMES[teamOf(hp)]:'Score'}: {hp.score}</span>
          </div>
      )}

    </div>
  );
}
