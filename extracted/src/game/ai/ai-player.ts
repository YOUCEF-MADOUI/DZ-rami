// =====================================================
// AI PLAYER - Decision Engine for Computer Players
// =====================================================
import {
  GameState, GameCard, Player, Combination, Card,
  Rank, Suit, RANK_ORDER, SUITS, RANKS,
  getCardValue, INITIAL_THRESHOLDS,
} from '../core/types';
import {
  validateCombination, calculateCombinationValue,
  canAddToCombination, canRecoverJoker,
  getJokerCount, getNonJokerCards,
  getNextPlayerIndex, getPreviousPlayerIndex,
  isCardPlayableOnTable, determineJokerRepresentation,
} from '../core/validation';
import {
  drawCard, chopCard, placeCombination,
  addToCombination, recoverJoker, discard,
  getAvailableActions, canChop, rejectChop,
} from '../core/engine';

export interface AIDecision {
  action: 'draw' | 'chop' | 'place' | 'add' | 'recover_joker' | 'discard';
  cardId?: string;
  cardIds?: string[];
  combinationId?: string;
  combinationType?: 'tierce' | 'carre';
  faceDown?: boolean;
}

export function makeAIDecision(state: GameState): AIDecision[] {
  const currentPlayer = state.players[state.currentPlayerIndex];
  const decisions: AIDecision[] = [];

  if (!state.turnState) return decisions;

  const phase = state.turnState.phase;

  if (phase === 'must_draw') {
    // Decide whether to draw or chop
    const chopDecision = shouldChop(state, currentPlayer);
    if (chopDecision) {
      decisions.push({ action: 'chop' });
    } else {
      decisions.push({ action: 'draw' });
    }
    return decisions;
  }

  if (phase === 'playing') {
    // Try to play cards
    const playDecisions = planPlay(state, currentPlayer);
    decisions.push(...playDecisions);

    // Always end with discard
    const discardDecision = chooseDiscard(state, currentPlayer);
    decisions.push(discardDecision);
    return decisions;
  }

  return decisions;
}

function shouldChop(state: GameState, player: Player): boolean {
  if (!canChop(state)) return false;

  const chopCardValue = state.discardPile[state.discardPile.length - 1];
  if (!chopCardValue) return false;

  // CHOP-for-opening rule: a non-opened player may only chop if the chopped card
  // actually lets them open this very turn — otherwise chopping would leave them
  // unable to discard and the turn would be blocked.
  if (state.config.chopSeulementOuverture && player.status === 'not_opened') {
    const testHand = [...player.hand, chopCardValue];
    return findBestCombinations(testHand, state).canOpen;
  }

  // If the card helps with combinations, chop it
  const helpfulness = evaluateCardForHand(chopCardValue, player.hand, state);

  // Consider the malus risk
  const malusRisk = player.status === 'not_opened'
    ? state.config.malusChopOuverture
    : state.config.malusChopJoueurOuvert;

  // If card is very useful (completes a combination), chop
  if (helpfulness > 50) return true;

  // If card is somewhat useful and malus is low, chop
  if (helpfulness > 20 && malusRisk <= 10) return true;

  // If player can open with this card, definitely chop
  if (player.status === 'not_opened') {
    const testHand = [...player.hand, chopCardValue];
    const combos = findBestCombinations(testHand, state);
    if (combos.canOpen) return true;
  }

  return false;
}

function evaluateCardForHand(card: GameCard, hand: GameCard[], state: GameState): number {
  if (card.isJoker) return 80; // Jokers are very valuable

  let score = 0;
  const c = card as Card;

  // Check if it completes a pair to brelan
  const sameRank = hand.filter(h => !h.isJoker && (h as Card).rank === c.rank);
  if (sameRank.length >= 2) score += 60;
  else if (sameRank.length >= 1) score += 30;

  // Check if it extends a sequence
  const sameSuit = hand.filter(h => !h.isJoker && (h as Card).suit === c.suit);
  const positions = sameSuit.map(h => RANK_ORDER[(h as Card).rank]);
  const cardPos = RANK_ORDER[c.rank];

  for (const pos of positions) {
    if (Math.abs(pos - cardPos) === 1) score += 25;
    if (Math.abs(pos - cardPos) === 2) score += 10;
  }

  return score;
}

interface CombinationPlan {
  combos: { cards: GameCard[]; type: 'tierce' | 'carre' }[];
  canOpen: boolean;
  vierge: number;
  total: number;
}

function findBestCombinations(hand: GameCard[], state: GameState): CombinationPlan {
  const nonJokers = getNonJokerCards(hand);
  const jokers = hand.filter(c => c.isJoker);
  const combos: { cards: GameCard[]; type: 'tierce' | 'carre' }[] = [];
  const usedCardIds = new Set<string>();

  // Find carres/brelans first
  const byRank = new Map<Rank, Card[]>();
  for (const c of nonJokers) {
    const existing = byRank.get(c.rank) || [];
    existing.push(c);
    byRank.set(c.rank, existing);
  }

  for (const [rank, cards] of byRank) {
    // Only unique suits
    const uniqueSuits = new Map<Suit, Card>();
    for (const c of cards) {
      if (!uniqueSuits.has(c.suit) && !usedCardIds.has(c.id)) {
        uniqueSuits.set(c.suit, c);
      }
    }
    
    const uniqueCards = Array.from(uniqueSuits.values());
    if (uniqueCards.length >= 3) {
      const comboCards = uniqueCards.slice(0, 4);
      combos.push({ cards: comboCards, type: 'carre' });
      comboCards.forEach(c => usedCardIds.add(c.id));
    }
  }

  // Find tierces
  const bySuit = new Map<Suit, Card[]>();
  for (const c of nonJokers) {
    if (usedCardIds.has(c.id)) continue;
    const existing = bySuit.get(c.suit) || [];
    existing.push(c);
    bySuit.set(c.suit, existing);
  }

  for (const [suit, cards] of bySuit) {
    const sorted = [...cards].sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
    
    // Find consecutive sequences
    let sequence: Card[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prevPos = RANK_ORDER[sorted[i - 1].rank];
      const currPos = RANK_ORDER[sorted[i].rank];
      
      if (currPos === prevPos + 1) {
        sequence.push(sorted[i]);
      } else {
        if (sequence.length >= 3) {
          const comboCards = sequence.slice(0, 5);
          combos.push({ cards: comboCards, type: 'tierce' });
          comboCards.forEach(c => usedCardIds.add(c.id));
        }
        sequence = [sorted[i]];
      }
    }
    
    if (sequence.length >= 3) {
      const comboCards = sequence.slice(0, 5);
      combos.push({ cards: comboCards, type: 'tierce' });
      comboCards.forEach(c => usedCardIds.add(c.id));
    }

    // Try Ace-high sequences (Q-K-A)
    const aceCards = cards.filter(c => c.rank === 'A' && !usedCardIds.has(c.id));
    const kCards = cards.filter(c => c.rank === 'K' && !usedCardIds.has(c.id));
    const qCards = cards.filter(c => c.rank === 'Q' && !usedCardIds.has(c.id));
    
    if (aceCards.length > 0 && kCards.length > 0 && qCards.length > 0) {
      const comboCards = [qCards[0], kCards[0], aceCards[0]];
      combos.push({ cards: comboCards, type: 'tierce' });
      comboCards.forEach(c => usedCardIds.add(c.id));
    }
  }

  // Try adding jokers to near-complete combinations
  let jokerIdx = 0;
  if (jokers.length > 0) {
    // Find pairs that could become brelans with a joker
    for (const [rank, cards] of byRank) {
      if (jokerIdx >= jokers.length) break;
      const unusedCards = cards.filter(c => !usedCardIds.has(c.id));
      const uniqueSuits = new Map<Suit, Card>();
      for (const c of unusedCards) {
        if (!uniqueSuits.has(c.suit)) uniqueSuits.set(c.suit, c);
      }
      const unique = Array.from(uniqueSuits.values());
      if (unique.length === 2) {
        combos.push({ cards: [...unique, jokers[jokerIdx]], type: 'carre' });
        unique.forEach(c => usedCardIds.add(c.id));
        jokerIdx++;
      }
    }

    // Find 2-card sequences that could become tierces with a joker
    for (const [suit, cards] of bySuit) {
      if (jokerIdx >= jokers.length) break;
      const unused = cards.filter(c => !usedCardIds.has(c.id));
      const sorted = [...unused].sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
      
      for (let i = 0; i < sorted.length - 1; i++) {
        if (jokerIdx >= jokers.length) break;
        const pos1 = RANK_ORDER[sorted[i].rank];
        const pos2 = RANK_ORDER[sorted[i + 1].rank];
        
        if (pos2 - pos1 <= 2 && pos2 - pos1 >= 1) {
          combos.push({ cards: [sorted[i], sorted[i + 1], jokers[jokerIdx]], type: 'tierce' });
          usedCardIds.add(sorted[i].id);
          usedCardIds.add(sorted[i + 1].id);
          jokerIdx++;
        }
      }
    }
  }

  // Calculate values
  let vierge = 0;
  let total = 0;

  for (const combo of combos) {
    const mockCombo: Combination = {
      id: 'temp',
      type: combo.type,
      cards: combo.cards,
      ownerId: 'temp',
    };
    const rep = determineJokerRepresentation(mockCombo);
    if (rep) mockCombo.jokerRepresents = rep;
    
    const val = calculateCombinationValue(mockCombo);
    vierge += val.vierge;
    total += val.total;
  }

  const player = state.players[state.currentPlayerIndex];
  const requiredSuite = state.suite;
  const canOpen = vierge >= requiredSuite;

  return { combos, canOpen, vierge, total };
}

function planPlay(state: GameState, player: Player): AIDecision[] {
  const decisions: AIDecision[] = [];
  const actions = getAvailableActions(state);

  // If player is not opened, try to open
  if (player.status === 'not_opened') {
    const plan = findBestCombinations(player.hand, state);
    
    if (plan.canOpen) {
      for (const combo of plan.combos) {
        decisions.push({
          action: 'place',
          cardIds: combo.cards.map(c => c.id),
          combinationType: combo.type,
        });
      }
    }
    return decisions;
  }

  // Player is already opened - try to play cards
  // Try to add cards to existing combinations
  for (const addition of actions.possibleAdditions) {
    decisions.push({
      action: 'add',
      cardId: addition.cardId,
      combinationId: addition.combinationId,
    });
  }

  // Try to recover jokers if possible
  for (const recovery of actions.possibleJokerRecoveries) {
    decisions.push({
      action: 'recover_joker',
      cardId: recovery.replacementCardId,
      combinationId: recovery.combinationId,
    });
  }

  // Try to place new combinations
  const plan = findBestCombinations(player.hand, state);
  for (const combo of plan.combos) {
    decisions.push({
      action: 'place',
      cardIds: combo.cards.map(c => c.id),
      combinationType: combo.type,
    });
  }

  return decisions;
}

function chooseDiscard(state: GameState, player: Player): AIDecision {
  const hand = [...player.hand];
  
  if (hand.length === 0) {
    return { action: 'discard', cardId: '', faceDown: true };
  }

  // Score each card for discard
  let bestDiscard: GameCard = hand[0];
  let bestScore = -Infinity;

  for (const card of hand) {
    let score = 0;

    // Prefer discarding cards that don't help
    if (card.isJoker) {
      // Never discard joker if possible
      score -= 1000;

      // Unless it's the last card (RJ)
      if (hand.length === 1) {
        return { action: 'discard', cardId: card.id, faceDown: false };
      }
    } else {
      const c = card as Card;
      
      // Check if card is playable on table (would be a fault)
      if (player.status === 'opened') {
        if (isCardPlayableOnTable(card, state.tableCombinations)) {
          score -= 500; // Don't discard playable cards
        }
      }
      
      // Prefer discarding high-value cards that are isolated
      const sameRank = hand.filter(h => !h.isJoker && (h as Card).rank === c.rank && h.id !== card.id);
      const sameSuit = hand.filter(h => !h.isJoker && (h as Card).suit === c.suit && h.id !== card.id);
      
      // If card has no pairs/sequences, it's a good discard
      if (sameRank.length === 0) score += 30;
      
      // If card is isolated in suit, discard it
      const nearBySuit = sameSuit.filter(h => {
        const pos1 = RANK_ORDER[(h as Card).rank];
        const pos2 = RANK_ORDER[c.rank];
        return Math.abs(pos1 - pos2) <= 2;
      });
      if (nearBySuit.length === 0) score += 20;

      // Prefer discarding lower value cards to minimize opponent risk
      const value = getCardValue(c, 'high');
      score += (11 - value); // Lower value = better to discard
      
      // Consider risk of giving opponent a chop opportunity
      // High cards are more likely to help opponents
      score -= value * 2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestDiscard = card;
    }
  }

  const faceDown = !bestDiscard.isJoker || hand.length > 1;
  return {
    action: 'discard',
    cardId: bestDiscard.id,
    faceDown: bestDiscard.isJoker ? false : true,
  };
}

// Guarantees the AI ends its turn: performs a discard that changes the state
// (i.e. actually advances to the next player). Falls back safely so the game
// can never get stuck on an AI turn — including when an attempted opening below
// the SUITE is rejected by the engine.
function aiDiscardAndAdvance(state: GameState, meIndex: number): GameState {
  const tryDiscard = (s: GameState): GameState | null => {
    const me = s.players[meIndex];
    if (me.hand.length === 0) return null;
    const choice = chooseDiscard(s, me);
    const cardId = choice.cardId || me.hand[me.hand.length - 1].id;
    const next = discard(s, cardId, choice.faceDown ?? true);
    // A successful discard advances currentPlayerIndex or ends the round.
    if (next.currentPlayerIndex !== s.currentPlayerIndex || next.phase !== 'playing') return next;
    return null;
  };

  // 1) Try the normal discard.
  let result = tryDiscard(state);
  if (result) return result;

  // 2) CHOP-for-opening rule: the discard was refused because the AI chopped
  //    without being able to open. Cancel the chop, draw from the deck, then
  //    discard normally so the turn always advances.
  if (
    state.config.chopSeulementOuverture &&
    state.turnState?.drawSource === 'chop' &&
    state.players[meIndex].status === 'not_opened'
  ) {
    const afterReject = rejectChop(state);
    const afterDraw = drawCard(afterReject);
    if (afterDraw.phase !== 'playing' || afterDraw.currentPlayerIndex !== meIndex) {
      // e.g. null round after reshuffle — the state already moved on.
      return afterDraw;
    }
    result = tryDiscard(afterDraw);
    if (result) return result;
    // Discard still refused (e.g. invalid opening combos left on the table):
    // continue with the post-cancel state for the take-back safety below.
    state = afterDraw;
  }

  // 3) The discard was rejected (most likely an illegal opening below SUITE).
  //    Take back this AI's just-placed combinations into its hand and retry.
  const me = state.players[meIndex];
  if (me.status === 'not_opened') {
    const ownCombos = state.tableCombinations.filter(c => c.ownerId === me.id);
    if (ownCombos.length > 0) {
      const returnedCards = ownCombos.flatMap(c => c.cards);
      const rebuilt: GameState = {
        ...state,
        tableCombinations: state.tableCombinations.filter(c => c.ownerId !== me.id),
        players: state.players.map((p, i) =>
          i === meIndex ? { ...p, hand: [...p.hand, ...returnedCards] } : p
        ),
      };
      result = tryDiscard(rebuilt);
      if (result) return result;
    }
  }

  // 4) Last-resort safety: discard any remaining card so the turn always ends.
  const cur = state.players[meIndex];
  if (cur.hand.length > 0) {
    const forced = discard(state, cur.hand[0].id, !cur.hand[0].isJoker);
    if (forced.currentPlayerIndex !== state.currentPlayerIndex || forced.phase !== 'playing') return forced;
  }
  return state;
}

export function executeAITurn(state: GameState): GameState {
  if (!state.turnState) return state;
  let currentState = state;
  const meIndex = currentState.currentPlayerIndex;

  // ── Phase 1: draw or chop ──
  if (currentState.turnState?.phase === 'must_draw') {
    const me = currentState.players[meIndex];
    const wantsChop = shouldChop(currentState, me);
    currentState = wantsChop ? chopCard(currentState) : drawCard(currentState);

    // If drawing/chopping didn't move us into the playing phase (e.g. null round
    // after reshuffle, or the round ended), stop here — the state already moved on.
    if (currentState.phase !== 'playing') return currentState;
    if (currentState.currentPlayerIndex !== meIndex) return currentState;
    if (currentState.turnState?.phase !== 'playing') {
      // Could not draw for some reason: force-advance via a safe discard.
      return aiDiscardAndAdvance(currentState, meIndex);
    }
  }

  // ── Phase 2: place / add / recover (always keep ≥1 card for the discard) ──
  const playDecisions = planPlay(currentState, currentState.players[meIndex]);
  for (const pd of playDecisions) {
    const handLen = currentState.players[meIndex].hand.length;
    switch (pd.action) {
      case 'place':
        // Placing must leave at least one card to discard.
        if (pd.cardIds && pd.combinationType && handLen - pd.cardIds.length >= 1) {
          currentState = placeCombination(currentState, pd.cardIds, pd.combinationType);
        }
        break;
      case 'add':
        if (pd.cardId && pd.combinationId && handLen - 1 >= 1) {
          currentState = addToCombination(currentState, pd.cardId, pd.combinationId);
        }
        break;
      case 'recover_joker':
        if (pd.cardId && pd.combinationId) {
          currentState = recoverJoker(currentState, pd.combinationId, pd.cardId);
        }
        break;
    }
  }

  // ── Phase 3: guaranteed discard that advances the turn ──
  return aiDiscardAndAdvance(currentState, meIndex);
}
