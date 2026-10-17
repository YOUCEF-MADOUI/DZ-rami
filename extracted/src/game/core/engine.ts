import { normalizeVariantConfig, isTeamMode, openingRequirements, isDiscardPlayable, calculateTeamScores, settleTeamScores } from './team-rules';
// =====================================================
// GAME ENGINE - Core game loop and state management
// =====================================================
import {
  GameState, GameConfig, GameCard, Player, Combination,
  TurnState, TurnAction, RoundResult, Fault, FaultType, CompletedTurnActionSnapshot,
  DEFAULT_CONFIG, INITIAL_THRESHOLDS, GamePhase,
  getCardDisplayName, RoundEndType, ReportRecord, TablePosition,
  getSeatOrder, JokerPlacement,
} from './types';
import { getJokerExtensionChoices, JokerExtensionSide } from './validation';
import { createDeck, shuffleDeck, dealCards, performTirage } from './deck';
import {
  validateCombination, validateFirstPose, canAddToCombination,
  canRecoverJoker, isCardPlayableOnTable,
  getJokerCount, createFault,
  resolveJokerPlacement, applyJokerPlacement,
  getStableJokerPlacement, isTrueCarre, insertCardAtLogicalPosition,
  isExplicitPlacementValid, canonicalizeCombination, refreshJokerMetadata, getJokerRepresentation,
} from './validation';

/**
 * Player indices ordered by the seats they occupy around the table. This is
 * the single source of truth for turn order, dealing order and the round
 * starter rotation — never an array index or an id.
 */
export function getPlayOrder(state: GameState): number[] {
  const seats = getSeatOrder(state.config.playerCount);
  return state.players
    .map((player, index) => ({ index, position: seats.indexOf(player.seat) }))
    .filter(entry => entry.position >= 0)
    .sort((a, b) => a.position - b.position)
    .map(entry => entry.index);
}

/** Index of the player who occupies the next seat after `fromIndex`. */
export function getNextSeatIndex(state: GameState, fromIndex: number): number {
  const order = getPlayOrder(state);
  if (order.length === 0) return fromIndex;
  const at = order.indexOf(fromIndex);
  if (at < 0) return order[0];
  return order[(at + 1) % order.length];
}

/** Index of the player who occupies the previous seat before `fromIndex`. */
export function getPreviousSeatIndex(state: GameState, fromIndex: number): number {
  const order = getPlayOrder(state);
  if (order.length === 0) return fromIndex;
  const at = order.indexOf(fromIndex);
  if (at < 0) return order[0];
  return order[(at - 1 + order.length) % order.length];
}

/** Round starter of the next round: the next seat after the current starter. */
export function getNextRoundStarterIndex(state: GameState): number {
  return getNextSeatIndex(state, state.firstPlayerIndex);
}

/** Seat label of a player, useful for the interface and for debugging. */
export function getPlayerSeat(state: GameState, playerIndex: number): TablePosition {
  return state.players[playerIndex]?.seat ?? 'south';
}

/** Detached recursive evidence cannot be changed by later turn mutations. */
function frozenSnapshot<T>(value: T): T {
  const copy = structuredClone(value);
  function freeze(item: unknown): void {
    if (item && typeof item === 'object') {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  }
  freeze(copy);
  return copy;
}

function nextCombinationId(state: GameState): string {
  const base = `combo-r${state.roundNumber}-p${state.currentPlayerIndex}-a${state.actionHistory.length}`;
  const existingIds = new Set([
    ...state.tableCombinations.map(combo => combo.id),
    ...(state.turnState?.temporaryCombinations ?? []).map(combo => combo.id),
  ]);
  let suffix = 0;
  let candidate = base;
  while (existingIds.has(candidate)) candidate = `${base}-${++suffix}`;
  return candidate;
}

const OPENING_DRAFT_ACTION_TYPES = new Set<TurnAction['type']>([
  'place_combination', 'add_to_combination', 'recover_joker', 'reuse_joker',
]);

function getPlayerTurnCombinations(state: GameState, playerId: string): Combination[] {
  const committed = state.tableCombinations.filter(combo => combo.ownerId === playerId);
  const pending = state.turnState?.playerId === playerId
    ? state.turnState.temporaryCombinations.filter(combo => combo.ownerId === playerId)
    : [];
  return [...committed, ...pending];
}

function removeOpeningDraftActions(history: TurnAction[], turn: TurnState): TurnAction[] {
  const reversible = new Set(turn.actionsThisTurn.filter(action => OPENING_DRAFT_ACTION_TYPES.has(action.type)));
  return history.filter(action => !reversible.has(action));
}

function rollbackOpeningDraft(state: GameState, playerId: string): GameState {
  const turn = state.turnState;
  if (!turn) return state;
  const draft = turn.temporaryCombinations.filter(combo => combo.ownerId === playerId);
  if (draft.length === 0) return state;
  const returnedCards = draft.flatMap(combo => combo.cards);
  return {
    ...state,
    actionHistory: removeOpeningDraftActions(state.actionHistory, turn),
    players: state.players.map(player => player.id === playerId
      ? { ...player, hand: [...player.hand, ...returnedCards] }
      : player),
    turnState: {
      ...turn,
      temporaryCombinations: turn.temporaryCombinations.filter(combo => combo.ownerId !== playerId),
      actionsThisTurn: turn.actionsThisTurn.filter(action => !OPENING_DRAFT_ACTION_TYPES.has(action.type)),
      recoveredJokers: [],
      reusedJokers: [],
    },
  };
}

/**
 * Which players are controlled by a human.
 *  - default (solo): only the first player, the others are robots;
 *  - `all`: local pass-and-play, every seat is human;
 *  - explicit indices: any mix (used by tests and future modes).
 */
export interface HumansOption {
  humans?: "first" | "all" | readonly number[];
}

/** Pure helper so the human/AI split is testable without building a game. */
export function isHumanSeat(
  humans: HumansOption["humans"],
  index: number,
  playerCount: number,
): boolean {
  if (humans === "all") return true;
  if (Array.isArray(humans)) return humans.includes(index);
  return index === 0 || playerCount <= 0;
}

export function createInitialGameState(
  config: GameConfig,
  playerNames: string[],
  options: HumansOption = {},
): GameState {
  config=normalizeVariantConfig(config);
  if(isTeamMode(config)&&playerNames.length!==4)throw new Error('Quatre noms requis en 2 contre 2.');
  const playerCount = config.playerCount;
  const initialThreshold = INITIAL_THRESHOLDS[playerCount];

  const seats = getSeatOrder(playerCount);
  const players: Player[] = playerNames.map((name, i) => ({
    id: `player-${i}`,
    name,
    hand: [],
    status: 'not_opened',
    isAI: !isHumanSeat(options.humans, i, playerNames.length),
    seat: seats[i], // SUD, EST, NORD-EST, NORD-OUEST, OUEST in rotation order
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
    basePile: [],
    discardHistory: [],
    tableCombinations: [],
    currentPlayerIndex: 0,
    firstPlayerIndex: 0,
    turnState: null,
    lastOpeningTotal: undefined,
    suite: initialThreshold,
    suiteLocked: false,
    initialThreshold,
    lastDiscardFaceDown: false,
    roundNumber: 0,
    cycleCount: 0,
    lastOpeningPlayerIndex: null,
    roundResults: [],
    actionHistory: [],
    lastCompletedTurnAction: null,
    lastCompletedTurnActionsByPlayer: {},
    reports: [],
    faults: [],
  };
}

/**
 * The tirage only decides WHO starts. Seats are physical and never move: the
 * local player stays SUD and every opponent keeps its own place at the table.
 */
export function performDrawing(state: GameState): GameState {
  const order = performTirage(state.config.playerCount);
  const firstPlayerIndex = order[0] ?? 0;

  return {
    ...state,
    phase: 'drawing',
    firstPlayerIndex,
    currentPlayerIndex: firstPlayerIndex,
  };
}

function startNewRoundImpl(state: GameState): GameState {
  if(state.phase==='game_end')return state;
  const deck = shuffleDeck(createDeck());
  const roundStarterIndex = state.roundNumber === 0
    ? state.firstPlayerIndex
    : getNextRoundStarterIndex(state);
  const { hands, remainingDeck } = dealCards(
    deck,
    getPlayOrder(state),
    roundStarterIndex
  );

  const players = state.players.map((p, i) => ({
    ...p,
    hand: hands[i],
    status: 'not_opened' as const,
    openingValue: undefined,
    openingTotal: undefined,
    openingSuiteThreshold: undefined,
    openingThreshold: undefined,
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
    basePile: [],
    discardHistory: [],
    tableCombinations: [],
    currentPlayerIndex: roundStarterIndex,
    firstPlayerIndex: roundStarterIndex,
    // The starter already received 15 cards. Begin directly in the play phase;
    // drawCard is therefore unable to give them a forbidden 16th card.
    turnState: createTurnState(players[roundStarterIndex].id, true),
    lastOpeningTotal: undefined,
    suite: initialThreshold,
    suiteLocked: false,
    initialThreshold,
    lastDiscardFaceDown: false,
    roundNumber: state.roundNumber + 1,
    cycleCount: 0,
    lastOpeningPlayerIndex: null,
    faults: [],
    actionHistory: [],
    lastCompletedTurnAction: null,
    lastCompletedTurnActionsByPlayer: {},
    reports: [],
  };
}

function createTurnState(playerId: string, isInitialDealTurn = false): TurnState {
  return {
    playerId,
    phase: isInitialDealTurn ? 'playing' : 'must_draw',
    hasDrawn: false,
    hasDiscarded: false,
    isInitialDealTurn,
    chopWasAvailableAtTurnStart: false,
    chopRejectedThisTurn: false,
    actionsThisTurn: [],
    recoveredJokers: [],
    reusedJokers: [],
    temporaryCombinations: [],
  };
}

/** Single engine entry point for validating a first opening candidate. */
export function validateOpening(
  state: GameState,
  playerId: string,
  combinations: Combination[],
  remainingHand?: GameCard[],
): ReturnType<typeof validateFirstPose> {
  const player = state.players.find(candidate => candidate.id === playerId);
  if (!player) {
    return { valid: false, vierge: 0, total: 0, requiredThreshold: state.initialThreshold, errors: ['Player not found'] };
  }
  // Retained for compatibility with AI planning callers; hand Jokers do not alter VIERGE.
  void remainingHand;
  // Independent thresholds: natural points >= VIERGE and total >= SUITE.
  return validateFirstPose(
    combinations,
    openingRequirements(state,playerId).natural,
    openingRequirements(state,playerId).waived ? {...state.config,tierceObligatoire:false} : state.config,
    openingRequirements(state,playerId).total,
  );
}

// ---- DRAW ----

function drawCardImpl(state: GameState): GameState {
  if (
    state.phase !== 'playing' ||
    !state.turnState ||
    state.turnState.phase !== 'must_draw' ||
    state.turnState.playerId !== state.players[state.currentPlayerIndex]?.id ||
    state.turnState.isInitialDealTurn
  ) {
    return state;
  }

  if (state.deck.length === 0) {
    // Need to reshuffle the discard pile back into the deck.
    const reshuffled = handleEmptyDeck(state);
    // If the round ended (null round) or still no deck available, stop here.
    if (reshuffled.phase !== 'playing' || reshuffled.deck.length === 0) return reshuffled;
    // Otherwise continue drawing from the freshly reshuffled deck.
    return drawCard(reshuffled);
  }

  const card = state.deck[0];
  const remainingDeck = state.deck.slice(1);
  const currentPlayer = state.players[state.currentPlayerIndex];

  const updatedPlayers = state.players.map(p =>
    p.id === currentPlayer.id
      ? { ...p, hand: [...p.hand, card] }
      : p
  );

  const action: TurnAction = {
    type: 'draw',
    playerId: currentPlayer.id,
    data: { cardId: card.id },
    timestamp: Date.now(),
  };

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
      chopWasAvailableAtTurnStart: state.turnState.chopWasAvailableAtTurnStart || canChop(state),
      actionsThisTurn: [...state.turnState.actionsThisTurn, action],
    },
    actionHistory: [...state.actionHistory, action],
  };
}

// ---- CHOP ----

export function canChop(state: GameState): boolean {
  if (
    state.phase !== 'playing' ||
    !state.turnState ||
    state.turnState.phase !== 'must_draw' ||
    state.turnState.playerId !== state.players[state.currentPlayerIndex]?.id
  ) return false;
  if (state.turnState.chopRejectedThisTurn || state.discardPile.length === 0) return false;
  return true;
}

function chopCardImpl(state: GameState): GameState {
  if (!canChop(state)) return state;

  const card = state.discardPile[state.discardPile.length - 1];
  const currentPlayer = state.players[state.currentPlayerIndex];
  const updatedPlayers = state.players.map(p =>
    p.id === currentPlayer.id
      ? { ...p, hand: [...p.hand, card], hasChoppedThisRound: true }
      : p
  );

  const prevPlayerIndex = getPreviousSeatIndex(state, state.currentPlayerIndex);
  const malus = isTeamMode(state.config)?0:currentPlayer.status === 'not_opened'
    ? state.config.malusChopOuverture
    : (state.config.malusChopJoueurOuvertActif ? state.config.malusChopJoueurOuvert : 0);
  const chopFaultId = malus > 0
    ? `chop:${state.roundNumber}:${currentPlayer.id}:${card.id}:${state.actionHistory.length}`
    : undefined;
  const faults: Fault[] = malus > 0 ? [{
    id: chopFaultId,
    playerId: state.players[prevPlayerIndex].id,
    type: 'other_violation',
    penalty: malus,
    description: currentPlayer.status === 'not_opened'
      ? `Malus CHOP ouverture: +${malus}`
      : `Malus CHOP joueur ouvert: +${malus}`,
  }] : [];
  const action: TurnAction = {
    type: 'chop',
    playerId: currentPlayer.id,
    data: { cardId: card.id },
    timestamp: Date.now(),
  };

  return {
    ...state,
    players: updatedPlayers,
    discardPile: state.discardPile.slice(0, -1),
    faults: [...state.faults, ...faults],
    turnState: {
      ...state.turnState!,
      phase: 'playing',
      hasDrawn: true,
      drawnCard: card,
      drawSource: 'chop',
      mandatoryChopCardId: state.config.chopCarteObligatoireAJouer ? card.id : undefined,
      chopWasAvailableAtTurnStart: true,
      previousHasChoppedThisRound: currentPlayer.hasChoppedThisRound,
      chopPenaltyFaultId: chopFaultId,
      actionsThisTurn: [...state.turnState!.actionsThisTurn, action],
    },
    actionHistory: [...state.actionHistory, action],
  };
}

/** Undo only the untouched CHOP transaction; once a card is played onto the
 * table, the action is committed and the chopped card can no longer be returned. */
function rejectChopImpl(state: GameState): GameState {
  const turn = state.turnState;
  if (
    state.phase !== 'playing' ||
    !turn?.drawnCard ||
    turn.phase !== 'playing' ||
    turn.playerId !== state.players[state.currentPlayerIndex]?.id ||
    turn.drawSource !== 'chop'
  ) return state;

  const currentPlayer = state.players[state.currentPlayerIndex];
  const canUndoOpeningDraft = currentPlayer.status === 'not_opened';
  if (turn.actionsThisTurn.some(action =>
    action.type !== 'chop' && !(canUndoOpeningDraft && OPENING_DRAFT_ACTION_TYPES.has(action.type))
  )) return state;

  const card = turn.drawnCard;
  // First-pose combinations are still an uncommitted draft. Undoing CHOP also
  // returns those cards, so the single physical chopped ID is removed exactly once.
  if (state.tableCombinations.some(combo => combo.cards.some(tableCard => tableCard.id === card.id))) return state;
  const handAfterDraftRollback = [
    ...currentPlayer.hand,
    ...turn.temporaryCombinations.flatMap(combo => combo.cards),
  ];
  const choppedCopies = handAfterDraftRollback.filter(handCard => handCard.id === card.id).length;
  if (choppedCopies !== 1) return state;
  const restoredHand = handAfterDraftRollback.filter(handCard => handCard.id !== card.id);

  const updatedPlayers = state.players.map(player =>
    player.id === currentPlayer.id
      ? {
          ...player,
          hand: restoredHand,
          hasChoppedThisRound: turn.previousHasChoppedThisRound ?? false,
        }
      : player
  );

  return {
    ...state,
    actionHistory: canUndoOpeningDraft ? removeOpeningDraftActions(state.actionHistory, turn) : state.actionHistory,
    players: updatedPlayers,
    discardPile: [...state.discardPile, card],
    lastDiscardFaceDown: false,
    faults: turn.chopPenaltyFaultId
      ? state.faults.filter(fault => fault.id !== turn.chopPenaltyFaultId)
      : state.faults,
    turnState: {
      ...turn,
      phase: 'must_draw',
      hasDrawn: false,
      drawnCard: undefined,
      drawSource: undefined,
      mandatoryChopCardId: undefined,
      previousHasChoppedThisRound: undefined,
      chopPenaltyFaultId: undefined,
      chopRejectedThisTurn: true,
      temporaryCombinations: [],
      actionsThisTurn: [],
      recoveredJokers: [],
      reusedJokers: [],
    },
  };
}

// ---- PLACE COMBINATION ----

function placeCombinationImpl(
  state: GameState,
  cardIds: string[],
  type: 'tierce' | 'carre',
  jokerPlacement?: JokerPlacement
): GameState {
  if (
    state.phase !== 'playing' ||
    !state.turnState ||
    state.turnState.phase !== 'playing' ||
    state.turnState.playerId !== state.players[state.currentPlayerIndex]?.id
  ) return state;

  const currentPlayer = state.players[state.currentPlayerIndex];
  if (new Set(cardIds).size !== cardIds.length) return state;
  const cards = cardIds.map(id => currentPlayer.hand.find(c => c.id === id)).filter(Boolean) as GameCard[];

  if (cards.length !== cardIds.length || currentPlayer.hand.length - cards.length < 1) return state;

  const comboId = nextCombinationId(state);
  const combo: Combination = {
    id: comboId,
    type,
    cards,
    ownerId: currentPlayer.id,
    completedById: type === 'carre' && cards.length === 4 ? currentPlayer.id : undefined,
  };

  // Keep the Joker exactly where the player put it while preparing the meld.
  // The explicit placement wins; auto-detection is only a fallback used when no
  // arrangement was supplied (AI planning, programmatic calls).
  const explicitPlacement = jokerPlacement ?? resolveJokerPlacement(cards, type);
  if (explicitPlacement && !isExplicitPlacementValid(combo, explicitPlacement)) return state;
  if (explicitPlacement) combo.jokerPlacement = explicitPlacement;
  const placement = applyJokerPlacement(combo);
  if (explicitPlacement && !placement.jokerPlacement) return state;
  const jokerRep = placement.jokerRepresents;
  if (jokerRep) {
    combo.jokerRepresents = jokerRep;
    combo.jokerPosition = placement.jokerPosition;
  }

  // A pose prepared IN THE HAND stays limited to 5 cards for a run.
  const validation = validateCombination(placement, { maxTierceLength: 5 });
  if (!validation.valid) return state;

  // Natural cards are ordered along the run; the Joker keeps its own slot.
  const ordered = canonicalizeCombination(applyJokerPlacement(placement));
  if (!validateCombination(ordered, { maxTierceLength: 5 }).valid) return state;
  combo.cards = ordered.cards;
  combo.jokerPlacement = ordered.jokerPlacement;
  combo.jokerPosition = ordered.jokerPosition;
  combo.jokerRepresents = ordered.jokerRepresents;

  // Remove cards from hand
  const remainingHand = currentPlayer.hand.filter(c => !cardIds.includes(c.id));

  const updatedPlayers = state.players.map(p =>
    p.id === currentPlayer.id ? { ...p, hand: remainingHand } : p
  );

  Object.assign(combo, refreshJokerMetadata(combo));
  const isOpeningDraft = currentPlayer.status === 'not_opened';
  const action: TurnAction = {
    type: 'place_combination',
    playerId: currentPlayer.id,
    data: { comboId, cardIds: [...cardIds], stagedOpening: isOpeningDraft },
    timestamp: Date.now(),
  };

  return {
    ...state,
    players: updatedPlayers,
    tableCombinations: isOpeningDraft ? state.tableCombinations : [...state.tableCombinations, combo],
    turnState: {
      ...state.turnState,
      temporaryCombinations: isOpeningDraft
        ? [...state.turnState.temporaryCombinations, combo]
        : state.turnState.temporaryCombinations,
      actionsThisTurn: [...state.turnState.actionsThisTurn, action],
      reusedJokers: [...new Set([
        ...state.turnState.reusedJokers,
        ...cards.filter(card => state.turnState!.recoveredJokers.includes(card.id)).map(card => card.id),
      ])],
    },
    actionHistory: [...state.actionHistory, action],
  };
}

/** Commit the whole opening atomically without ending the turn. */
function confirmOpeningImpl(state: GameState): GameState {
  const turn = state.turnState;
  const player = state.players[state.currentPlayerIndex];
  if (state.phase !== 'playing' || !turn || turn.phase !== 'playing' || turn.playerId !== player.id || player.status === 'opened') return state;
  if (!isTeamMode(state.config) && state.config.chopObligatoire && turn.drawSource === 'deck' && turn.chopWasAvailableAtTurnStart) return state;
  const requirements=openingRequirements(state,player.id);
  if(!turn.temporaryCombinations.length)return state;
  const validation = validateOpening(state, player.id, turn.temporaryCombinations);
  if (!validation.valid || player.hand.length < 1) return state;
  return { ...state,
    players: state.players.map(p => p.id === player.id ? { ...p, status: 'opened', openingValue: validation.vierge,
      openingTotal: validation.total, openingSuiteThreshold: requirements.total, openingThreshold: validation.requiredThreshold } : p),
    tableCombinations: [...state.tableCombinations, ...turn.temporaryCombinations],
    turnState: { ...turn, temporaryCombinations: [] }, suite: requirements.waived?state.suite:validation.total + 1,
    lastOpeningTotal: requirements.waived?state.lastOpeningTotal:validation.total,
    suiteLocked: true, cycleCount: 0, lastOpeningPlayerIndex: requirements.waived?state.lastOpeningPlayerIndex:state.currentPlayerIndex };
}

/** Historical evidence only. Physical reserve and current discard stay separate. */
function getDiscardAuditHistory(state: GameState): GameCard[] {
  return state.discardHistory ?? [];
}

// ---- TAKE BACK (undo an unfinished first pose) ----

// Returns all combinations the current (still not-opened) player laid this turn
// back into their hand. Lets a player reclaim cards when their pose doesn't
// reach the SUITE, instead of being stuck.
function takeBackCombinationsImpl(state: GameState): GameState {
  if (
    state.phase !== 'playing' ||
    !state.turnState ||
    state.turnState.phase !== 'playing' ||
    state.turnState.playerId !== state.players[state.currentPlayerIndex]?.id
  ) return state;
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (currentPlayer.status === 'opened') return state;
  if (state.turnState.actionsThisTurn.some(action => action.type === 'discard')) return state;

  const own = getPlayerTurnCombinations(state, currentPlayer.id);
  if (own.length === 0) return state;

  const returnedCards = own.flatMap(c => c.cards);
  return {
    ...state,
    actionHistory: removeOpeningDraftActions(state.actionHistory, state.turnState),
    tableCombinations: state.tableCombinations.filter(c => c.ownerId !== currentPlayer.id),
    players: state.players.map(p =>
      p.id === currentPlayer.id ? { ...p, hand: [...p.hand, ...returnedCards] } : p
    ),
    turnState: {
      ...state.turnState,
      temporaryCombinations: state.turnState.temporaryCombinations.filter(combo => combo.ownerId !== currentPlayer.id),
      actionsThisTurn: state.turnState.actionsThisTurn.filter(action => !OPENING_DRAFT_ACTION_TYPES.has(action.type)),
      recoveredJokers: [],
      reusedJokers: [],
    },
  };
}

// ---- ADD TO COMBINATION ----

function addToCombinationImpl(
  state: GameState,
  cardId: string,
  combinationId: string,
  jokerExtension?: JokerExtensionSide
): GameState {
  if (
    state.phase !== 'playing' ||
    !state.turnState ||
    state.turnState.phase !== 'playing' ||
    state.turnState.playerId !== state.players[state.currentPlayerIndex]?.id
  ) return state;

  const currentPlayer = state.players[state.currentPlayerIndex];
  const card = currentPlayer.hand.find(c => c.id === cardId);
  if (!card || currentPlayer.hand.length <= 1) return state;

  const comboIndex = state.tableCombinations.findIndex(combo => combo.id === combinationId);
  const temporaryIndex = state.turnState.temporaryCombinations.findIndex(combo => combo.id === combinationId);
  if (comboIndex === -1 && temporaryIndex === -1) return state;
  const isTemporary = comboIndex === -1;
  const combo = isTemporary
    ? state.turnState.temporaryCombinations[temporaryIndex]
    : state.tableCombinations[comboIndex];
  const comboOwner = state.players.find(player => player.id === combo.ownerId);
  if (!comboOwner) return state;

  // A player who has not opened may only extend their own provisional first pose.
  // Open players can extend another already-opened player's combination.
  if (comboOwner.status !== 'opened' && comboOwner.id !== currentPlayer.id) return state;
  if (currentPlayer.status === 'not_opened' && comboOwner.id !== currentPlayer.id) return state;
  if (!canAddToCombination(combo, card)) return state;

  // The card takes its logical place in the combination (a run on the table
  // has no length limit); a positioned Joker is never displaced by it.
  const inserted = card.isJoker && combo.type === 'tierce'
    ? getJokerAdditionChoices(state,cardId,combinationId).find(c=>c.side===jokerExtension && c.valid)?.combination
    : insertCardAtLogicalPosition(combo, card);
  if (!inserted) return state;
  const updatedCombo: Combination = {
    ...refreshJokerMetadata(inserted),
    completedById: combo.type === 'carre' && combo.cards.length === 3
      ? currentPlayer.id
      : combo.completedById,
  };
  if (!validateCombination(updatedCombo).valid) return state;

  const updatedCombinations = [...state.tableCombinations];
  const updatedTemporaryCombinations = [...state.turnState.temporaryCombinations];
  if (isTemporary) updatedTemporaryCombinations[temporaryIndex] = updatedCombo;
  else updatedCombinations[comboIndex] = updatedCombo;
  const action: TurnAction = {
    type: 'add_to_combination',
    playerId: currentPlayer.id,
    data: { cardId, combinationId },
    timestamp: Date.now(),
  };

  return {
    ...state,
    tableCombinations: updatedCombinations,
    players: state.players.map(p =>
      p.id === currentPlayer.id
        ? { ...p, hand: p.hand.filter(handCard => handCard.id !== cardId) }
        : p
    ),
    turnState: {
      ...state.turnState,
      temporaryCombinations: updatedTemporaryCombinations,
      actionsThisTurn: [...state.turnState.actionsThisTurn, action],
      reusedJokers: state.turnState.recoveredJokers.includes(cardId)
        ? [...new Set([...state.turnState.reusedJokers, cardId])]
        : state.turnState.reusedJokers,
    },
    actionHistory: [...state.actionHistory, action],
  };
}

// ---- RECOVER JOKER ----

/** Unopened players may adjust their own draft; opened players may recover from public melds. */
export function canPlayerRecoverJoker(state: GameState, playerId: string, combo: Combination): boolean {
  const player=state.players.find(p=>p.id===playerId);
  if (!player) return false;
  if (combo.ownerId===playerId) return true;
  const owner=state.players.find(p=>p.id===combo.ownerId);
  return player.status==='opened' && owner?.status==='opened' && state.tableCombinations.some(c=>c.id===combo.id);
}

function recoverJokerImpl(
  state: GameState,
  combinationId: string,
  replacementCardId: string | string[]
): GameState {
  if (
    state.phase !== 'playing' ||
    !state.turnState ||
    state.turnState.phase !== 'playing' ||
    state.turnState.playerId !== state.players[state.currentPlayerIndex]?.id
  ) return state;

  const currentPlayer = state.players[state.currentPlayerIndex];
  const replacementIds = Array.isArray(replacementCardId) ? replacementCardId : [replacementCardId];
  const replacements = replacementIds.map(id => currentPlayer.hand.find(c => c.id === id)).filter((c): c is GameCard => !!c);
  if (replacements.length !== replacementIds.length) return state;

  const comboIndex = state.tableCombinations.findIndex(combo => combo.id === combinationId);
  const temporaryIndex = state.turnState.temporaryCombinations.findIndex(combo => combo.id === combinationId);
  if (comboIndex === -1 && temporaryIndex === -1) return state;
  const isTemporary = comboIndex === -1;
  const combo = isTemporary
    ? state.turnState.temporaryCombinations[temporaryIndex]
    : state.tableCombinations[comboIndex];

  if (!canPlayerRecoverJoker(state,currentPlayer.id,combo) || !canRecoverJoker(combo, replacements)) return state;
  const jokerCard = combo.cards.find(c => c.isJoker);
  if (!jokerCard) return state;
  const recoveredPlacement = getStableJokerPlacement(combo) ?? (combo.jokerRepresents
    ? {
        jokerId: jokerCard.id,
        position: combo.cards.findIndex(card => card.isJoker),
        represents: combo.jokerRepresents,
      }
    : null);

  // The real card takes the Joker's exact slot, then the natural cards are put
  // back in their logical order. The Joker leaves the combination and returns
  // to the hand as a plain Joker, with no re-derived representation.
  const replaced: Combination = {
    ...combo,
    cards: combo.cards.flatMap(c => c.isJoker ? replacements : [c]),
    jokerRepresentation: undefined,
    completedById: replacements.length === 2 ? currentPlayer.id : combo.completedById,
    jokerPlacement: undefined,
    jokerPosition: undefined,
    jokerRepresents: undefined,
  };
  const updatedCombo = canonicalizeCombination(replaced);
  if (!validateCombination(updatedCombo).valid) return state;

  const updatedCombinations = [...state.tableCombinations];
  const updatedTemporaryCombinations = [...state.turnState.temporaryCombinations];
  if (isTemporary) updatedTemporaryCombinations[temporaryIndex] = updatedCombo;
  else updatedCombinations[comboIndex] = updatedCombo;
  const updatedHand = currentPlayer.hand
    .filter(c => !replacementIds.includes(c.id))
    .concat([jokerCard]);
  const action: TurnAction = {
    type: 'recover_joker',
    playerId: currentPlayer.id,
    data: {
      jokerId: jokerCard.id,
      replacementCardId,
      combinationId,
      jokerPosition: recoveredPlacement?.position,
      jokerRepresented: recoveredPlacement?.represents,
    },
    timestamp: Date.now(),
  };

  return {
    ...state,
    tableCombinations: updatedCombinations,
    players: state.players.map(p =>
      p.id === currentPlayer.id ? { ...p, hand: updatedHand } : p
    ),
    turnState: {
      ...state.turnState,
      temporaryCombinations: updatedTemporaryCombinations,
      recoveredJokers: [...new Set([...state.turnState.recoveredJokers, jokerCard.id])],
      actionsThisTurn: [...state.turnState.actionsThisTurn, action],
    },
    actionHistory: [...state.actionHistory, action],
  };
}

// ---- DISCARD ----

/** A returned carré remains proof of play, scoped to this turn and physical card. */
export function hasPlayedMandatoryChopCard(state: GameState): boolean {
  const turn = state.turnState;
  const cardId = turn?.mandatoryChopCardId;
  if (!turn || !cardId) return false;
  if ([...state.tableCombinations, ...turn.temporaryCombinations].some(combo =>
    validateCombination(combo).valid && combo.cards.some(card => card.id === cardId)
  )) return true;
  return turn.actionsThisTurn.some(action =>
    action.type === 'complete_carre' && action.playerId === turn.playerId &&
    Array.isArray(action.data.cardIds) && action.data.cardIds.includes(cardId)
  );
}

function discardImpl(state: GameState, cardId: string, faceDown: boolean = false): GameState {
  if (
    state.phase !== 'playing' ||
    !state.turnState ||
    state.turnState.phase !== 'playing'
  ) return state;

  const turn = state.turnState;
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (!currentPlayer || turn.playerId !== currentPlayer.id) return state;
  const card = currentPlayer.hand.find(handCard => handCard.id === cardId);
  if (!card) return state;

  const ownPlaced = getPlayerTurnCombinations(state, currentPlayer.id);
  const mustChopToOpen = !isTeamMode(state.config) && state.config.chopObligatoire &&
    currentPlayer.status === 'not_opened' &&
    turn.drawSource === 'deck' &&
    turn.chopWasAvailableAtTurnStart;
  let openingValidation: ReturnType<typeof validateFirstPose> | null = null;

  if (currentPlayer.status === 'not_opened') {
    const mustOpenAfterChop =
      state.config.chopSeulementOuverture && turn.drawSource === 'chop';
    if (ownPlaced.length > 0 || mustOpenAfterChop) {
      const handAfterDiscard = currentPlayer.hand.filter(handCard => handCard.id !== card.id);
      openingValidation = validateOpening(state, currentPlayer.id, ownPlaced, handAfterDiscard);
      // Refusal leaves the entire draft and state unchanged: no published
      // combination, lost card, penalty, threshold change or turn-end action.
      if (!openingValidation.valid) return state;
    }
    if (mustOpenAfterChop && !openingValidation?.valid) return state;
  }

  // CHOP obligatoire is an opening prerequisite, not a forced-draw rule. If
  // the player chose PIOCHER while a CHOP was available, discard any staged
  // first-pose draft and process this as a normal non-opening discard.
  if (mustChopToOpen && ownPlaced.length > 0 && openingValidation?.valid) {
    const rolledBack = rollbackOpeningDraft(state, currentPlayer.id);
    if (rolledBack !== state) return discard(rolledBack, cardId, faceDown);
    return state;
  }

  if (
    state.config.chopCarteObligatoireAJouer &&
    turn.drawSource === 'chop' &&
    turn.mandatoryChopCardId
  ) {
    if (!hasPlayedMandatoryChopCard(state)) return state;
  }

  // A Joker recovered this turn must be reused in a valid combination or be the
  // card discarded now. Refuse the turn-ending action instead of adding a
  // retrospective penalty.
  for (const jokerId of turn.recoveredJokers) {
    const stillInHand = currentPlayer.hand.some(handCard => handCard.id === jokerId);
    const usedOnTable = [...state.tableCombinations, ...turn.temporaryCombinations].some(combo =>
      validateCombination(combo).valid && combo.cards.some(tableCard => tableCard.id === jokerId)
    );
    if (stillInHand && card.id !== jokerId && !usedOnTable) return state;
  }

  const validationResult = validateTurnEnd(state, currentPlayer, card);
  const isOpening = validationResult.isOpening;
  const openingValue = validationResult.vierge;
  const openingTotal = validationResult.total;
  // SUITE keeps evolving after EVERY successful opening:
  //   SUITE = valeur totale de la dernière ouverture réussie + 1.
  // Before the first opening it simply equals the initial threshold.
  const changesSuite=isOpening&&!openingRequirements(state,currentPlayer.id).waived;
  const updatedSuite = changesSuite ? openingTotal + 1 : state.suite;

  const updatedPlayers = state.players.map(player =>
    player.id === currentPlayer.id
      ? {
          ...player,
          hand: player.hand.filter(handCard => handCard.id !== cardId),
          status: isOpening ? 'opened' as const : player.status,
          openingValue: isOpening ? openingValue : player.openingValue,
          openingTotal: isOpening ? openingTotal : player.openingTotal,
          openingSuiteThreshold: isOpening ? openingRequirements(state,currentPlayer.id).total : player.openingSuiteThreshold,
          openingThreshold: isOpening ? validationResult.requiredThreshold : player.openingThreshold,
          usedInitialThreshold: isOpening && ownPlaced.some(combo => getJokerCount(combo.cards) > 0)
            ? true
            : player.usedInitialThreshold,
        }
      : player
  );

  const playerAfterDiscard = updatedPlayers.find(player => player.id === currentPlayer.id)!;
  const hasWon = playerAfterDiscard.hand.length === 0;
  const endType: RoundEndType | null = hasWon
    ? (card.isJoker && !faceDown ? 'RJ' : 'RS')
    : null;

  const wasDiscardPlayable = !hasWon && (currentPlayer.status === 'opened' || isOpening) && !card.isJoker &&
    isDiscardPlayable(state,currentPlayer.id,card,[...state.tableCombinations, ...turn.temporaryCombinations]);
  const naturalTierceInOpening = ownPlaced.some(combo =>
    combo.type === 'tierce' && getJokerCount(combo.cards) === 0 && validateCombination(combo).valid
  );
  const combinationsAtEnd = isOpening
    ? [...state.tableCombinations, ...turn.temporaryCombinations]
    : state.tableCombinations;
  const unrecoveredCarreResponsibleIds = combinationsAtEnd
    .filter(combo => combo.type === 'carre' && combo.cards.length === 4 && getJokerCount(combo.cards) > 0)
    .map(combo => state.config.carreResponsable === 'detenteur'
      ? combo.ownerId
      : (combo.completedById ?? combo.ownerId));
  const completedActionSnapshot: CompletedTurnActionSnapshot = Object.freeze({
    endType: endType ?? undefined,
    id: `r${state.roundNumber}-a${state.actionHistory.length}-p${currentPlayer.id}`,
    roundNumber: state.roundNumber,
    playerId: currentPlayer.id,
    discardedCardId: card.id,
    discardedCard: Object.freeze({ ...card }) as GameCard,
    wasOpenedBeforeDiscard: currentPlayer.status === 'opened' || isOpening,
    handBeforeDiscard: frozenSnapshot(currentPlayer.hand),
    tableBeforeDiscard: frozenSnapshot(combinationsAtEnd),
    turnActions: frozenSnapshot(turn.actionsThisTurn),
    wasDiscardPlayable,
    openingValue: isOpening ? openingValue : currentPlayer.openingValue,
    openingTotal: isOpening ? openingTotal : currentPlayer.openingTotal,
    openingSuiteThreshold: isOpening ? openingRequirements(state,currentPlayer.id).total : currentPlayer.openingSuiteThreshold,
    openingThreshold: isOpening ? validationResult.requiredThreshold : currentPlayer.openingThreshold,
    openingHadNaturalTierce: naturalTierceInOpening,
    invalidCombinationIds: Object.freeze(
      ownPlaced.filter(combo => !validateCombination(combo).valid).map(combo => combo.id)
    ),
    unrecoveredCarreResponsibleIds: Object.freeze([...new Set(unrecoveredCarreResponsibleIds)]),
  });

  const action: TurnAction = {
    type: 'discard',
    playerId: currentPlayer.id,
    data: { cardId, faceDown: endType === 'RS' },
    timestamp: Date.now(),
  };
  const newState: GameState = {
    ...state,
    players: updatedPlayers,
    tableCombinations: combinationsAtEnd,
    faults: state.faults,
    lastOpeningTotal: changesSuite ? openingTotal : state.lastOpeningTotal,
    suite: updatedSuite,
    suiteLocked: state.suiteLocked || isOpening,
    lastOpeningPlayerIndex: changesSuite ? state.currentPlayerIndex : state.lastOpeningPlayerIndex,
    cycleCount: isOpening ? 0 : state.cycleCount,
    discardPile: [...state.discardPile, card],
    discardHistory: [...getDiscardAuditHistory(state), card],
    lastDiscardFaceDown: endType === 'RS',
    actionHistory: [...state.actionHistory, action],
    lastCompletedTurnAction: completedActionSnapshot,
    lastCompletedTurnActionsByPlayer: {
      ...state.lastCompletedTurnActionsByPlayer,
      [currentPlayer.id]: completedActionSnapshot,
    },
  };

  if (hasWon && endType) {
    const roundResult = calculateRoundScores(newState, currentPlayer.id, endType);
    const finalPlayers = updatedPlayers.map(player => {
      const roundScore = roundResult.scores[player.id] || 0;
      return {
        ...player,
        score: player.score + roundScore,
        roundScores: [...player.roundScores, roundScore],
      };
    });

    return {
      ...newState,
      phase: 'round_end',
      players: finalPlayers,
      roundResults: [...state.roundResults, roundResult],
      turnState: null,
    };
  }

  const nextIndex = getNextSeatIndex(state, state.currentPlayerIndex);
  return {
    ...newState,
    currentPlayerIndex: nextIndex,
    turnState: createTurnState(updatedPlayers[nextIndex].id),
  };
}

// ---- Turn End Validation ----

function validateTurnEnd(
  state: GameState,
  player: Player,
  discardCard: GameCard
): { isOpening: boolean; vierge: number; total: number; requiredThreshold: number } {
  if (player.status !== 'not_opened') return { isOpening: false, vierge: 0, total: 0, requiredThreshold: 0 };
  const playerCombinations = getPlayerTurnCombinations(state, player.id);
  if (playerCombinations.length === 0) return { isOpening: false, vierge: 0, total: 0, requiredThreshold: 0 };

  const handAfterDiscard = player.hand.filter(handCard => handCard.id !== discardCard.id);
  const validation = validateOpening(state, player.id, playerCombinations, handAfterDiscard);
  return validation.valid
    ? { isOpening: true, vierge: validation.vierge, total: validation.total, requiredThreshold: validation.requiredThreshold }
    : { isOpening: false, vierge: 0, total: 0, requiredThreshold: validation.requiredThreshold };
}

// ---- Round Score Calculation ----

// ---- FAULT REPORTING (a player accuses another of a rule violation) ----

export interface FaultOption {
  type: FaultType;
  label: string;
}

// The faults a player can report against someone by clicking their name.
export const REPORTABLE_FAULTS: FaultOption[] = [
  { type: 'opened_without_tierce', label: 'Ouverture sans tierce' },
  { type: 'below_suite', label: 'TOTAL d’ouverture sous la SUITE' },
  { type: 'insufficient_vierge', label: 'Points naturels sous la VIERGE' },
  { type: 'playable_discard', label: 'A défaussé une carte jouable' },
  { type: 'invalid_combination', label: 'Combinaison invalide sur la table' },
  { type: 'carre_not_recovered', label: 'Carré non récupéré' },
];

// Checks whether the accused player has actually committed the claimed fault,
// based on the current game state.
function isFaultTrue(
  state: GameState,
  snapshot: CompletedTurnActionSnapshot | null,
  accusedId: string,
  type: FaultType,
): boolean {
  const accused = state.players.find(player => player.id === accusedId);
  if (!accused) return false;
  const snapshotIsForAccused = snapshot?.playerId === accusedId;

  switch (type) {
    case 'opened_without_tierce': {
      return Boolean(
        state.config.tierceObligatoire && snapshotIsForAccused &&
        !(isTeamMode(state.config) && snapshot!.openingThreshold === 0) &&
        !snapshot!.wasOpenedBeforeDiscard && snapshot!.openingValue != null &&
        !snapshot!.openingHadNaturalTierce
      );
    }
    case 'below_suite': {
      return Boolean(snapshotIsForAccused && snapshot!.openingTotal != null && snapshot!.openingSuiteThreshold != null && snapshot!.openingTotal < snapshot!.openingSuiteThreshold);
    }
    case 'insufficient_vierge': {
      return Boolean(
        snapshotIsForAccused && snapshot!.openingValue != null &&
        snapshot!.openingThreshold != null &&
        snapshot!.openingValue < snapshot!.openingThreshold
      );
    }
    case 'invalid_combination': {
      return Boolean(snapshotIsForAccused && snapshot!.invalidCombinationIds.length > 0);
    }
    case 'carre_not_recovered': {
      return Boolean(snapshotIsForAccused && snapshot!.unrecoveredCarreResponsibleIds.includes(accusedId));
    }
    case 'playable_discard': {
      // Use the completed-turn snapshot, never the current discard-pile top or
      // table after the accuser has already taken another action.
      return Boolean(
        snapshotIsForAccused && snapshot!.wasOpenedBeforeDiscard && snapshot!.wasDiscardPlayable
      );
    }
    default:
      return false;
  }
}

export interface FaultReportResult {
  state: GameState;
  valid: boolean;
  message: string;
}

/**
 * A player (accuserId) reports a fault against ANY other player (accusedId).
 *
 * Reporting is never restricted to the previous player, to the current player
 * or to the player whose turn just ended, and it is never blocked by the turn
 * phase (before drawing, after drawing, while preparing an opening, during
 * somebody else's turn).
 *
 * A wrong report is NOT a fault: it gives no penalty, no malus and no score
 * change to whoever reported. Only a confirmed fault ends the round.
 */
function reportFaultImpl(
  state: GameState,
  accuserId: string,
  accusedId: string,
  type: FaultType
): FaultReportResult {
  if (state.phase !== 'playing') {
    return { state, valid: false, message: 'Impossible de signaler maintenant' };
  }
  const accused = state.players.find(player => player.id === accusedId);
  const accuser = state.players.find(player => player.id === accuserId);
  if (!accused || !accuser) return { state, valid: false, message: 'Joueur introuvable' };
  if (accuserId === accusedId) {
    return { state, valid: false, message: 'Vous ne pouvez pas vous signaler vous-même' };
  }

  const label = REPORTABLE_FAULTS.find(fault => fault.type === type)?.label ?? 'Faute';
  const snapshot = state.lastCompletedTurnActionsByPlayer[accusedId];
  if (!snapshot) {
    return {
      state,
      valid: false,
      message: `${accused.name} n'a encore terminé aucun tour : rien à signaler.`,
    };
  }
  const alreadyReported = state.reports.some(report =>
    report.accuserId === accuserId &&
    report.accusedId === accusedId &&
    report.snapshotId === snapshot.id
  );
  if (alreadyReported) {
    return {
      state,
      valid: false,
      message: `Vous avez déjà signalé ce tour de ${accused.name}.`,
    };
  }

  const record: ReportRecord = {
    accuserId,
    accusedId,
    snapshotId: snapshot.id,
    faultType: type,
    confirmed: false,
  };
  const action: TurnAction = {
    type: 'report_fault',
    playerId: accuserId,
    data: { accusedId, faultType: type, evidenceActionId: snapshot.id },
    timestamp: Date.now(),
  };

  if (isFaultTrue(state, snapshot, accusedId, type)) {
    // Correct accusation: penalise the accused and end the round.
    const fault = createFault(accusedId, type, state.config);
    const restored = state.turnState ? rollbackOpeningDraft(state, state.turnState.playerId) : state;
    const stateWithFault: GameState = {
      ...restored,
      faults: [...state.faults, fault],
      reports: [...state.reports, { ...record, confirmed: true }],
      actionHistory: [...state.actionHistory, action],
    };
    const roundResult = calculateRoundScores(stateWithFault, accuserId, 'RS');
    const finalPlayers = stateWithFault.players.map(p => {
      const roundScore = roundResult.scores[p.id] || 0;
      return { ...p, score: p.score + roundScore, roundScores: [...p.roundScores, roundScore] };
    });
    return {
      state: {
        ...stateWithFault,
        phase: 'round_end',
        players: finalPlayers,
        roundResults: [...state.roundResults, roundResult],
        turnState: null,
      },
      valid: true,
      message: `Faute confirmée : ${accused.name} — ${label} (+${fault.penalty}). Manche terminée.`,
    };
  }

  // Not a fault. The report is simply recorded: NO penalty for the accuser.
  return {
    state: {
      ...state,
      reports: [...state.reports, record],
      actionHistory: [...state.actionHistory, action],
    },
    valid: false,
    message: `Contrôle effectué : ${accused.name} n'a pas commis « ${label} ». Aucune pénalité.`,
  };
}

/**
 * Score a finished round.
 *
 * `winnerId === null` means nobody went out but the round still counts (the
 * available draw cycles are exhausted): every player is then scored on the
 * cards left in their hand — it is never a 0-0 draw.
 */
export function calculateRoundScores(
  state: GameState,
  winnerId: string | null,
  endType: RoundEndType
): RoundResult {
  if(isTeamMode(state.config))return calculateTeamScores(state,winnerId,endType);
  const scores: Record<string, number> = {};
  const scoreBreakdown: Record<string, { label: string; points: number }[]> = {};
  const faults: Fault[] = [...state.faults];

  for (const player of state.players) {
    const items: { label: string; points: number }[] = [];
    if (player.id !== winnerId) {
      if (player.status === 'not_opened') {
        const points = endType === 'RJ'
          ? state.config.rjNonOpenedPenalty
          : state.config.rsNonOpenedPenalty;
        items.push({ label: `Non ouvert (${endType})`, points });
      } else {
        const cardsLeft = player.hand.length;
        const perCard = endType === 'RJ'
          ? state.config.rjScorePerCard
          : state.config.rsScorePerCard;
        if (cardsLeft > 0) {
          items.push({
            label: `${cardsLeft} carte${cardsLeft === 1 ? '' : 's'} restante${cardsLeft === 1 ? '' : 's'} × ${perCard}`,
            points: cardsLeft * perCard,
          });
        }
      }
    }

    // Fault/malus lines are additive and remain visible even for the winner.
    for (const fault of faults.filter(item => item.playerId === player.id)) {
      if (fault.penalty !== 0) items.push({ label: fault.description, points: fault.penalty });
    }
    scoreBreakdown[player.id] = items;
    scores[player.id] = items.reduce((sum, item) => sum + item.points, 0);
  }

  return { winnerId, endType, scores, scoreBreakdown, faults };
}

// ---- Empty Deck Handling ----

/** A genuine draw: nobody opened, so everybody stays at 0. */
function buildNullRound(state: GameState): RoundResult {
  if(isTeamMode(state.config))return calculateTeamScores(state,null,'null_round');
  return {
    endType: 'null_round',
    scores: Object.fromEntries(state.players.map(player => [player.id, 0])),
    scoreBreakdown: Object.fromEntries(state.players.map(player => [player.id, []])),
    faults: [],
  };
}

/**
 * The available draw cycles are exhausted. This is NOT a draw as soon as at
 * least one player opened: the remaining cards are counted for everybody
 * (opened: cards × rsScorePerCard; not opened: rsNonOpenedPenalty) and the
 * configured malus are added on top.
 */
function endRoundByExhaustedCycles(state: GameState): GameState {
  if (!state.players.some(player => player.status === 'opened')) {
    return {
      ...state,
      phase: 'round_end',
      roundResults: [...state.roundResults, buildNullRound(state)],
      turnState: null,
    };
  }

  const roundResult = calculateRoundScores(state, null, 'cycles');
  const finalPlayers = state.players.map(player => {
    const roundScore = roundResult.scores[player.id] || 0;
    return {
      ...player,
      score: player.score + roundScore,
      roundScores: [...player.roundScores, roundScore],
    };
  });
  return {
    ...state,
    phase: 'round_end',
    players: finalPlayers,
    roundResults: [...state.roundResults, roundResult],
    turnState: null,
  };
}

function handleEmptyDeck(state: GameState): GameState {
  const newCycleCount = state.cycleCount + 1;

  // Check 3 cycle rule
  if (newCycleCount >= state.config.maxCycles) {
    return endRoundByExhaustedCycles(state);
  }

  // Refill the deck. Completed carrés stayed on the table during the whole base;
  // now that the deck is empty, remove every complete carré (4 cards) from the
  // table and shuffle those cards into the new deck together with the discard pile.
  // Only a TRUE carré (four natural cards, no Joker) goes back into the base.
  // A carré completed with a Joker stays on the table so the Joker can still
  // be recovered by its owner.
  const completedCarres = state.tableCombinations.filter(isTrueCarre);
  const carreCards = completedCarres.flatMap(c => c.cards);
  const remainingCombinations = state.tableCombinations.filter(
    c => !isTrueCarre(c)
  );

  // Everything that left the round — the discard pile, the carrés already put
  // into the base and the carrés just removed — forms the new draw pile.
  const newDeck = shuffleDeck([...state.discardPile, ...state.basePile, ...carreCards]);
  if (newDeck.length === 0) {
    return endRoundByExhaustedCycles(state);
  }

  return {
    ...state,
    deck: newDeck,
    discardPile: [],
    basePile: [],
    tableCombinations: remainingCombinations,
    cycleCount: newCycleCount,
    // Openings only protect the cycle in which they occurred; the next
    // reshuffle starts a fresh window for the max-cycle rule.
    lastOpeningPlayerIndex: null,
  };
}

// ---- Completed Carré: return it to the base ----

/** Player responsible for a carré, following the detenteur/completeur setting. */
export function getCarreResponsibleId(combo: Combination, config: GameConfig): string {
  return config.carreResponsable === 'detenteur'
    ? combo.ownerId
    : (combo.completedById ?? combo.ownerId);
}

/**
 * A TRUE carré (four natural cards, no Joker) may be returned to the base.
 * A brelan — including a brelan completed by a Joker — never qualifies.
 */
export function canReturnCarreToBase(state: GameState, combinationId: string): boolean {
  if (state.phase !== 'playing') return false;
  const turn = state.turnState;
  if (!turn || turn.phase !== 'playing') return false;
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (!currentPlayer || turn.playerId !== currentPlayer.id) return false;

  const combo = state.tableCombinations.find(item => item.id === combinationId);
  if (!combo) return false;
  if (!isTrueCarre(combo)) return false;
  return getCarreResponsibleId(combo, state.config) === currentPlayer.id;
}

/** Remove the carré from the table and place its four cards into the base. */
function returnCarreToBaseImpl(state: GameState, combinationId: string): GameState {
  if (!canReturnCarreToBase(state, combinationId)) return state;

  const combo = state.tableCombinations.find(item => item.id === combinationId)!;
  const action: TurnAction = {
    type: 'complete_carre',
    playerId: state.players[state.currentPlayerIndex].id,
    data: { combinationId, cardIds: combo.cards.map(card => card.id) },
    timestamp: Date.now(),
  };

  return {
    ...state,
    tableCombinations: state.tableCombinations.filter(item => item.id !== combinationId),
    basePile: [...state.basePile, ...combo.cards],

    turnState: {
      ...state.turnState!,
      actionsThisTurn: [...state.turnState!.actionsThisTurn, action],
    },
    actionHistory: [...state.actionHistory, action],
  };
}

// ---- Get Available Actions ----

export interface AvailableActions {
  canDraw: boolean;
  canChop: boolean;
  canCancelChop: boolean;
  canDiscard: boolean;
  canPlaceCombination: boolean;
  canAddToExisting: boolean;
  canRecoverJoker: boolean;
  canReportFault: boolean;
  /** Every other player can be reported, at any moment of the round. */
  reportablePlayerIds: string[];
  /** First opponent whose last completed turn has not been judged yet. */
  reportablePlayerId?: string;
  chopCard?: GameCard;
  /** True carrés the current player is allowed to return to the base. */
  returnableCarreIds: string[];
  possibleCombinations: { cardIds: string[]; type: 'tierce' | 'carre' }[];
  possibleAdditions: { cardId: string; combinationId: string; jokerExtension?: JokerExtensionSide }[];
  possibleJokerRecoveries: { combinationId: string; replacementCardId: string; replacementCardIds: string[] }[];
}

/**
 * @param perspectivePlayerId the player the report list is built for. The
 * interface passes the local player so reporting stays available even while
 * somebody else is playing.
 */
export function getAvailableActions(state: GameState, perspectivePlayerId?: string): AvailableActions {
  const result: AvailableActions = {
    canDraw: false,
    canChop: false,
    canCancelChop: false,
    canDiscard: false,
    canPlaceCombination: false,
    canAddToExisting: false,
    canRecoverJoker: false,
    canReportFault: false,
    reportablePlayerIds: [],
    returnableCarreIds: [],
    possibleCombinations: [],
    possibleAdditions: [],
    possibleJokerRecoveries: [],
  };

  if (!state.turnState || state.phase !== 'playing') return result;

  const currentPlayer = state.players[state.currentPlayerIndex];
  const ts = state.turnState;
  const viewerId = perspectivePlayerId ?? currentPlayer?.id;

  // Reporting any other player is always available: it never depends on whose
  // turn it is, on the draw phase, or on the previous player only.
  result.reportablePlayerIds = state.players
    .filter(player => player.id !== viewerId)
    .map(player => player.id);
  for (const opponentId of result.reportablePlayerIds) {
    const opponentSnapshot = state.lastCompletedTurnActionsByPlayer[opponentId];
    if (!opponentSnapshot) continue;
    const alreadyJudged = state.reports.some(report =>
      report.accuserId === viewerId &&
      report.accusedId === opponentId &&
      report.snapshotId === opponentSnapshot.id
    );
    if (alreadyJudged) continue;
    result.canReportFault = true;
    result.reportablePlayerId = opponentId;
    break;
  }

  if (ts.phase === 'must_draw') {
    // drawCard itself handles deck recycling/null-round termination, so the
    // action remains available when the current deck has reached zero.
    result.canDraw = true;
    result.canChop = canChop(state);
    if (result.canChop) {
      result.chopCard = state.discardPile[state.discardPile.length - 1];
    }
    return result;
  }

  if (ts.phase === 'playing') {
    result.canDiscard = currentPlayer.hand.length > 0;
    result.canPlaceCombination = currentPlayer.hand.length > 1;
    result.canAddToExisting = currentPlayer.hand.length > 1;
    result.canRecoverJoker = true;
    const reversibleDraftActions = new Set<TurnAction['type']>([
      'place_combination', 'add_to_combination', 'recover_joker', 'reuse_joker',
    ]);
    const canUndoOpeningDraft = currentPlayer.status === 'not_opened';
    const onlyUndoableActions = ts.actionsThisTurn.every(action =>
      action.type === 'chop' || (canUndoOpeningDraft && reversibleDraftActions.has(action.type))
    );
    const choppedCardStillInTurn = Boolean(ts.drawnCard && (
      currentPlayer.hand.some(card => card.id === ts.drawnCard!.id) ||
      ts.temporaryCombinations.some(combo => combo.cards.some(card => card.id === ts.drawnCard!.id))
    ));
    result.canCancelChop = Boolean(ts.drawSource === 'chop' && ts.drawnCard && onlyUndoableActions && choppedCardStillInTurn);

    // A TRUE carré (never a brelan, never a carré holding a Joker) may be
    // returned to the base by the player responsible for it.
    result.returnableCarreIds = state.tableCombinations
      .filter(combo => canReturnCarreToBase(state, combo.id))
      .map(combo => combo.id);

    const currentTurnCombinations = [...state.tableCombinations, ...ts.temporaryCombinations];
    for (const combo of currentTurnCombinations) {
      const comboOwner = state.players.find(player => player.id === combo.ownerId);
      if (!comboOwner) continue;
      const ownProvisional = comboOwner.id === currentPlayer.id && currentPlayer.status === 'not_opened';
      if (comboOwner.status !== 'opened' && !ownProvisional) continue;
      if (currentPlayer.status === 'not_opened' && !ownProvisional) continue;

      if (currentPlayer.hand.length > 1) {
        for (const card of currentPlayer.hand) {
          if (canAddToCombination(combo, card)) {
            if (card.isJoker && combo.type === 'tierce') {
              for (const choice of getJokerAdditionChoices(state,card.id,combo.id).filter(c=>c.valid))
                result.possibleAdditions.push({cardId:card.id,combinationId:combo.id,jokerExtension:choice.side});
            } else result.possibleAdditions.push({ cardId: card.id, combinationId: combo.id });
          }
        }
      }

      // Both missing suits must belong to the same authorized player.
      const metadata = getJokerRepresentation(combo);
      if (canPlayerRecoverJoker(state,currentPlayer.id,combo) && metadata) {
        const replacements = metadata.candidates.map(candidate => currentPlayer.hand.find(card =>
          !card.isJoker && card.rank === candidate.rank && card.suit === candidate.suit))
          .filter((card): card is GameCard => !!card);
        if (canRecoverJoker(combo, replacements)) result.possibleJokerRecoveries.push({
          combinationId: combo.id, replacementCardId: replacements[0].id,
          replacementCardIds: replacements.map(card => card.id),
        });
      }
    }

    return result;
  }

  return result;
}

// ---- Check Chop Obligatoire ----

export function isChopRequired(_state: GameState): boolean {
  // Legacy helper retained for callers. CHOP obligatoire is an opening
  // prerequisite, never a forced replacement for the normal PIOCHER action.
  return false;
}

/** Optional test/debug observer; never mutates the state. */
let transitionAuditor: ((state: GameState, action: string) => void) | undefined;
export function setTransitionAuditor(auditor?: typeof transitionAuditor): void { transitionAuditor = auditor; }
function observed<A extends unknown[]>(name: string, action: (...args: A) => GameState) {
  return (...args: A): GameState => {
    const result = finalizeScoreLimit(settleTeamScores(action(...args)));
    transitionAuditor?.(result, name);
    return result;
  };
}
export const startNewRound = observed('startNewRound', startNewRoundImpl);
export const drawCard = observed('drawCard', drawCardImpl);
export const chopCard = observed('chopCard', chopCardImpl);
export const rejectChop = observed('rejectChop', rejectChopImpl);
export const placeCombination = observed('placeCombination', placeCombinationImpl);
export const confirmOpening = observed('confirmOpening', confirmOpeningImpl);
export const takeBackCombinations = observed('takeBackCombinations', takeBackCombinationsImpl);
export const addToCombination = observed('addToCombination', addToCombinationImpl);
export const recoverJoker = observed('recoverJoker', recoverJokerImpl);
export const discard = observed('discard', discardImpl);
export const returnCarreToBase = observed('returnCarreToBase', returnCarreToBaseImpl);

/** Same permissions and current-state validation for UI previews and execution. */
export function getJokerAdditionChoices(state: GameState, cardId: string, combinationId: string) {
  const player=state.players[state.currentPlayerIndex];
  const card=player?.hand.find(c=>c.id===cardId);
  const combo=[...state.tableCombinations,...(state.turnState?.temporaryCombinations??[])].find(c=>c.id===combinationId);
  if (!card || !combo) return [];
  const owner=state.players.find(p=>p.id===combo.ownerId);
  const allowed=state.phase==='playing' && state.turnState?.phase==='playing' && state.turnState.playerId===player.id && player.hand.length>1 &&
    !!owner && (owner.status==='opened'||owner.id===player.id) && (player.status==='opened'||owner.id===player.id);
  return getJokerExtensionChoices(combo,card).map(c=>allowed?c:{...c,valid:false,combination:undefined,error:'Action non autorisée pendant ce tour.'});
}

/** Score limits are evaluated only after a complete round score calculation. */
export function finalizeScoreLimit(state: GameState): GameState {
  const target=state.config.targetScore;
  return state.phase==='round_end' && typeof target==='number' && target>0 &&
    state.players.some(p=>p.score>=Math.min(3000,target)) ? {...state,phase:'game_end'} : state;
}
export function reportFault(...args: Parameters<typeof reportFaultImpl>): ReturnType<typeof reportFaultImpl> {
  const result=reportFaultImpl(...args);
  return {...result,state:finalizeScoreLimit(settleTeamScores(result.state))};
}
