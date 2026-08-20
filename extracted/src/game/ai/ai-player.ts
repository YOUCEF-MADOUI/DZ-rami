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
  getAvailableActions, canChop,
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

export function executeAITurn(state: GameState): GameState {
  let currentState = state;
  const decisions = makeAIDecision(currentState);

  for (const decision of decisions) {
    switch (decision.action) {
      case 'draw':
        currentState = drawCard(currentState);
        break;
      case 'chop':
        currentState = chopCard(currentState);
        break;
      case 'place':
        if (decision.cardIds && decision.combinationType) {
          currentState = placeCombination(currentState, decision.cardIds, decision.combinationType);
        }
        break;
      case 'add':
        if (decision.cardId && decision.combinationId) {
          currentState = addToCombination(currentState, decision.cardId, decision.combinationId);
        }
        break;
      case 'recover_joker':
        if (decision.cardId && decision.combinationId) {
          currentState = recoverJoker(currentState, decision.combinationId, decision.cardId);
        }
        break;
      case 'discard':
        if (decision.cardId) {
          currentState = discard(currentState, decision.cardId, decision.faceDown ?? true);
        }
        break;
    }

    // Re-evaluate after draw/chop
    if (decision.action === 'draw' || decision.action === 'chop') {
      const playDecisions = planPlay(currentState, currentState.players[currentState.currentPlayerIndex]);
      const discardDecision = chooseDiscard(currentState, currentState.players[currentState.currentPlayerIndex]);
      
      for (const pd of playDecisions) {
        switch (pd.action) {
          case 'place':
            if (pd.cardIds && pd.combinationType) {
              currentState = placeCombination(currentState, pd.cardIds, pd.combinationType);
            }
            break;
          case 'add':
            if (pd.cardId && pd.combinationId) {
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

      if (discardDecision.cardId) {
        currentState = discard(currentState, discardDecision.cardId, discardDecision.faceDown ?? true);
      }
      break; // Exit after full turn
    }
  }

  return currentState;
}
