'use client';
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  GameState, GameConfig, DEFAULT_CONFIG,
  GameCard, Player, Combination,
} from '../core/types';
import {
  createInitialGameState, performDrawing, startNewRound,
  drawCard, chopCard, placeCombination, addToCombination,
  recoverJoker, discard, getAvailableActions, canChop,
  takeBackCombinations, reportFault, rejectChop,
  AvailableActions,
} from '../core/engine';
import { FaultType } from '../core/types';
import { executeAITurn } from '../ai/ai-player';

export interface GameActions {
  startGame: (config: GameConfig, playerNames: string[]) => void;
  newRound: () => void;
  draw: () => void;
  chop: () => void;
  cancelChop: () => void;
  place: (cardIds: string[], type: 'tierce' | 'carre') => void;
  addToCombo: (cardId: string, comboId: string) => void;
  recoverJokerAction: (comboId: string, replacementCardId: string) => void;
  reportFaultAgainst: (accusedId: string, type: FaultType) => { valid: boolean; message: string };
  takeBack: () => void;
  discardCard: (cardId: string, faceDown?: boolean) => void;
  selectCard: (cardId: string) => void;
  deselectCard: (cardId: string) => void;
  clearSelection: () => void;
}

export function useGame() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [availableActions, setAvailableActions] = useState<AvailableActions | null>(null);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update available actions when game state changes
  useEffect(() => {
    if (gameState && gameState.phase === 'playing') {
      setAvailableActions(getAvailableActions(gameState));
    }
  }, [gameState]);

  // Handle AI turns
  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing') return;

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (currentPlayer.isAI && gameState.turnState?.phase === 'must_draw') {
      // Delay AI turn for visual effect
      aiTimerRef.current = setTimeout(() => {
        const newState = executeAITurn(gameState);
        setGameState(newState);
      }, 800);

      return () => {
        if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
      };
    }
  }, [gameState]);

  const startGame = useCallback((config: GameConfig, playerNames: string[]) => {
    let state = createInitialGameState(config, playerNames);
    state = performDrawing(state);
    state = startNewRound(state);
    setGameState(state);
    setSelectedCards([]);
  }, []);

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

  const place = useCallback((cardIds: string[], type: 'tierce' | 'carre') => {
    if (!gameState) return;
    const state = placeCombination(gameState, cardIds, type);
    setGameState(state);
    setSelectedCards([]);
  }, [gameState]);

  const addToCombo = useCallback((cardId: string, comboId: string) => {
    if (!gameState) return;
    const state = addToCombination(gameState, cardId, comboId);
    setGameState(state);
    setSelectedCards(prev => prev.filter(id => id !== cardId));
  }, [gameState]);

  const recoverJokerAction = useCallback((comboId: string, replacementCardId: string) => {
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
    // The human (player 0) is always the accuser.
    const result = reportFault(gameState, gameState.players[0].id, accusedId, type);
    setGameState(result.state);
    return { valid: result.valid, message: result.message };
  }, [gameState]);

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
    discardCard,
    selectCard,
    deselectCard,
    clearSelection,
  };

  return {
    gameState,
    selectedCards,
    availableActions,
    actions,
  };
}
