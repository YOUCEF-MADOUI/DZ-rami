// =====================================================
// VALIDATION ENGINE
// Validates combinations, moves, first pose, etc.
// =====================================================
import {
  GameCard, Card, Combination, CombinationType,
  Rank, Suit, RANK_ORDER, SUITS,
  getCardValue, getSetValue, GameState, Player, GameConfig,
  INITIAL_THRESHOLDS, Fault, FaultType,
} from './types';

// ---- Card Utilities ----

export function isJoker(card: GameCard): card is import('./types').JokerCard {
  return card.isJoker;
}

export function getNonJokerCards(cards: GameCard[]): Card[] {
  return cards.filter((c): c is Card => !c.isJoker);
}

export function getJokerCount(cards: GameCard[]): number {
  return cards.filter(c => c.isJoker).length;
}

// ---- Combination Validation ----

/**
 * Detect whether a raw list of cards (in order) forms a valid combination.
 * Returns the combination type ('tierce' | 'carre') if valid, otherwise null.
 *
 * - carré/brelan: 3 or 4 cards of the same rank, different suits (max 1 joker)
 * - tierce: 3+ consecutive cards of the same suit (max 1 joker)
 */
export function detectCombinationType(cards: GameCard[]): CombinationType | null {
  if (cards.length < 3 || cards.length > 5) return null;

  const baseCombo: Omit<Combination, 'type'> = {
    id: '__detect__',
    cards,
    ownerId: '__detect__',
  };

  // A carré/brelan has 3 or 4 cards (same rank, different suits).
  if (cards.length <= 4 && validateCarre({ ...baseCombo, type: 'carre' }).valid) {
    return 'carre';
  }

  // A tierce is a run of same-suit consecutive cards (3, 4 or 5 cards).
  if (validateTierce({ ...baseCombo, type: 'tierce' }).valid) {
    return 'tierce';
  }

  return null;
}

export function validateCombination(combo: Combination): { valid: boolean; error?: string } {
  if (combo.cards.length < 3) {
    return { valid: false, error: 'Combination must have at least 3 cards' };
  }

  const jokerCount = getJokerCount(combo.cards);
  if (jokerCount > 1) {
    return { valid: false, error: 'A combination can contain at most ONE joker' };
  }

  if (combo.type === 'tierce') {
    return validateTierce(combo);
  } else if (combo.type === 'carre') {
    return validateCarre(combo);
  }

  return { valid: false, error: 'Unknown combination type' };
}

export function validateTierce(combo: Combination): { valid: boolean; error?: string } {
  const cards = combo.cards;
  const nonJokers = getNonJokerCards(cards);
  const jokerCount = getJokerCount(cards);

  if (jokerCount > 1) {
    return { valid: false, error: 'Tierce can have at most 1 joker' };
  }

  // All non-joker cards must be same suit
  const suits = new Set(nonJokers.map(c => c.suit));
  if (suits.size > 1) {
    return { valid: false, error: 'All cards in a tierce must be the same suit' };
  }

  const suit = nonJokers[0]?.suit;
  if (!suit) {
    return { valid: false, error: 'Tierce must have at least 2 non-joker cards' };
  }

  // Check consecutive ranks
  const rankPositions = nonJokers.map(c => RANK_ORDER[c.rank]);
  
  // Handle Ace being high (A-K-Q): Ace can be 1 or 14
  // Try both interpretations
  const result = validateConsecutiveWithJoker(cards, suit);
  return result;
}

function validateConsecutiveWithJoker(
  cards: GameCard[],
  suit: Suit
): { valid: boolean; error?: string } {
  const jokerCount = getJokerCount(cards);
  const nonJokers = getNonJokerCards(cards);
  
  // Try to find a valid consecutive arrangement
  // For each possible starting position, check if cards fit
  
  // Get rank positions, handling Ace as both 1 and 14
  const rankPositionsLow = nonJokers.map(c => RANK_ORDER[c.rank]);
  const rankPositionsHigh = nonJokers.map(c => c.rank === 'A' ? 14 : RANK_ORDER[c.rank]);
  
  // Try low Ace interpretation
  if (tryConsecutive(rankPositionsLow, cards.length, jokerCount)) {
    return { valid: true };
  }
  
  // Try high Ace interpretation
  if (tryConsecutive(rankPositionsHigh, cards.length, jokerCount)) {
    return { valid: true };
  }
  
  return { valid: false, error: 'Cards are not consecutive' };
}

function tryConsecutive(positions: number[], totalCards: number, jokerCount: number): boolean {
  const sorted = [...positions].sort((a, b) => a - b);
  
  const minPos = sorted[0];
  const maxPos = sorted[sorted.length - 1];

  // Check for duplicates in positions
  const uniquePositions = new Set(sorted);
  if (uniquePositions.size !== sorted.length) return false;

  // The real cards must fit inside a window of exactly `totalCards` consecutive
  // positions. A joker may fill a gap anywhere in that window — including before
  // the lowest card or after the highest one (e.g. A-K + joker => Q-K-A).
  const span = maxPos - minPos + 1;
  if (span > totalCards) return false; // real cards already too spread out

  // Try every window of size `totalCards` that still contains all real cards.
  for (let start = maxPos - totalCards + 1; start <= minPos; start++) {
    const end = start + totalCards - 1;

    // A can be 1 (low) or 14 (high) but sequences must not wrap past those bounds.
    if (start < 1 || end > 14) continue;

    // Count how many positions in this window are NOT covered by a real card.
    let gaps = 0;
    for (let i = start; i <= end; i++) {
      if (!uniquePositions.has(i)) gaps++;
    }

    // Those gaps must be exactly filled by the available jokers.
    if (gaps === jokerCount) return true;
  }

  return false;
}

export function validateCarre(combo: Combination): { valid: boolean; error?: string } {
  const cards = combo.cards;
  const nonJokers = getNonJokerCards(cards);
  const jokerCount = getJokerCount(cards);

  if (cards.length > 4) {
    return { valid: false, error: 'Carré can have at most 4 cards' };
  }

  if (cards.length < 3) {
    return { valid: false, error: 'Carré/Brelan must have at least 3 cards' };
  }

  if (jokerCount > 1) {
    return { valid: false, error: 'Carré can have at most 1 joker' };
  }

  // All non-joker cards must have the same rank
  const ranks = new Set(nonJokers.map(c => c.rank));
  if (ranks.size > 1) {
    return { valid: false, error: 'All cards in a carré must have the same rank' };
  }

  // All non-joker cards must have different suits
  const suitSet = new Set(nonJokers.map(c => c.suit));
  if (suitSet.size !== nonJokers.length) {
    return { valid: false, error: 'All cards in a carré must have different suits' };
  }

  return { valid: true };
}

// ---- Combination Value Calculation ----

export function calculateCombinationValue(combo: Combination): {
  total: number;
  vierge: number; // Value without jokers
} {
  const nonJokers = getNonJokerCards(combo.cards);
  const jokerCount = getJokerCount(combo.cards);

  if (combo.type === 'carre') {
    return calculateCarreValue(combo);
  }

  return calculateTierceValue(combo);
}

function calculateTierceValue(combo: Combination): { total: number; vierge: number } {
  const cards = combo.cards;
  const nonJokers = getNonJokerCards(cards);
  
  // Determine the sequence positions
  const sequence = determineTierceSequence(combo);
  if (!sequence) return { total: 0, vierge: 0 };

  let total = 0;
  let vierge = 0;

  for (const pos of sequence) {
    const rank = positionToRank(pos.position);
    let value: number;
    
    if (rank === 'A') {
      // Determine if Ace is low or high based on position
      value = pos.position === 1 ? 1 : 11;
    } else if (['K', 'Q', 'J', '10'].includes(rank)) {
      value = 10;
    } else {
      value = RANK_ORDER[rank];
    }

    total += value;
    if (!pos.isJoker) {
      vierge += value;
    }
  }

  return { total, vierge };
}

function calculateCarreValue(combo: Combination): { total: number; vierge: number } {
  const nonJokers = getNonJokerCards(combo.cards);
  const jokerCount = getJokerCount(combo.cards);
  
  if (nonJokers.length === 0) return { total: 0, vierge: 0 };
  
  const rank = nonJokers[0].rank;
  const totalCount = combo.cards.length;
  
  if (rank === 'A') {
    // Special values for Aces
    if (totalCount === 3) return { total: 33, vierge: jokerCount > 0 ? 33 - 11 : 33 };
    if (totalCount === 4) return { total: 44, vierge: jokerCount > 0 ? 44 - 11 : 44 };
  }
  
  const cardValue = getCardValue(nonJokers[0], 'set');
  const total = cardValue * totalCount;
  const vierge = cardValue * nonJokers.length;
  
  return { total, vierge };
}

export interface SequencePosition {
  position: number; // 1-13 (1=Ace low) or 14 (Ace high)
  isJoker: boolean;
  card?: GameCard;
}

export function determineTierceSequence(combo: Combination): SequencePosition[] | null {
  const cards = combo.cards;
  const nonJokers = getNonJokerCards(cards);
  const jokerCount = getJokerCount(cards);
  
  if (nonJokers.length === 0) return null;

  // Try low Ace
  const lowPositions = nonJokers.map(c => ({ pos: RANK_ORDER[c.rank], card: c as GameCard }));
  const lowResult = buildSequence(lowPositions, jokerCount, cards.length);
  if (lowResult) return lowResult;

  // Try high Ace
  const highPositions = nonJokers.map(c => ({ 
    pos: c.rank === 'A' ? 14 : RANK_ORDER[c.rank], 
    card: c as GameCard 
  }));
  const highResult = buildSequence(highPositions, jokerCount, cards.length);
  if (highResult) return highResult;

  return null;
}

function buildSequence(
  positions: { pos: number; card: GameCard }[],
  jokerCount: number,
  totalCards: number
): SequencePosition[] | null {
  const sorted = [...positions].sort((a, b) => a.pos - b.pos);
  const minPos = sorted[0].pos;
  
  const sequence: SequencePosition[] = [];
  let jokersUsed = 0;
  let cardIdx = 0;

  for (let i = 0; i < totalCards; i++) {
    const targetPos = minPos + i;
    if (targetPos > 14) return null;
    
    if (cardIdx < sorted.length && sorted[cardIdx].pos === targetPos) {
      sequence.push({ position: targetPos, isJoker: false, card: sorted[cardIdx].card });
      cardIdx++;
    } else if (jokersUsed < jokerCount) {
      sequence.push({ position: targetPos, isJoker: true });
      jokersUsed++;
    } else {
      return null;
    }
  }

  if (cardIdx !== sorted.length || jokersUsed !== jokerCount) return null;
  return sequence;
}

function positionToRank(position: number): Rank {
  if (position === 14) return 'A';
  const entries = Object.entries(RANK_ORDER);
  const found = entries.find(([, v]) => v === position);
  return found ? found[0] as Rank : 'A';
}

// ---- First Pose Validation ----

export function validateFirstPose(
  combinations: Combination[],
  suite: number,
  initialThreshold: number,
  playerHasJokerFromHand: boolean,
  config: GameConfig
): { valid: boolean; vierge: number; total: number; errors: string[] } {
  const errors: string[] = [];
  
  let totalVierge = 0;
  let totalValue = 0;

  for (const combo of combinations) {
    const validation = validateCombination(combo);
    if (!validation.valid) {
      errors.push(validation.error || 'Invalid combination');
      continue;
    }
    
    const value = calculateCombinationValue(combo);
    totalVierge += value.vierge;
    totalValue += value.total;
  }

  // Determine required threshold
  // If player has a joker from hand, they use initial threshold
  const requiredSuite = playerHasJokerFromHand ? initialThreshold : suite;

  // VIERGE must meet the SUITE
  if (totalVierge < requiredSuite) {
    errors.push(`VIERGE (${totalVierge}) must be >= SUITE (${requiredSuite})`);
  }

  // Check initial threshold for joker usage in first pose
  const hasJokerInCombinations = combinations.some(c => getJokerCount(c.cards) > 0);
  if (hasJokerInCombinations) {
    // Must reach initial threshold in VIERGE first
    if (totalVierge < initialThreshold) {
      errors.push(`Must reach initial threshold (${initialThreshold}) in VIERGE before using jokers in first pose`);
    }
  }

  // Check tierce max 5 cards when first placed
  for (const combo of combinations) {
    if (combo.type === 'tierce' && combo.cards.length > 5) {
      errors.push('A tierce cannot exceed 5 cards when first placed');
    }
  }

  return {
    valid: errors.length === 0,
    vierge: totalVierge,
    total: totalValue,
    errors,
  };
}

// ---- Can Card Be Added to Combination ----

export function canAddToCombination(
  combo: Combination,
  card: GameCard
): boolean {
  if (combo.type === 'carre') {
    return canAddToCarre(combo, card);
  }
  return canAddToTierce(combo, card);
}

function canAddToCarre(combo: Combination, card: GameCard): boolean {
  if (combo.cards.length >= 4) return false;
  
  const nonJokers = getNonJokerCards(combo.cards);
  if (nonJokers.length === 0) return false;
  
  if (card.isJoker) {
    // Can add joker if no joker already present
    return getJokerCount(combo.cards) === 0;
  }
  
  // Must be same rank, different suit
  const rank = nonJokers[0].rank;
  if (card.rank !== rank) return false;
  
  const existingSuits = new Set(nonJokers.map(c => c.suit));
  return !existingSuits.has(card.suit);
}

function canAddToTierce(combo: Combination, card: GameCard): boolean {
  // No max length restriction after initial placement
  const nonJokers = getNonJokerCards(combo.cards);
  if (nonJokers.length === 0) return false;
  
  const suit = nonJokers[0].suit;
  
  if (card.isJoker) {
    // Can add joker only if no joker already present
    if (getJokerCount(combo.cards) > 0) return false;
    // Joker can extend at either end
    return true;
  }
  
  // Must be same suit
  if (card.suit !== suit) return false;
  
  // Must extend the sequence at either end
  const sequence = determineTierceSequence(combo);
  if (!sequence) return false;
  
  const positions = sequence.map(s => s.position);
  const minPos = Math.min(...positions);
  const maxPos = Math.max(...positions);
  
  const cardPos = RANK_ORDER[card.rank];
  const cardPosHigh = card.rank === 'A' ? 14 : cardPos;
  
  // Can add at low end
  if (cardPos === minPos - 1 && minPos - 1 >= 1) return true;
  // Can add at high end
  if (cardPos === maxPos + 1 && maxPos + 1 <= 13) return true;
  // Ace high at the end
  if (cardPosHigh === maxPos + 1 && maxPos + 1 <= 14) return true;
  // Ace low at the start
  if (card.rank === 'A' && minPos === 2) return true;
  
  return false;
}

// ---- Check if discard is playable (fault detection) ----

export function isCardPlayableOnTable(
  card: GameCard,
  tableCombinations: Combination[]
): boolean {
  if (card.isJoker) return false; // Joker discard is a separate rule
  
  for (const combo of tableCombinations) {
    if (canAddToCombination(combo, card)) {
      return true;
    }
  }
  return false;
}

// ---- Joker Recovery Validation ----

export function canRecoverJoker(
  combo: Combination,
  replacementCard: GameCard
): boolean {
  if (getJokerCount(combo.cards) === 0) return false;
  if (replacementCard.isJoker) return false;
  
  // Find what the joker represents
  if (!combo.jokerRepresents) return false;
  
  const card = replacementCard as Card;
  return card.rank === combo.jokerRepresents.rank && 
         card.suit === combo.jokerRepresents.suit;
}

// ---- Determine Joker Representation ----

export function determineJokerRepresentation(
  combo: Combination
): { rank: Rank; suit: Suit } | null {
  const sequence = determineTierceSequence(combo);
  if (combo.type === 'tierce' && sequence) {
    const jokerPos = sequence.find(s => s.isJoker);
    if (!jokerPos) return null;
    
    const nonJokers = getNonJokerCards(combo.cards);
    const suit = nonJokers[0]?.suit;
    if (!suit) return null;
    
    return { rank: positionToRank(jokerPos.position), suit };
  }
  
  if (combo.type === 'carre') {
    const nonJokers = getNonJokerCards(combo.cards);
    if (nonJokers.length === 0) return null;
    
    const rank = nonJokers[0].rank;
    const usedSuits = new Set(nonJokers.map(c => c.suit));
    const missingSuit = SUITS.find(s => !usedSuits.has(s));
    
    if (!missingSuit) return null;
    return { rank, suit: missingSuit };
  }
  
  return null;
}

// ---- Next Player Index (Anti-clockwise) ----

export function getNextPlayerIndex(currentIndex: number, playerCount: number): number {
  // Anti-clockwise: decreasing index with wrapping
  return (currentIndex - 1 + playerCount) % playerCount;
}

export function getPreviousPlayerIndex(currentIndex: number, playerCount: number): number {
  // The player who played before (clockwise from current = the one current can chop)
  return (currentIndex + 1) % playerCount;
}

// ---- Create Fault ----

export function createFault(
  playerId: string,
  type: FaultType,
  config: GameConfig,
  hasJokerOnly: boolean = false
): Fault {
  const penalty = hasJokerOnly ? config.faulteJokerPenalty : config.faultePenalty;
  const descriptions: Record<FaultType, string> = {
    invalid_combination: 'Combinaison invalide',
    wrong_point_calculation: 'Mauvais calcul de points',
    below_suite: 'Première pose sous la SUITE',
    insufficient_vierge: 'VIERGE finale insuffisante',
    forgot_discard: 'Oubli de défausse',
    illegal_joker_use: 'Utilisation interdite d\'un Joker',
    bad_joker_recovery: 'Mauvaise récupération de Joker',
    playable_discard: 'Défausse jouable après ouverture',
    carre_not_recovered: 'Carré non récupéré',
    opened_without_tierce: 'Ouverture sans tierce (tierce obligatoire)',
    other_violation: 'Autre violation des règles',
  };

  return {
    playerId,
    type,
    penalty,
    description: descriptions[type],
  };
}
