// =====================================================
// GAME ENGINE - Core game loop and state management
// =====================================================
import {
  GameState, GameConfig, GameCard, Player, Combination,
  TurnState, TurnAction, RoundResult, Fault,
  DEFAULT_CONFIG, INITIAL_THRESHOLDS, GamePhase,
  getCardDisplayName, RoundEndType,
} from './types';
import { createDeck, shuffleDeck, dealCardsSimple, performTirage } from './deck';
import {
  validateCombination, validateFirstPose, canAddToCombination,
  canRecoverJoker, isCardPlayableOnTable, getNextPlayerIndex,
  getPreviousPlayerIndex, calculateCombinationValue,
  getJokerCount, getNonJokerCards, createFault,
  determineJokerRepresentation,
} from './validation';

let combinationIdCounter = 0;
function nextCombinationId(): string {
  return `combo-${++combinationIdCounter}`;
}

export function createInitialGameState(config: GameConfig, playerNames: string[]): GameState {
  const playerCount = config.playerCount;
  const initialThreshold = INITIAL_THRESHOLDS[playerCount];

  const players: Player[] = playerNames.map((name, i) => ({
    id: `player-${i}`,
    name,
    hand: [],
    status: 'not_opened',
    isAI: i > 0, // First player is human by default
    seatIndex: i,
    score: 0,
    roundScores: [],
    hasChoppedThisRound: false,
    usedInitialThreshold: false,
  }));

  return {
    config,
    phase: 'setup',
    players,
    deck: [],
    discardPile: [],
    tableCombinations: [],
    currentPlayerIndex: 0,
    firstPlayerIndex: 0,
    turnState: null,
    suite: initialThreshold,
    initialThreshold,
    roundNumber: 0,
    cycleCount: 0,
    lastOpeningPlayerIndex: null,
    roundResults: [],
    actionHistory: [],
    faults: [],
  };
}

export function performDrawing(state: GameState): GameState {
  const order = performTirage(state.config.playerCount);
  const firstPlayerIndex = order[0];

  return {
    ...state,
    phase: 'drawing',
    firstPlayerIndex,
    currentPlayerIndex: firstPlayerIndex,
    players: state.players.map((p, i) => ({
      ...p,
      seatIndex: order.indexOf(i),
    })),
  };
}

export function startNewRound(state: GameState): GameState {
  combinationIdCounter = 0;
  const deck = shuffleDeck(createDeck());
  const { hands, remainingDeck } = dealCardsSimple(
    deck,
    state.config.playerCount,
    state.firstPlayerIndex
  );

  const players = state.players.map((p, i) => ({
    ...p,
    hand: hands[i],
    status: 'not_opened' as const,
    openingValue: undefined,
    hasChoppedThisRound: false,
    usedInitialThreshold: false,
  }));

  const initialThreshold = INITIAL_THRESHOLDS[state.config.playerCount];

  return {
    ...state,
    phase: 'playing',
    players,
    deck: remainingDeck,
    discardPile: [],
    tableCombinations: [],
    currentPlayerIndex: state.firstPlayerIndex,
    turnState: createTurnState(players[state.firstPlayerIndex].id),
    suite: initialThreshold,
    initialThreshold,
    roundNumber: state.roundNumber + 1,
    cycleCount: 0,
    lastOpeningPlayerIndex: null,
    faults: [],
    actionHistory: [],
  };
}

function createTurnState(playerId: string): TurnState {
  return {
    playerId,
    phase: 'must_draw',
    hasDrawn: false,
    hasDiscarded: false,
    actionsThisTurn: [],
    recoveredJokers: [],
    reusedJokers: [],
    temporaryCombinations: [],
  };
}

// ---- DRAW ----

export function drawCard(state: GameState): GameState {
  if (!state.turnState || state.turnState.phase !== 'must_draw') {
    return state;
  }

  if (state.deck.length === 0) {
    // Need to reshuffle
    return handleEmptyDeck(state);
  }

  const card = state.deck[0];
  const remainingDeck = state.deck.slice(1);
  const currentPlayer = state.players[state.currentPlayerIndex];

  const updatedPlayers = state.players.map(p =>
    p.id === currentPlayer.id
      ? { ...p, hand: [...p.hand, card] }
      : p
  );

  return {
    ...state,
    deck: remainingDeck,
    players: updatedPlayers,
    turnState: {
      ...state.turnState,
      phase: 'playing',
      hasDrawn: true,
      drawnCard: card,
      drawSource: 'deck',
    },
  };
}

// ---- CHOP ----

export function canChop(state: GameState): boolean {
  if (!state.turnState || state.turnState.phase !== 'must_draw') return false;
  if (state.discardPile.length === 0) return false;
  return true;
}

export function chopCard(state: GameState): GameState {
  if (!canChop(state)) return state;

  const card = state.discardPile[state.discardPile.length - 1];
  const currentPlayer = state.players[state.currentPlayerIndex];

  const updatedPlayers = state.players.map(p =>
    p.id === currentPlayer.id
      ? { ...p, hand: [...p.hand, card], hasChoppedThisRound: true }
      : p
  );

  const updatedDiscardPile = state.discardPile.slice(0, -1);

  // Apply chop malus to the previous player
  const prevPlayerIndex = getPreviousPlayerIndex(state.currentPlayerIndex, state.config.playerCount);
  const malus = currentPlayer.status === 'not_opened'
    ? state.config.malusChopOuverture
    : state.config.malusChopJoueurOuvert;

  const faults: Fault[] = malus > 0 ? [{
    playerId: state.players[prevPlayerIndex].id,
    type: 'other_violation',
    penalty: malus,
    description: currentPlayer.status === 'not_opened'
      ? `Malus CHOP ouverture: +${malus}`
      : `Malus CHOP joueur ouvert: +${malus}`,
  }] : [];

  return {
    ...state,
    players: updatedPlayers,
    discardPile: updatedDiscardPile,
    faults: [...state.faults, ...faults],
    turnState: {
      ...state.turnState!,
      phase: 'playing',
      hasDrawn: true,
      drawnCard: card,
      drawSource: 'chop',
    },
  };
}

export function rejectChop(state: GameState): GameState {
  // Player tried to chop but can't use it, return card to discard
  if (!state.turnState?.drawnCard || state.turnState.drawSource !== 'chop') {
    return state;
  }

  const card = state.turnState.drawnCard;
  const currentPlayer = state.players[state.currentPlayerIndex];

  const updatedPlayers = state.players.map(p =>
    p.id === currentPlayer.id
      ? { ...p, hand: p.hand.filter(c => c.id !== card.id) }
      : p
  );

  return {
    ...state,
    players: updatedPlayers,
    discardPile: [...state.discardPile, card],
    turnState: {
      ...state.turnState,
      phase: 'must_draw',
      hasDrawn: false,
      drawnCard: undefined,
      drawSource: undefined,
    },
  };
}

// ---- PLACE COMBINATION ----

export function placeCombination(
  state: GameState,
  cardIds: string[],
  type: 'tierce' | 'carre'
): GameState {
  if (!state.turnState || state.turnState.phase !== 'playing') return state;

  const currentPlayer = state.players[state.currentPlayerIndex];
  const cards = cardIds.map(id => currentPlayer.hand.find(c => c.id === id)).filter(Boolean) as GameCard[];

  if (cards.length !== cardIds.length) return state;

  const comboId = nextCombinationId();
  const combo: Combination = {
    id: comboId,
    type,
    cards,
    ownerId: currentPlayer.id,
  };

  // Set joker representation
  const jokerRep = determineJokerRepresentation(combo);
  if (jokerRep) {
    combo.jokerRepresents = jokerRep;
    combo.jokerPosition = cards.findIndex(c => c.isJoker);
  }

  const validation = validateCombination(combo);
  if (!validation.valid) return state;

  // Check tierce max 5 cards on first placement
  if (type === 'tierce' && cards.length > 5) return state;

  // Remove cards from hand
  const remainingHand = currentPlayer.hand.filter(c => !cardIds.includes(c.id));

  const updatedPlayers = state.players.map(p =>
    p.id === currentPlayer.id ? { ...p, hand: remainingHand } : p
  );

  return {
    ...state,
    players: updatedPlayers,
    tableCombinations: [...state.tableCombinations, combo],
    turnState: {
      ...state.turnState,
      actionsThisTurn: [
        ...state.turnState.actionsThisTurn,
        { type: 'place_combination', playerId: currentPlayer.id, data: { comboId }, timestamp: Date.now() },
      ],
    },
  };
}

// ---- ADD TO COMBINATION ----

export function addToCombination(
  state: GameState,
  cardId: string,
  combinationId: string
): GameState {
  if (!state.turnState || state.turnState.phase !== 'playing') return state;

  const currentPlayer = state.players[state.currentPlayerIndex];
  const card = currentPlayer.hand.find(c => c.id === cardId);
  if (!card) return state;

  const comboIndex = state.tableCombinations.findIndex(c => c.id === combinationId);
  if (comboIndex === -1) return state;

  const combo = state.tableCombinations[comboIndex];

  // Can only add to combinations of opened players or own during first pose
  const comboOwner = state.players.find(p => p.id === combo.ownerId);
  if (comboOwner && comboOwner.status !== 'opened' && comboOwner.id !== currentPlayer.id) {
    return state;
  }

  if (!canAddToCombination(combo, card)) return state;

  // Add card to combination
  const updatedCombo: Combination = {
    ...combo,
    cards: [...combo.cards, card],
  };

  // Update joker representation if needed
  const jokerRep = determineJokerRepresentation(updatedCombo);
  if (jokerRep) {
    updatedCombo.jokerRepresents = jokerRep;
  }

  const updatedCombinations = [...state.tableCombinations];
  updatedCombinations[comboIndex] = updatedCombo;

  // Check if carré is complete
  let newState = {
    ...state,
    tableCombinations: updatedCombinations,
    players: state.players.map(p =>
      p.id === currentPlayer.id
        ? { ...p, hand: p.hand.filter(c => c.id !== cardId) }
        : p
    ),
  };

  if (updatedCombo.type === 'carre' && updatedCombo.cards.length === 4) {
    newState = handleCompletedCarre(newState, updatedCombo);
  }

  return newState;
}

// ---- RECOVER JOKER ----

export function recoverJoker(
  state: GameState,
  combinationId: string,
  replacementCardId: string
): GameState {
  if (!state.turnState || state.turnState.phase !== 'playing') return state;

  const currentPlayer = state.players[state.currentPlayerIndex];
  const replacementCard = currentPlayer.hand.find(c => c.id === replacementCardId);
  if (!replacementCard) return state;

  const comboIndex = state.tableCombinations.findIndex(c => c.id === combinationId);
  if (comboIndex === -1) return state;

  const combo = state.tableCombinations[comboIndex];

  if (!canRecoverJoker(combo, replacementCard)) return state;

  // For non-opened player, check SUITE requirement
  if (currentPlayer.status === 'not_opened') {
    // They need to have SUITE met BEFORE touching the joker
    // This is validated at final pose validation
  }

  // Replace joker with the card
  const jokerCard = combo.cards.find(c => c.isJoker);
  if (!jokerCard) return state;

  const updatedCards = combo.cards.map(c =>
    c.isJoker ? replacementCard : c
  );

  const updatedCombo: Combination = {
    ...combo,
    cards: updatedCards,
    jokerPosition: undefined,
    jokerRepresents: undefined,
  };

  const updatedCombinations = [...state.tableCombinations];
  updatedCombinations[comboIndex] = updatedCombo;

  // Remove replacement card from hand, add joker to hand
  const updatedHand = currentPlayer.hand
    .filter(c => c.id !== replacementCardId)
    .concat([jokerCard]);

  return {
    ...state,
    tableCombinations: updatedCombinations,
    players: state.players.map(p =>
      p.id === currentPlayer.id ? { ...p, hand: updatedHand } : p
    ),
    turnState: {
      ...state.turnState,
      recoveredJokers: [...state.turnState.recoveredJokers, jokerCard.id],
      actionsThisTurn: [
        ...state.turnState.actionsThisTurn,
        { type: 'recover_joker', playerId: currentPlayer.id, data: { jokerId: jokerCard.id }, timestamp: Date.now() },
      ],
    },
  };
}

// ---- DISCARD ----

export function discard(state: GameState, cardId: string, faceDown: boolean = false): GameState {
  if (!state.turnState || state.turnState.phase !== 'playing') return state;

  const currentPlayer = state.players[state.currentPlayerIndex];
  const card = currentPlayer.hand.find(c => c.id === cardId);
  if (!card) return state;

  // Validate the turn before allowing discard
  const validationResult = validateTurnEnd(state, currentPlayer, card, faceDown);

  let newState = { ...state };

  // Apply faults from validation
  if (validationResult.faults.length > 0) {
    newState = {
      ...newState,
      faults: [...newState.faults, ...validationResult.faults],
    };
  }

  // If player was not opened and is now opening
  if (validationResult.isOpening) {
    const openingValue = validationResult.vierge;
    const newSuite = Math.max(state.suite, openingValue + 1);

    newState = {
      ...newState,
      suite: newSuite,
      lastOpeningPlayerIndex: state.currentPlayerIndex,
      cycleCount: 0, // Reset cycle count on opening
    };
  }

  // Update player status
  const updatedPlayers = newState.players.map(p =>
    p.id === currentPlayer.id
      ? {
          ...p,
          hand: p.hand.filter(c => c.id !== cardId),
          status: validationResult.isOpening ? 'opened' as const : p.status,
          openingValue: validationResult.isOpening ? validationResult.vierge : p.openingValue,
        }
      : p
  );

  // Check if player has won (hand is empty after discard)
  const playerAfterDiscard = updatedPlayers.find(p => p.id === currentPlayer.id)!;
  const hasWon = playerAfterDiscard.hand.length === 0;

  // Determine RS or RJ
  let endType: RoundEndType | null = null;
  if (hasWon) {
    if (card.isJoker && !faceDown) {
      endType = 'RJ';
    } else {
      endType = 'RS';
    }
  }

  // Check playable discard fault for opened players
  if (!hasWon && currentPlayer.status === 'opened' && !card.isJoker) {
    if (isCardPlayableOnTable(card, newState.tableCombinations)) {
      newState = {
        ...newState,
        faults: [...newState.faults, createFault(currentPlayer.id, 'playable_discard', state.config)],
      };
    }
  }

  // Move to next player or end round
  const nextIndex = getNextPlayerIndex(state.currentPlayerIndex, state.config.playerCount);

  if (hasWon && endType) {
    const roundResult = calculateRoundScores(
      { ...newState, players: updatedPlayers },
      currentPlayer.id,
      endType
    );

    const finalPlayers = updatedPlayers.map(p => {
      const roundScore = roundResult.scores[p.id] || 0;
      return {
        ...p,
        score: p.score + roundScore,
        roundScores: [...p.roundScores, roundScore],
      };
    });

    return {
      ...newState,
      phase: 'round_end',
      players: finalPlayers,
      discardPile: [...newState.discardPile, card],
      roundResults: [...newState.roundResults, roundResult],
      turnState: null,
    };
  }

  return {
    ...newState,
    players: updatedPlayers,
    discardPile: [...newState.discardPile, card],
    currentPlayerIndex: nextIndex,
    turnState: createTurnState(updatedPlayers[nextIndex].id),
  };
}

// ---- Turn End Validation ----

function validateTurnEnd(
  state: GameState,
  player: Player,
  discardCard: GameCard,
  faceDown: boolean
): {
  isOpening: boolean;
  vierge: number;
  faults: Fault[];
} {
  const faults: Fault[] = [];
  let isOpening = false;
  let vierge = 0;

  // Get combinations placed by this player this turn
  const playerCombinations = state.tableCombinations.filter(c => c.ownerId === player.id);

  if (player.status === 'not_opened' && playerCombinations.length > 0) {
    // First pose validation
    const hasJokerInHand = player.hand.some(c => c.isJoker);
    const validation = validateFirstPose(
      playerCombinations,
      state.suite,
      state.initialThreshold,
      hasJokerInHand,
      state.config
    );

    if (validation.valid) {
      isOpening = true;
      vierge = validation.vierge;
    } else {
      // Add faults for each error
      for (const error of validation.errors) {
        faults.push({
          playerId: player.id,
          type: 'below_suite',
          penalty: state.config.faultePenalty,
          description: error,
        });
      }
    }
  }

  // Check recovered jokers are reused
  if (state.turnState) {
    const unreusedJokers = state.turnState.recoveredJokers.filter(
      id => !state.turnState!.reusedJokers.includes(id)
    );
    // Jokers still in hand that were recovered must be in combinations
    for (const jokerId of unreusedJokers) {
      const inHand = player.hand.find(c => c.id === jokerId);
      if (inHand && inHand.id !== discardCard.id) {
        // Joker not reused - check if it's in any combination
        const inCombo = state.tableCombinations.some(combo =>
          combo.cards.some(c => c.id === jokerId)
        );
        if (!inCombo) {
          faults.push(createFault(player.id, 'illegal_joker_use', state.config));
        }
      }
    }
  }

  return { isOpening, vierge, faults };
}

// ---- Round Score Calculation ----

export function calculateRoundScores(
  state: GameState,
  winnerId: string,
  endType: RoundEndType
): RoundResult {
  const scores: Record<string, number> = {};
  const faults: Fault[] = [...state.faults];

  for (const player of state.players) {
    if (player.id === winnerId) {
      scores[player.id] = 0;
      continue;
    }

    const cardsLeft = player.hand.length;

    if (player.status === 'not_opened') {
      // Player never opened
      if (endType === 'RJ') {
        scores[player.id] = state.config.rjNonOpenedPenalty;
      } else {
        scores[player.id] = state.config.rsNonOpenedPenalty;
      }
    } else {
      // Player was opened, count remaining cards
      const perCard = endType === 'RJ' ? state.config.rjScorePerCard : state.config.rsScorePerCard;
      scores[player.id] = cardsLeft * perCard;
    }

    // Add fault penalties
    const playerFaults = faults.filter(f => f.playerId === player.id);
    for (const fault of playerFaults) {
      scores[player.id] += fault.penalty;
    }
  }

  return { winnerId, endType, scores, faults };
}

// ---- Empty Deck Handling ----

function handleEmptyDeck(state: GameState): GameState {
  const newCycleCount = state.cycleCount + 1;

  // Check 3 cycle rule
  if (newCycleCount >= state.config.maxCycles) {
    // Check if anyone opened since last cycle reset
    if (state.lastOpeningPlayerIndex === null) {
      // Null round
      const nullResult: RoundResult = {
        endType: 'null_round',
        scores: Object.fromEntries(state.players.map(p => [p.id, 0])),
        faults: [],
      };

      return {
        ...state,
        phase: 'round_end',
        roundResults: [...state.roundResults, nullResult],
        turnState: null,
      };
    }
  }

  // Reshuffle discard pile into deck
  const newDeck = shuffleDeck([...state.discardPile]);

  return {
    ...state,
    deck: newDeck,
    discardPile: [],
    cycleCount: newCycleCount,
  };
}

// ---- Completed Carré ----

function handleCompletedCarre(state: GameState, combo: Combination): GameState {
  // Remove from table and add back to deck
  const updatedCombinations = state.tableCombinations.filter(c => c.id !== combo.id);
  const updatedDeck = shuffleDeck([...state.deck, ...combo.cards]);

  return {
    ...state,
    tableCombinations: updatedCombinations,
    deck: updatedDeck,
  };
}

// ---- Get Available Actions ----

export interface AvailableActions {
  canDraw: boolean;
  canChop: boolean;
  canDiscard: boolean;
  canPlaceCombination: boolean;
  canAddToExisting: boolean;
  canRecoverJoker: boolean;
  chopCard?: GameCard;
  possibleCombinations: { cardIds: string[]; type: 'tierce' | 'carre' }[];
  possibleAdditions: { cardId: string; combinationId: string }[];
  possibleJokerRecoveries: { combinationId: string; replacementCardId: string }[];
}

export function getAvailableActions(state: GameState): AvailableActions {
  const result: AvailableActions = {
    canDraw: false,
    canChop: false,
    canDiscard: false,
    canPlaceCombination: false,
    canAddToExisting: false,
    canRecoverJoker: false,
    possibleCombinations: [],
    possibleAdditions: [],
    possibleJokerRecoveries: [],
  };

  if (!state.turnState || state.phase !== 'playing') return result;

  const currentPlayer = state.players[state.currentPlayerIndex];
  const ts = state.turnState;

  if (ts.phase === 'must_draw') {
    result.canDraw = state.deck.length > 0;
    result.canChop = canChop(state);
    if (result.canChop) {
      result.chopCard = state.discardPile[state.discardPile.length - 1];
    }
    return result;
  }

  if (ts.phase === 'playing') {
    result.canDiscard = currentPlayer.hand.length > 0;
    result.canPlaceCombination = true;
    result.canAddToExisting = true;
    result.canRecoverJoker = true;

    // Find possible additions to existing combinations
    for (const combo of state.tableCombinations) {
      const comboOwner = state.players.find(p => p.id === combo.ownerId);
      if (comboOwner && comboOwner.status !== 'opened' && comboOwner.id !== currentPlayer.id) {
        continue;
      }
      
      for (const card of currentPlayer.hand) {
        if (canAddToCombination(combo, card)) {
          result.possibleAdditions.push({
            cardId: card.id,
            combinationId: combo.id,
          });
        }
      }

      // Check joker recovery
      if (getJokerCount(combo.cards) > 0 && combo.jokerRepresents) {
        for (const card of currentPlayer.hand) {
          if (canRecoverJoker(combo, card)) {
            result.possibleJokerRecoveries.push({
              combinationId: combo.id,
              replacementCardId: card.id,
            });
          }
        }
      }
    }

    return result;
  }

  return result;
}

// ---- Check Chop Obligatoire ----

export function isChopRequired(state: GameState): boolean {
  if (!state.config.chopObligatoire) return false;
  const currentPlayer = state.players[state.currentPlayerIndex];
  return currentPlayer.status === 'not_opened';
}
