'use client';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  GameState, GameConfig, DEFAULT_CONFIG,
  GameCard, Player, Combination,
} from '../core/types';
import {
  createInitialGameState, performDrawing, startNewRound,
  drawCard, chopCard, placeCombination, addToCombination,
  recoverJoker, discard, getAvailableActions, canChop,
  takeBackCombinations, reportFault, rejectChop, returnCarreToBase, confirmOpening,
} from '../core/engine';
import type { JokerExtensionSide } from '../core/validation';
import { FaultType, JokerPlacement } from '../core/types';
import { reorderHand } from '@/components/presentation/hand-order';
import { executeAITurn } from '../ai/ai-player';
import { activeAccuserId } from '../core/hotseat';

export function getDrawnCardSelectionId(state: GameState | null): string | null {
  const turn = state?.turnState;
  return turn?.drawSource === 'deck' && turn.drawnCard ? turn.drawnCard.id : null;
}

export interface GameActions {
  startGame: (config: GameConfig, playerNames: string[]) => void;
  newRound: () => void;
  draw: () => void;
  chop: () => void;
  cancelChop: () => void;
  place: (cardIds: string[], type: 'tierce' | 'carre', jokerPlacement?: JokerPlacement) => void;
  addToCombo: (cardId: string, comboId: string, side?: JokerExtensionSide) => void;
  recoverJokerAction: (comboId: string, replacementCardId: string | string[]) => void;
  reportFaultAgainst: (accusedId: string, type: FaultType) => { valid: boolean; message: string };
  takeBack: () => void;
  confirmOpening: () => void;
  returnCarre: (comboId: string) => void;
  discardCard: (cardId: string, faceDown?: boolean) => void;
  selectCard: (cardId: string) => void;
  deselectCard: (cardId: string) => void;
  clearSelection: () => void;
  reorderHand: (ids: string[]) => void;
}

export function useGame(
  initialState: GameState | null = null,
  initialSelection: string[] = [],
  dealing = false,
  /**
   * Local pass-and-play: every seat is human and the person holding the device
   * is the current player. In solo, the single human stays the first seat.
   */
  hotseat = false,
) {
  const [gameState, setGameState] = useState<GameState | null>(initialState);
  const [selectedCards, setSelectedCards] = useState<string[]>(initialSelection);
  /**
   * The human who owns the screen right now. Every action below (available
   * actions, hand reordering, fault reporting) is evaluated from this seat,
   * never from a hard-coded first player.
   */
  const perspectiveIdOf = useCallback(
    (state: GameState | null) => {
      if (!state) return undefined;
      // Same definition as the UI: the human who holds the device is the one
      // whose actions and reports are evaluated.
      return activeAccuserId(state, hotseat ? 'hotseat' : 'solo');
    },
    [hotseat],
  );
  const activePlayerId = perspectiveIdOf(gameState);
  // The report list is built for the local player, so signalling an opponent
  // stays possible at any moment — including during somebody else's turn.
  const availableActions = useMemo(
    () => gameState?.phase === 'playing'
      ? getAvailableActions(gameState, activePlayerId)
      : null,
    [gameState, activePlayerId]
  );
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handle AI turns
  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing' || dealing || hotseat) return;

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (
      currentPlayer.isAI &&
      (gameState.turnState?.phase === 'must_draw' || gameState.turnState?.isInitialDealTurn)
    ) {
      // The starter's first turn begins in play (15 dealt cards, no draw).
      // Delay either kind of AI turn for visual effect.
      aiTimerRef.current = setTimeout(() => {
        const newState = executeAITurn(gameState);
        setGameState(newState);
      }, 800);

      return () => {
        if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
      };
    }
  }, [gameState,dealing,hotseat]);

  const startGame = useCallback((config: GameConfig, playerNames: string[]) => {
    let state = createInitialGameState(
      config,
      playerNames,
      hotseat ? { humans: 'all' } : { humans: 'first' },
    );
    state = performDrawing(state);
    state = startNewRound(state);
    setGameState(state);
    setSelectedCards([]);
  }, [hotseat]);

  const newRound = useCallback(() => {
    if (!gameState) return;
    const state = startNewRound(gameState);
    setGameState(state);
    setSelectedCards([]);
  }, [gameState]);

  const draw = useCallback(() => {
    if (!gameState) return;
    const state = drawCard(gameState);
    setGameState(state);
    const drawnId = getDrawnCardSelectionId(state);
    if (drawnId) setSelectedCards([drawnId]);
  }, [gameState]);

  const chop = useCallback(() => {
    if (!gameState) return;
    const state = chopCard(gameState);
    setGameState(state);
  }, [gameState]);

  const cancelChop = useCallback(() => {
    if (!gameState) return;
    const state = rejectChop(gameState);
    setGameState(state);
    setSelectedCards([]);
  }, [gameState]);

  const place = useCallback((
    cardIds: string[],
    type: 'tierce' | 'carre',
    jokerPlacement?: JokerPlacement,
  ) => {
    if (!gameState) return;
    const state = placeCombination(gameState, cardIds, type, jokerPlacement);
    setGameState(state);
    setSelectedCards([]);
  }, [gameState]);

  const returnCarre = useCallback((comboId: string) => {
    if (!gameState) return;
    const state = returnCarreToBase(gameState, comboId);
    setGameState(state);
  }, [gameState]);

  const addToCombo = useCallback((cardId: string, comboId: string, side?: JokerExtensionSide) => {
    if (!gameState) return;
    const state = addToCombination(gameState, cardId, comboId, side);
    setGameState(state);
    setSelectedCards(prev => prev.filter(id => id !== cardId));
  }, [gameState]);

  const recoverJokerAction = useCallback((comboId: string, replacementCardId: string | string[]) => {
    if (!gameState) return;
    const state = recoverJoker(gameState, comboId, replacementCardId);
    setGameState(state);
    setSelectedCards([]);
  }, [gameState]);

  const takeBack = useCallback(() => {
    if (!gameState) return;
    setGameState(takeBackCombinations(gameState));
    setSelectedCards([]);
  }, [gameState]);

  const reportFaultAgainst = useCallback((accusedId: string, type: FaultType) => {
    if (!gameState) return { valid: false, message: '' };
    // The accuser is the human currently holding the device (the one who
    // clicked), never a hard-coded seat. Any other player can be accused, at
    // any moment of the round.
    const accuserId = perspectiveIdOf(gameState);
    if (!accuserId) return { valid: false, message: '' };
    const result = reportFault(gameState, accuserId, accusedId, type);
    setGameState(result.state);
    return { valid: result.valid, message: result.message };
  }, [gameState, perspectiveIdOf]);

  const discardCard = useCallback((cardId: string, faceDown: boolean = true) => {
    if (!gameState) return;
    const state = discard(gameState, cardId, faceDown);
    setGameState(state);
    setSelectedCards([]);
  }, [gameState]);

  const selectCard = useCallback((cardId: string) => {
    setSelectedCards(prev =>
      prev.includes(cardId) ? prev.filter(id => id !== cardId) : [...prev, cardId]
    );
  }, []);

  const deselectCard = useCallback((cardId: string) => {
    setSelectedCards(prev => prev.filter(id => id !== cardId));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedCards([]);
  }, []);

  const actions: GameActions = {
    startGame,
    newRound,
    draw,
    chop,
    cancelChop,
    place,
    addToCombo,
    recoverJokerAction,
    reportFaultAgainst,
    takeBack,
    confirmOpening: () => { if (gameState) setGameState(confirmOpening(gameState)); },
    returnCarre,
    discardCard,
    selectCard,
    deselectCard,
    clearSelection,
    reorderHand: (ids) => setGameState(state => {
      const id = perspectiveIdOf(state);
      return state && id ? reorderHand(state, id, ids) : state;
    }),
  };

  return {
    gameState,
    selectedCards,
    availableActions,
    actions,
  };
}
